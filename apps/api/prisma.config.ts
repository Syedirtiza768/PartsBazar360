// Prisma config for CLI (migrate/generate). DATABASE_URL comes from the
// environment in Docker; dotenv is optional for local CLI use.
try {
  require('dotenv/config');
} catch {
  /* dotenv not installed in production runtime — env already injected */
}

const { defineConfig } = require('prisma/config');

module.exports = defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
