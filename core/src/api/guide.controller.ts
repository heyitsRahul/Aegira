import { Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { guidePage, offlinePage } from './guide-view';

export const PUBLIC_CONFIG = 'PUBLIC_CONFIG';

/** Display-only settings every client may see. No secrets, no PII. */
export interface PublicConfig {
  smsNumber: string | null;
  demoMode: boolean;
}

@Controller()
export class GuideController {
  constructor(@Inject(PUBLIC_CONFIG) private readonly config: PublicConfig) {}

  /** How to use Aegira on any phone. ?lang=hi for Hindi. */
  @Get('guide')
  @Header('content-type', 'text/html; charset=utf-8')
  guide(@Query('lang') lang?: string): string {
    return guidePage(lang === 'hi' ? 'hi' : 'en', this.config);
  }

  /** Cached by the service worker; shown when the phone is offline. */
  @Get('offline.html')
  @Header('content-type', 'text/html; charset=utf-8')
  offline(): string {
    return offlinePage(this.config);
  }

  @Get('config')
  publicConfig(): PublicConfig {
    return this.config;
  }
}
