import { Module } from '@nestjs/common';
import { SeoController } from './seo.controller';
import { SeoCatalogService } from './seo-catalog.service';
import { SeoHealthService } from './seo-health.service';
import { SeoSlugService } from './seo-slug.service';

/**
 * SEO domain module.
 *
 * Depends only on the (global) PrismaModule, which is what lets SearchModule
 * import it for slug assignment without creating a cycle — the slug lifecycle
 * hangs off indexing, but indexing knows nothing about SEO beyond one call.
 */
@Module({
  providers: [SeoSlugService, SeoCatalogService, SeoHealthService],
  controllers: [SeoController],
  exports: [SeoSlugService, SeoCatalogService, SeoHealthService],
})
export class SeoModule {}
