/**
 * Grants Payment Links-only access to an existing verified account without
 * resetting its password. Set PAYMENT_LINKS_ADMIN_EMAIL and optionally
 * PAYMENT_LINKS_ADMIN_NAME before running.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuthService } from './modules/auth/auth.service';

async function main() {
  const email = process.env.PAYMENT_LINKS_ADMIN_EMAIL;
  if (!email) {
    throw new Error(
      'PAYMENT_LINKS_ADMIN_EMAIL environment variable is required',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const auth = app.get(AuthService);
    const result = await auth.provisionPaymentLinksAdmin({
      email,
      name: process.env.PAYMENT_LINKS_ADMIN_NAME,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
