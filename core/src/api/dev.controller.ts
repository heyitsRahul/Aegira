import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'node:path';
import { StubNotifier } from '../services/notification.service';
import { SessionService } from '../services/session.service';
import { NOTIFIER, SESSION_SERVICE } from './session.controller';

/**
 * DEV-ONLY surface backing the demo console (public/index.html). It
 * exposes the stub notifier's outbox (simulating the contact's and
 * responder's phones) and the server-side ops view (event chain + true
 * state). None of this may exist in production wiring: the ops view
 * reveals duress, which must never be client-visible there (invariant 4).
 */
@Controller()
export class DevController {
  constructor(
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(NOTIFIER) private readonly notifier: StubNotifier,
  ) {}

  @Get()
  console(@Res() res: Response): void {
    res.sendFile(join(__dirname, '..', '..', 'public', 'index.html'));
  }

  /** Everything the stub notifier "sent" — the simulated phones read this. */
  @Get('dev/outbox')
  outbox() {
    return {
      contactAlerts: this.notifier.contactAlerts,
      responderOffers: this.notifier.responderOffers,
    };
  }

  /** Server truth: real state + hash-chained event log. Ops eyes only. */
  @Get('dev/sessions/:id/truth')
  truth(@Param('id') id: string) {
    return this.sessions.opsView(id);
  }
}
