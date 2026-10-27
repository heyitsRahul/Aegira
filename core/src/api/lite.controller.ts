import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ActiveSessionExistsError,
  CancelNotAllowedError,
  InvalidInputError,
  InvalidPinError,
  DomainError,
  LocationUnknownError,
  NotAuthenticatedError,
  SessionNotFoundError,
} from '../domain/errors';
import { RegistrationService } from '../services/registration.service';
import { SessionService } from '../services/session.service';
import {
  applyDial,
  cancelledPage,
  contactViewPage,
  homePage,
  LITE_AREAS,
  messagePage,
  sosAcceptedPage,
  statusPage,
} from './lite-views';
import { ResponderRegistry } from './responder-registry';
import { RESPONDER_REGISTRY, SESSION_SERVICE } from './session.controller';

export const REGISTRATIONS = 'REGISTRATIONS';

/** Error text for people: drop the technical "invalid input:" prefix. */
const plain = (message: string): string => message.replace(/^invalid input: /, '');

/**
 * The lite channel answers every error with a readable page, never the
 * JSON the app gets: a mistyped phone number on an old phone must still
 * show a way back.
 */
@Catch(DomainError)
export class LiteErrorFilter implements ExceptionFilter {
  catch(error: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const notFound = error instanceof SessionNotFoundError;
    const denied = error instanceof NotAuthenticatedError;
    response
      .status(notFound ? 404 : denied ? 401 : 400)
      .type('html')
      .send(
        notFound
          ? messagePage('Not found', 'This link has ended or is not right.')
          : denied
            ? messagePage('Link not allowed', 'This link is not right. Use the link in your message.')
            : messagePage('Please check', `${plain(error.message)}. Go back and try again.`),
      );
  }
}

/**
 * Where a lite session starts: a listed area if chosen, plus the place in
 * the user's own words. "Not listed" sends no coordinates at all rather
 * than a wrong guess — contacts are told the location is unknown.
 */
function startWhere(
  areaId: string | undefined,
  place: string | undefined,
): { location?: { lat: number; lng: number }; placeNote?: string } {
  const area = LITE_AREAS.find((a) => a.id === areaId);
  const note = (place ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  return {
    ...(area === undefined ? {} : { location: { lat: area.lat, lng: area.lng } }),
    ...(note.length > 0 ? { placeNote: note } : {}),
  };
}

const STATE_TEXT: Record<string, string> = {
  WATCHING: 'Your timer is on. When you reach, say so below. Need more time? Add it below.',
  PENDING: 'Help is starting. You can still cancel with your PIN.',
  ACTIVE: 'Your people have been told. Help is coming.',
  DISPATCHED: 'A trained helper is on the way.',
  ARRIVED: 'Your helper is with you.',
  RESOLVED: 'You are safe. Take care.',
  CANCELLED: 'Nothing is running right now.',
  CLOSED: 'Nothing is running right now.',
  PURGED: 'Nothing is running right now.',
};

/**
 * The zero-JavaScript channel: plain HTML forms for browsers that predate
 * fetch/Promise (Opera Mini, KaiOS, old stock Android). Same service, same
 * invariants — phone number + PIN is the credential, exactly like SMS, and
 * the cancel result page is one shared render for safe and duress.
 */
@Controller('lite')
@UseFilters(LiteErrorFilter)
export class LiteController {
  constructor(
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(REGISTRATIONS) private readonly registrations: RegistrationService,
    @Inject(RESPONDER_REGISTRY) private readonly responders: ResponderRegistry,
  ) {}

  @Get()
  home(): string {
    return homePage();
  }

  @Post('register')
  register(
    @Body()
    body: {
      phone?: string;
      name?: string;
      contact?: string;
      pinSafe?: string;
      pinDuress?: string;
      dial?: string;
    },
  ): string {
    // Apply the chosen country dial code to nationally-typed numbers, so a
    // user anywhere can register without typing the +code themselves.
    try {
      const record = this.registrations.register(
        applyDial(body.phone ?? '', body.dial),
        body.name ?? '',
        applyDial(body.contact ?? '', body.dial),
        body.pinSafe ?? '',
        body.pinDuress ?? '',
      );
      return messagePage(
        'You are signed up',
        `Welcome ${record.displayName}. In danger, use “I need help now” on the start page, or send SOS by SMS.`,
      );
    } catch (error) {
      if (error instanceof InvalidInputError) {
        return messagePage('Could not sign up', plain(error.message));
      }
      throw error;
    }
  }

  @Post('sos')
  sos(
    @Body() body: { phone?: string; area?: string; place?: string; category?: string; dial?: string },
  ): string {
    const registration = this.registrations.find(applyDial(body.phone ?? '', body.dial));
    if (registration === undefined) {
      return messagePage('Please sign up first', 'Fill in “First time? Sign up” at the bottom of the start page.');
    }
    const where = startWhere(body.area, body.place);
    try {
      const receipt = this.sessions.trigger({
        userId: registration.phoneRef,
        displayName: registration.displayName,
        contacts: registration.contacts,
        ...where,
        category:
          body.category === 'medical' || body.category === 'accident' || body.category === 'other'
            ? body.category
            : 'personal_safety',
        pinHashes: { safe: registration.pinSafeHash, duress: registration.pinDuressHash },
      });
      return sosAcceptedPage(Math.round(receipt.activationCountdownMs / 1000));
    } catch (error) {
      if (error instanceof ActiveSessionExistsError) {
        return messagePage('Help is already running', 'You already asked for help. Check what is happening below.', true);
      }
      throw error;
    }
  }

  @Post('watch')
  watch(
    @Body() body: { phone?: string; area?: string; place?: string; minutes?: string; dial?: string },
  ): string {
    const registration = this.registrations.find(applyDial(body.phone ?? '', body.dial));
    if (registration === undefined) {
      return messagePage('Please sign up first', 'Fill in “First time? Sign up” at the bottom of the start page.');
    }
    const where = startWhere(body.area, body.place);
    const minutes = Number(body.minutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return messagePage('How many minutes?', 'Type how many minutes it will take you to reach.');
    }
    try {
      this.sessions.startWatch(
        {
          userId: registration.phoneRef,
          displayName: registration.displayName,
          contacts: registration.contacts,
          ...where,
          category: 'personal_safety',
          pinHashes: { safe: registration.pinSafeHash, duress: registration.pinDuressHash },
        },
        Math.round(minutes * 60 * 1000),
      );
      return messagePage(
        'Timer started',
        `Your timer is on for ${minutes} minutes. When you reach, press CHECK and say you ` +
          'reached. If you do not, your people get a message.',
        true,
      );
    } catch (error) {
      if (error instanceof ActiveSessionExistsError) {
        return messagePage('Help is already running', 'You already asked for help. Check what is happening below.', true);
      }
      throw error;
    }
  }

  @Post('extend')
  extend(@Body() body: { phone?: string; pin?: string; minutes?: string; dial?: string }): string {
    const phone = applyDial(body.phone ?? '', body.dial);
    if (this.registrations.verifyPin(phone, body.pin ?? '') === 'invalid') {
      return messagePage('Wrong PIN', 'That PIN is not right. Go back and try again.');
    }
    const registration = this.registrations.find(phone);
    const sessionId =
      registration === undefined
        ? null
        : this.sessions.latestSessionIdForUser(registration.phoneRef);
    const minutes = Number(body.minutes);
    if (sessionId === null || !Number.isFinite(minutes) || minutes <= 0) {
      return messagePage('No timer', 'No timer is running.');
    }
    try {
      this.sessions.extendWatch(sessionId, Math.round(minutes * 60 * 1000));
      return messagePage('More time added', `OK, ${minutes} more minutes.`, true);
    } catch {
      return messagePage('No timer', 'No timer is running.');
    }
  }

  @Post('cancel')
  async cancel(@Body() body: { phone?: string; pin?: string; dial?: string }): Promise<string> {
    const registration = this.registrations.find(applyDial(body.phone ?? '', body.dial));
    const sessionId =
      registration === undefined
        ? null
        : this.sessions.latestSessionIdForUser(registration.phoneRef);
    if (sessionId === null) {
      return messagePage('Nothing running', 'Nothing is running right now.');
    }
    try {
      await this.sessions.cancel(sessionId, body.pin ?? '');
      // One shared page for safe and duress cancels (invariant 4).
      return cancelledPage();
    } catch (error) {
      if (error instanceof InvalidPinError) {
        return messagePage('Wrong PIN', 'That PIN is not right. Go back and try again.');
      }
      if (error instanceof CancelNotAllowedError) {
        return messagePage('Too late to cancel', 'Help has already been sent, so it cannot be cancelled now.');
      }
      throw error;
    }
  }

  @Post('status')
  status(@Body() body: { phone?: string; pin?: string; dial?: string }): string {
    const phone = applyDial(body.phone ?? '', body.dial);
    if (this.registrations.verifyPin(phone, body.pin ?? '') === 'invalid') {
      return messagePage('Wrong PIN', 'That PIN is not right. Go back and try again.');
    }
    const registration = this.registrations.find(phone);
    const sessionId =
      registration === undefined
        ? null
        : this.sessions.latestSessionIdForUser(registration.phoneRef);
    if (sessionId === null) {
      return statusPage('No active session.', false);
    }
    // Masked view: a duress session reads as cancelled/resolved here too.
    const state = this.sessions.clientStatus(sessionId).state;
    const live =
      state === 'WATCHING' ||
      state === 'ACTIVE' ||
      state === 'DISPATCHED' ||
      state === 'ARRIVED';
    return statusPage(STATE_TEXT[state] ?? state, live, state === 'WATCHING');
  }

  @Post('safe')
  async safe(@Body() body: { phone?: string; pin?: string; dial?: string }): Promise<string> {
    const phone = applyDial(body.phone ?? '', body.dial);
    const registration = this.registrations.find(phone);
    const sessionId =
      registration === undefined
        ? null
        : this.sessions.latestSessionIdForUser(registration.phoneRef);
    if (sessionId === null) {
      return messagePage('Nothing running', 'Nothing is running right now.');
    }
    const state = this.sessions.opsView(sessionId).state;
    // On a journey watch, "mark safe" is the check-in: safe PIN ends it,
    // duress PIN escalates, and both render this identical page (invariant 4).
    if (state === 'WATCHING') {
      try {
        await this.sessions.checkInSafe(sessionId, body.pin ?? '');
        return messagePage('You reached safely', 'Good. Take care.');
      } catch {
        return messagePage('Wrong PIN', 'That PIN is not right. Go back and try again.');
      }
    }
    if (this.registrations.verifyPin(phone, body.pin ?? '') !== 'safe') {
      return messagePage('Wrong PIN', 'That PIN is not right. Go back and try again.');
    }
    if (state !== 'ACTIVE' && state !== 'DISPATCHED' && state !== 'ARRIVED') {
      return messagePage('Nothing running', 'Nothing is running right now.');
    }
    this.sessions.resolve(sessionId);
    return messagePage('You are safe', 'Good. Take care.');
  }

  /** Contact live view — the link in alert SMS works on any browser. */
  @Get('c/:id')
  contact(@Param('id') id: string, @Query('t') token?: string): string {
    this.sessions.authorizeContact(id, token ?? null);
    const view = this.sessions.contactView(id);
    return contactViewPage({
      helpseekerDisplayName: view.helpseekerDisplayName || 'Session',
      state: view.state,
      duress: view.duress,
      category: view.category,
      location: view.location,
      placeNote: view.placeNote,
      canDispatch: view.state === 'ACTIVE' && view.location !== null,
      sessionId: id,
      token: token ?? '',
    });
  }

  @Post('c/:id/dispatch')
  async contactDispatch(@Param('id') id: string, @Query('t') token?: string): Promise<string> {
    this.sessions.authorizeSeekerOrContact(id, null, token ?? null);
    let asked = 0;
    try {
      asked = (await this.sessions.dispatch(id, this.responders.all())).length;
    } catch (error) {
      if (error instanceof LocationUnknownError) {
        return messagePage(
          'We do not know where they are',
          'So no helper can go. Call them, or call 112.',
        );
      }
      throw error;
    }
    if (asked === 0) {
      return messagePage('No helper close by', 'No trained helper is near them right now. Call them, or call 112.');
    }
    return messagePage('Helper asked', 'We have asked trained helpers to go.');
  }
}
