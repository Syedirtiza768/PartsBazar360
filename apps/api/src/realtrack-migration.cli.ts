import { NestFactory } from '@nestjs/core';
import { writeFile } from 'node:fs/promises';
import { AppModule } from './app.module.js';
import { RealtrackBridgeService } from './modules/realtrack-bridge/realtrack-bridge.service.js';

function argument(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

async function main() {
  // This CLI only reads PartsBazar's database. Do not start the bridge worker
  // while exporting a bundle, because export must not enqueue or transfer jobs.
  process.env.RUN_INGESTION_WORKER = '0';

  const output = argument('output', '/tmp/parts-bazar-realtrack-migration.json');
  if (!output) throw new Error('--output is required');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    const bridge = app.get(RealtrackBridgeService);
    const bundle = await bridge.exportMigration({
      selectAll: true,
      maxItems: 5000,
      brand: argument('brand', 'FEBI'),
      search: argument('search'),
      status: argument('status', 'ACTIVE'),
      targetCurrency: 'USD',
      includeOutOfStock: argument('include-out-of-stock') === 'true',
      dryRun: true,
      publishToEbay: false,
      storeIds: [],
    });
    await writeFile(output, `${JSON.stringify(bundle)}\n`, 'utf8');
    console.log(
      JSON.stringify({
        output,
        counts: bundle.counts,
        targetCurrency: bundle.targetCurrency,
      }),
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
