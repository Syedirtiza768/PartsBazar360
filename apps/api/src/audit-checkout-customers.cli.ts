/**
 * Read-only preflight for the guest-first customer migration.
 *
 *   npm run build --workspace=api
 *   npm run audit:checkout-customers --workspace=api
 *
 * It intentionally never merges or deletes data. Review the JSON report before
 * applying a later reconciliation script to production records.
 */
import 'dotenv/config';
import { PrismaService } from './prisma.service';
import { normalizePhone } from './modules/auth/phone.util';

async function main() {
  const prisma = new PrismaService();
  await prisma.onModuleInit();
  try {
    const schemaCheck = await prisma.$queryRaw<
      Array<{ customerTablePresent: boolean; customerIdColumnPresent: boolean }>
    >`
      SELECT
        to_regclass('"Customer"') IS NOT NULL AS "customerTablePresent",
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'User'
            AND column_name = 'customerId'
        ) AS "customerIdColumnPresent"
    `;
    const customerTablePresent = Boolean(schemaCheck[0]?.customerTablePresent);
    const customerIdColumnPresent = Boolean(
      schemaCheck[0]?.customerIdColumnPresent,
    );
    const baseUsers = await prisma.user.findMany({
      where: { phone: { not: null } },
      select: {
        id: true,
        phone: true,
        phoneVerified: true,
        passwordHash: true,
        createdAt: true,
      },
    });
    const customerLinks = customerIdColumnPresent
      ? await prisma.user.findMany({
          where: { phone: { not: null } },
          select: { id: true, customerId: true },
        })
      : [];
    const customerIdByUser = new Map(
      customerLinks.map((user) => [user.id, user.customerId]),
    );
    const users = baseUsers.map((user) => ({
      ...user,
      customerId: customerIdByUser.get(user.id) ?? null,
    }));
    const customers = customerTablePresent
      ? await prisma.customer.findMany({
          select: { id: true, phoneNormalized: true },
        })
      : [];

    const invalid: Array<{ userId: string; phone: string }> = [];
    const groups = new Map<string, typeof users>();
    for (const user of users) {
      try {
        const normalized = normalizePhone(user.phone!);
        const group = groups.get(normalized) ?? [];
        group.push(user);
        groups.set(normalized, group);
      } catch {
        invalid.push({ userId: user.id, phone: user.phone! });
      }
    }

    const duplicates = [...groups.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([phoneNormalized, group]) => ({
        phoneNormalized,
        canonicalCandidate: [...group].sort((a, b) => {
          const accountDifference =
            Number(Boolean(b.passwordHash)) - Number(Boolean(a.passwordHash));
          if (accountDifference) return accountDifference;
          const verifiedDifference =
            Number(b.phoneVerified) - Number(a.phoneVerified);
          if (verifiedDifference) return verifiedDifference;
          return a.createdAt.getTime() - b.createdAt.getTime();
        })[0]?.id,
        users: group.map((user) => ({
          id: user.id,
          verified: user.phoneVerified,
          hasAccount: Boolean(user.passwordHash),
          customerId: user.customerId,
        })),
      }));

    const customerPhones = new Map(
      customers.map((customer) => [customer.phoneNormalized, customer.id]),
    );
    const missingCustomers = [...groups.entries()]
      .filter(
        ([phone, group]) =>
          group.some((user) => user.phoneVerified) &&
          !customerPhones.has(phone),
      )
      .map(([phoneNormalized, group]) => ({
        phoneNormalized,
        verifiedUserIds: group
          .filter((user) => user.phoneVerified)
          .map((user) => user.id),
      }));

    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          summary: {
            usersWithPhone: users.length,
            normalizedPhones: groups.size,
            invalidPhones: invalid.length,
            duplicateNormalizedPhones: duplicates.length,
            verifiedPhonesMissingCustomer: missingCustomers.length,
            customerTablePresent,
            customerIdColumnPresent,
          },
          invalid,
          duplicates,
          missingCustomers,
          reconciliationPolicy: [
            'Never merge on an unverified phone.',
            'Prefer the row with a password account, then a verified row, then the oldest row.',
            'Repoint orders and account linkage transactionally before removing duplicate identities.',
            'Require manual review when multiple password accounts normalize to the same phone.',
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.onModuleDestroy();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
