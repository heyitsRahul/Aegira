import { Body, Controller, Get, Headers, Inject, Param, Post, Query } from '@nestjs/common';
import { SessionService, TriggerInput } from '../services/session.service';
import { ResponderRegistry } from './responder-registry';

export const SESSION_SERVICE = 'SESSION_SERVICE';
export const RESPONDER_REGISTRY = 'RESPONDER_REGISTRY';
export const NOTIFIER = 'NOTIFIER';

const bearer = (header: string | undefined): string | null =>
  header?.startsWith('Bearer ') ? header.slice(7) : null;

/**
 * Thin HTTP surface: every route authorizes, then delegates — no other
 * logic. Capability model:
 *  - seeker routes:    Authorization: Bearer <seekerToken from trigger>
 *  - contact routes:   ?t=<token embedded in the alert's live link>
 *  - responder routes: x-responder-token header, checked by the registry
 * Deliberately absent (invariant 5): any route that enumerates sessions
 * by area or time. Sessions are only addressable by id.
 */
@Controller('sessions')
export class SessionController {
  constructor(
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(RESPONDER_REGISTRY) private readonly responders: ResponderRegistry,
  ) {}

  @Post()
  trigger(@Body() body: TriggerInput) {
    return this.sessions.trigger(body);
  }

  @Post('watch')
  watch(@Body() body: TriggerInput & { etaMinutes?: number }) {
    const etaMs = Math.round((body.etaMinutes ?? 0) * 60 * 1000);
    return this.sessions.startWatch(body, etaMs);
  }

  @Post(':id/checkin')
  checkin(
    @Param('id') id: string,
    @Body() body: { pin: string },
    @Headers('authorization') auth?: string,
  ) {
    this.sessions.authorizeSeeker(id, bearer(auth));
    return this.sessions.checkInSafe(id, body.pin);
  }

  @Post(':id/extend')
  extend(
    @Param('id') id: string,
    @Body() body: { minutes: number },
    @Headers('authorization') auth?: string,
  ) {
    this.sessions.authorizeSeeker(id, bearer(auth));
    return this.sessions.extendWatch(id, Math.round((body.minutes ?? 0) * 60 * 1000));
  }

  @Post(':id/confirm')
  confirm(@Param('id') id: string, @Headers('authorization') auth?: string) {
    this.sessions.authorizeSeeker(id, bearer(auth));
    return this.sessions.confirm(id);
  }

  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() body: { pin: string },
    @Headers('authorization') auth?: string,
  ) {
    this.sessions.authorizeSeeker(id, bearer(auth));
    return this.sessions.cancel(id, body.pin);
  }

  @Get(':id')
  status(@Param('id') id: string, @Headers('authorization') auth?: string) {
    this.sessions.authorizeSeeker(id, bearer(auth));
    return this.sessions.clientStatus(id);
  }

  @Post(':id/location')
  location(
    @Param('id') id: string,
    @Body() body: { lat: number; lng: number },
    @Headers('authorization') auth?: string,
  ) {
    this.sessions.authorizeSeeker(id, bearer(auth));
    this.sessions.recordLocation(id, body.lat, body.lng);
    return { recorded: true };
  }

  @Post(':id/dispatch')
  dispatch(
    @Param('id') id: string,
    @Headers('authorization') auth?: string,
    @Query('t') contactToken?: string,
  ) {
    this.sessions.authorizeSeekerOrContact(id, bearer(auth), contactToken ?? null);
    return this.sessions.dispatch(id, this.responders.all());
  }

  @Get(':id/arrival-code')
  arrivalCode(@Param('id') id: string, @Headers('authorization') auth?: string) {
    this.sessions.authorizeSeeker(id, bearer(auth));
    return { code: this.sessions.getArrivalCode(id) };
  }

  @Get(':id/contact-view')
  contactView(@Param('id') id: string, @Query('t') token?: string) {
    this.sessions.authorizeContact(id, token ?? null);
    return this.sessions.contactView(id);
  }

  @Get(':id/responder-view/:responderId')
  responderView(
    @Param('id') id: string,
    @Param('responderId') responderId: string,
    @Headers('x-responder-token') token?: string,
  ) {
    this.responders.authenticate(responderId, token);
    return this.sessions.responderView(id, responderId);
  }

  @Get(':id/dispatch-location/:responderId')
  dispatchLocation(
    @Param('id') id: string,
    @Param('responderId') responderId: string,
    @Headers('x-responder-token') token?: string,
  ) {
    this.responders.authenticate(responderId, token);
    return this.sessions.getDispatchLocation(id, responderId);
  }

  @Post(':id/accept')
  accept(
    @Param('id') id: string,
    @Body() body: { responderId: string },
    @Headers('x-responder-token') token?: string,
  ) {
    this.responders.authenticate(body.responderId, token);
    return this.sessions.accept(id, body.responderId);
  }

  @Post(':id/withdraw')
  withdraw(
    @Param('id') id: string,
    @Body() body: { responderId: string },
    @Headers('x-responder-token') token?: string,
  ) {
    this.responders.authenticate(body.responderId, token);
    return this.sessions.withdraw(id, body.responderId);
  }

  @Post(':id/arrival')
  arrival(
    @Param('id') id: string,
    @Body() body: { responderId: string; code: string },
    @Headers('x-responder-token') token?: string,
  ) {
    this.responders.authenticate(body.responderId, token);
    return this.sessions.verifyArrival(id, body.responderId, body.code);
  }

  @Post(':id/resolve')
  resolve(
    @Param('id') id: string,
    @Body() body: { pin: string },
    @Headers('authorization') auth?: string,
  ) {
    this.sessions.authorizeSeeker(id, bearer(auth));
    return this.sessions.resolve(id, body?.pin);
  }
}
