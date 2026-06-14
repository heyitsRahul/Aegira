import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'node:path';
import { StubNotifier } from '../services/notification.service';
import { SessionService } from '../services/session.service';
import { StubSmsTransport } from '../services/sms';
import { ResponderRegistry } from './responder-registry';
import { RESPONDER_REGISTRY, SESSION_SERVICE } from './session.controller';

export const OUTBOX = 'OUTBOX';
export const SMS_TRANSPORT = 'SMS_TRANSPORT';

const PUBLIC_DIR = join(__dirname, '..', '..', 'public');

/**
 * DEV-ONLY surface. Serves the app (/), demo console (/console), and the
 * feature-phone simulator (/phone); exposes the stub notifier outbox and
 * the stub SMS log — the stand-ins for push/SMS transport that the
 * simulated devices poll — plus the server-side ops view. The ops view
 * reveals duress and must never exist in production wiring (invariant 4).
 */
@Controller()
export class DevController {
  constructor(
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(OUTBOX) private readonly outboxStub: StubNotifier,
    @Inject(SMS_TRANSPORT) private readonly smsStub: StubSmsTransport,
    @Inject(RESPONDER_REGISTRY) private readonly registry: ResponderRegistry,
  ) {}

  @Get()
  landing(@Res() res: Response): void {
    res.sendFile(join(PUBLIC_DIR, 'landing.html'));
  }

  @Get('app')
  app(@Res() res: Response): void {
    res.sendFile(join(PUBLIC_DIR, 'app.html'));
  }

  @Get('console')
  console(@Res() res: Response): void {
    res.sendFile(join(PUBLIC_DIR, 'console.html'));
  }

  @Get('phone')
  phone(@Res() res: Response): void {
    res.sendFile(join(PUBLIC_DIR, 'phone.html'));
  }

  @Get('manifest.webmanifest')
  manifest(@Res() res: Response): void {
    res.type('application/manifest+json');
    res.sendFile(join(PUBLIC_DIR, 'manifest.webmanifest'));
  }

  @Get('icon.svg')
  icon(@Res() res: Response): void {
    res.sendFile(join(PUBLIC_DIR, 'icon.svg'));
  }

  /** Everything the stub notifier "sent" — the simulated phones read this. */
  @Get('dev/outbox')
  outbox() {
    return {
      contactAlerts: this.outboxStub.contactAlerts,
      responderOffers: this.outboxStub.responderOffers,
    };
  }

  /** Every SMS the stub transport "sent" — the phone simulator reads this. */
  @Get('dev/sms-log')
  smsLog() {
    return this.smsStub.messages;
  }

  /** Seeded responder roster, for the responder app's identity picker. */
  @Get('dev/roster')
  roster() {
    return this.registry.devRoster();
  }

  /** Server truth: real state + hash-chained event log. Ops eyes only. */
  @Get('dev/sessions/:id/truth')
  truth(@Param('id') id: string) {
    return this.sessions.opsView(id);
  }
}
