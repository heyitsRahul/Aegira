import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { SessionService, TriggerInput } from '../services/session.service';
import { ResponderRegistry } from './responder-registry';

export const SESSION_SERVICE = 'SESSION_SERVICE';
export const RESPONDER_REGISTRY = 'RESPONDER_REGISTRY';

/**
 * Thin HTTP surface: every route is a single delegation to the service.
 * Deliberately absent (invariant 5): any route that enumerates sessions
 * by area or time. Sessions are only addressable by id, by their own
 * participants.
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

  @Post(':id/confirm')
  confirm(@Param('id') id: string) {
    return this.sessions.confirm(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() body: { pin: string }) {
    return this.sessions.cancel(id, body.pin);
  }

  @Get(':id')
  status(@Param('id') id: string) {
    return this.sessions.clientStatus(id);
  }

  @Post(':id/location')
  location(@Param('id') id: string, @Body() body: { lat: number; lng: number }) {
    this.sessions.recordLocation(id, body.lat, body.lng);
    return { recorded: true };
  }

  @Post(':id/dispatch')
  dispatch(@Param('id') id: string) {
    return this.sessions.dispatch(id, this.responders.all());
  }

  @Post(':id/accept')
  accept(@Param('id') id: string, @Body() body: { responderId: string }) {
    return this.sessions.accept(id, body.responderId);
  }

  @Get(':id/arrival-code')
  arrivalCode(@Param('id') id: string) {
    return { code: this.sessions.getArrivalCode(id) };
  }

  @Get(':id/dispatch-location/:responderId')
  dispatchLocation(@Param('id') id: string, @Param('responderId') responderId: string) {
    return this.sessions.getDispatchLocation(id, responderId);
  }

  @Post(':id/arrival')
  arrival(@Param('id') id: string, @Body() body: { responderId: string; code: string }) {
    return this.sessions.verifyArrival(id, body.responderId, body.code);
  }

  @Post(':id/resolve')
  resolve(@Param('id') id: string) {
    return this.sessions.resolve(id);
  }
}
