/**
 * Calls AuthService.seedMarketplaceUsers() only — no seller upserts, no
 * legacy-seller deactivation, no catalog imports. Safe to run any time.
 *
 *   node dist/src/seed-auth-users-only.cli.js
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuthService } from './modules/auth/auth.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const auth = app.get(AuthService);
    const result = await auth.seedMarketplaceUsers();
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
