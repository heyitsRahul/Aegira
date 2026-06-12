import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'node:path';
import { StubNotifier } from '../services/notification.service';
import { SessionService } from '../services/session.service';
import { ResponderRegistry } from './responder-registry';
import { NOTIFIER, RESPONDER_REGISTRY, SESSION_SERVICE } from './session.controller';

const PUBLIC_DIR = join(__dirname, '..', '..', 'public');

/**
 * DEV-ONLY surface. Serves the app (/) and demo console (/console), and
 * exposes the stub notifier's outbox — the stand-in for the SMS/push
 * transport that the simulated phones poll — plus the server-side ops
 * view. The ops view reveals duress and must never exist in production
 * wiring (invariant 4).
 */
@Controller()
export class DevController {
  constructor(
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(NOTIFIER) private readonly notifier: StubNotifier,
    @Inject(RESPONDER_REGISTRY) private readonly registry: ResponderRegistry,
  ) {}

  @Get()
  app(@Res() res: Response): void {
    res.sendFile(join(PUBLIC_DIR, 'app.html'));
  }

  @Get('console')
  console(@Res() res: Response): void {
    res.sendFile(join(PUBLIC_DIR, 'console.html'));
  }

  /** Everything the stub notifier "sent" — the simulated phones read this. */
  @Get('dev/outbox')
  outbox() {
    return {
      contactAlerts: this.notifier.contactAlerts,
      responderOffers: this.notifier.responderOffers,
    };
  }

  /** Seeded responder roster, for the responder app's identity picker. */
  @Get('dev/roster')
  roster() {
    return this.registry.all();
  }

  /** Server truth: real state + hash-chained event log. Ops eyes only. */
  @Get('dev/sessions/:id/truth')
  truth(@Param('id') id: string) {
    return this.sessions.opsView(id);
  }
}
