/**
 * Provision one SEO-only CMS account without resetting any other staff
 * credentials. Set SEO_EDITOR_EMAIL and SEO_EDITOR_PASSWORD before running.
 * Set SEO_EDITOR_RESET_PASSWORD=1 only when intentionally rotating an
 * existing SEO_EDITOR password.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuthService } from './modules/auth/auth.service';

async function main() {
  const email = process.env.SEO_EDITOR_EMAIL;
  const password = process.env.SEO_EDITOR_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'SEO_EDITOR_EMAIL and SEO_EDITOR_PASSWORD environment variables are required',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const auth = app.get(AuthService);
    const result = await auth.provisionSeoEditor({
      email,
      password,
      name: process.env.SEO_EDITOR_NAME,
      resetPassword: process.env.SEO_EDITOR_RESET_PASSWORD === '1',
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
