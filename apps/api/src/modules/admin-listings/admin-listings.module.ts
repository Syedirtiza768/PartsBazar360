import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { SearchModule } from '../search/search.module';
import { SeoModule } from '../seo/seo.module';
import { AdminListingsController } from './admin-listings.controller';
import { AdminListingsService } from './admin-listings.service';
import { ListingImagesController } from './listing-images.controller';

@Module({
  imports: [AuthModule, AuditModule, SearchModule, SeoModule],
  controllers: [AdminListingsController, ListingImagesController],
  providers: [AdminListingsService],
})
export class AdminListingsModule {}
