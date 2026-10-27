import { Body, Controller, Get, Inject, NotFoundException, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'node:path';
import { StubNotifier } from '../services/notification.service';
import { SessionService } from '../services/session.service';
import { StubSmsTransport } from '../services/sms';
import { SmsGatewayService } from '../services/sms-gateway.service';
import { SMS_GATEWAY } from './gateway.controller';
import { ResponderRegistry } from './responder-registry';
import { RESPONDER_REGISTRY, SESSION_SERVICE } from './session.controller';

export const OUTBOX = 'OUTBOX';
export const SMS_TRANSPORT = 'SMS_TRANSPORT';
export const DEMO_MODE = 'DEMO_MODE';

const PUBLIC_DIR = join(__dirname, '..', '..', 'public');

/**
 * Serves the public pages (landing, app, manifest, icon) and the DEMO-ONLY
 * surfaces: the ops console (/console), the feature-phone simulator (/phone
 * and its SMS channel), the stub notifier outbox and SMS log that the
 * simulated devices poll, the seeded responder roster, and the server-side
 * ops view. The ops view reveals duress, so every demo surface returns 404
 * unless demo mode is on (invariant 4) — a real deployment sets
 * AEGIRA_DEMO=off.
 */
@Controller()
export class DevController {
  constructor(
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(OUTBOX) private readonly outboxStub: StubNotifier,
    @Inject(SMS_TRANSPORT) private readonly smsStub: StubSmsTransport,
    @Inject(RESPONDER_REGISTRY) private readonly registry: ResponderRegistry,
    @Inject(SMS_GATEWAY) private readonly gateway: SmsGatewayService,
    @Inject(DEMO_MODE) private readonly demoMode: boolean,
  ) {}

  private demoOnly(): void {
    if (!this.demoMode) {
      throw new NotFoundException();
    }
  }

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
    this.demoOnly();
    res.sendFile(join(PUBLIC_DIR, 'console.html'));
  }

  @Get('phone')
  phone(@Res() res: Response): void {
    this.demoOnly();
    res.sendFile(join(PUBLIC_DIR, 'phone.html'));
  }

  /**
   * The simulator's "network": stands in for the carrier delivering an SMS
   * to the gateway, so the public demo never needs the real webhook secret.
   */
  @Post('dev/phone/sms')
  async phoneSms(
    @Body() body: { from: string; text: string; approxLat?: number; approxLng?: number },
  ) {
    this.demoOnly();
    const approxLocation =
      typeof body.approxLat === 'number' && typeof body.approxLng === 'number'
        ? { lat: body.approxLat, lng: body.approxLng }
        : undefined;
    return { reply: await this.gateway.handle(String(body.from ?? ''), String(body.text ?? ''), approxLocation) };
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
    this.demoOnly();
    return {
      contactAlerts: this.outboxStub.contactAlerts,
      responderOffers: this.outboxStub.responderOffers,
    };
  }

  /** Every SMS the stub transport "sent" — the phone simulator reads this. */
  @Get('dev/sms-log')
  smsLog() {
    this.demoOnly();
    return this.smsStub.messages;
  }

  /** Seeded responder roster, for the responder app's identity picker. */
  @Get('dev/roster')
  roster() {
    this.demoOnly();
    return this.registry.devRoster();
  }

  /** Server truth: real state + hash-chained event log. Ops eyes only. */
  @Get('dev/sessions/:id/truth')
  truth(@Param('id') id: string) {
    this.demoOnly();
    return this.sessions.opsView(id);
  }
}
