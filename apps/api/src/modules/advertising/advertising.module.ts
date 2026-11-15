import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Global,
  Header,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  AdvertisingService,
  CONSENT_COOKIE,
  CONSENT_SECONDS,
} from './advertising.service';
import { marketingOrigin } from './advertising-payload';

@Controller('advertising/consent')
class AdvertisingConsentController {
  constructor(private readonly advertising: AdvertisingService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async status(@Req() req: Request) {
    const config = this.advertising.config();
    const enabled = Boolean(config.meta || config.tiktok);
    const id = this.advertising.consentId(req);
    const consent = enabled
      ? await this.advertising.activeConsent(id)
      : undefined;
    return {
      enabled,
      granted: Boolean(consent),
      expiresAt: consent?.expiresAt,
      config,
    };
  }

  @Post()
  @Header('Cache-Control', 'private, no-store')
  async set(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body('granted') granted: unknown,
  ) {
    if (
      req.get('origin') !== marketingOrigin() ||
      typeof granted !== 'boolean'
    ) {
      throw new ForbiddenException();
    }
    const config = this.advertising.config();
    const enabled = Boolean(config.meta || config.tiktok);
    const id = await this.advertising.setConsent(
      this.advertising.consentId(req),
      enabled && granted,
    );
    const options = {
      httpOnly: true,
      secure: req.get('origin')?.startsWith('https:'),
      sameSite: 'lax' as const,
      path: '/',
    };
    if (id)
      res.cookie(CONSENT_COOKIE, id, {
        ...options,
        maxAge: CONSENT_SECONDS * 1000,
      });
    else res.clearCookie(CONSENT_COOKIE, options);
    const consent = id ? await this.advertising.activeConsent(id) : undefined;
    return {
      enabled,
      granted: Boolean(consent),
      expiresAt: consent?.expiresAt,
      config,
    };
  }
}

@Injectable()
class AdvertisingRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdvertisingRunner.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastPrune = 0;

  constructor(private readonly advertising: AdvertisingService) {}

  onModuleInit() {
    if (process.env.RUN_INGESTION_WORKER !== '1') return;
    this.timer = setInterval(() => void this.tick(), 5_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      // Suppress pending rows even if the destination has since been disabled.
      await this.advertising.drain();
      if (Date.now() - this.lastPrune >= 60 * 60 * 1000) {
        await this.advertising.prune();
        this.lastPrune = Date.now();
      }
    } catch {
      this.logger.warn('Advertising delivery cycle failed');
    } finally {
      this.running = false;
    }
  }
}

@Global()
@Module({
  controllers: [AdvertisingConsentController],
  providers: [AdvertisingService, AdvertisingRunner],
  exports: [AdvertisingService],
})
export class AdvertisingModule {}
