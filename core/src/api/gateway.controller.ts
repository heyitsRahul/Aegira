import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { NotAuthenticatedError } from '../domain/errors';
import { Clock } from '../domain/types';
import {
  AndroidGatewayConfig,
  parseAndroidWebhook,
  verifyAndroidGatewaySignature,
} from '../services/android-gateway';
import { SmsTransport } from '../services/sms';
import { SmsGatewayService } from '../services/sms-gateway.service';
import { twimlMessage, verifyTwilioSignature } from '../services/twilio';
import { tokenMatches } from './runtime-config';

export const SMS_GATEWAY = 'SMS_GATEWAY';
export const GATEWAY_SECRET = 'GATEWAY_SECRET';
export const TWILIO_AUTH_TOKEN = 'TWILIO_AUTH_TOKEN';
export const PUBLIC_BASE_URL = 'PUBLIC_BASE_URL';
export const ALLOW_UNSIGNED_WEBHOOKS = 'ALLOW_UNSIGNED_WEBHOOKS';
export const ANDROID_GATEWAY = 'ANDROID_GATEWAY';
export const GATEWAY_CLOCK = 'GATEWAY_CLOCK';

/** The Android SIM gateway, when configured: its settings + reply channel. */
export interface AndroidGatewayWiring {
  config: AndroidGatewayConfig;
  reply: SmsTransport;
}

/** Webhook senders retry on failure; remember recent ids to act once. */
const SEEN_LIMIT = 500;

/**
 * Inbound webhooks for SMS providers. Three shapes:
 *
 *  - POST /gateway/sms     — a simple JSON webhook (used by the /phone
 *    simulator and any provider you adapt), authenticated by a shared secret.
 *    Carries an optional approximate position the carrier supplied.
 *  - POST /gateway/twilio  — Twilio's native form-encoded webhook, authenticated
 *    by verifying the X-Twilio-Signature, replying with TwiML.
 *  - POST /gateway/android — an Android phone + ordinary SIM running "SMS
 *    Gateway for Android": HMAC-signed webhook; the reply goes back out as
 *    a normal SMS through the same phone.
 *
 * Location only ever enters with an SOS/WATCH (invariant 1). Twilio and the
 * Android gateway supply no coordinates, so those sessions start with no
 * location: contacts are alerted and told so (architecture §3.2).
 */
@Controller('gateway')
export class GatewayController {
  constructor(
    @Inject(SMS_GATEWAY) private readonly gateway: SmsGatewayService,
    @Inject(GATEWAY_SECRET) private readonly secret: string | null,
    @Inject(TWILIO_AUTH_TOKEN) private readonly twilioAuthToken: string | null,
    @Inject(PUBLIC_BASE_URL) private readonly baseUrl: string,
    @Inject(ALLOW_UNSIGNED_WEBHOOKS) private readonly allowUnsigned: boolean,
    @Inject(ANDROID_GATEWAY) private readonly android: AndroidGatewayWiring | null,
    @Inject(GATEWAY_CLOCK) private readonly clock: Clock,
  ) {}

  private readonly seenEnvelopes: string[] = [];

  @Post('sms')
  async inbound(
    @Body() body: { from: string; text: string; approxLat?: number; approxLng?: number },
    @Headers('x-gateway-secret') secret?: string,
  ) {
    // No secret configured (the production default) = webhook closed.
    if (!tokenMatches(secret, this.secret)) {
      throw new NotAuthenticatedError();
    }
    const approxLocation =
      typeof body.approxLat === 'number' && typeof body.approxLng === 'number'
        ? { lat: body.approxLat, lng: body.approxLng }
        : undefined;
    return { reply: await this.gateway.handle(body.from, body.text, approxLocation) };
  }

  @Post('twilio')
  @Header('content-type', 'text/xml')
  async twilio(
    @Body() body: Record<string, string>,
    @Req() req: Request,
    @Headers('x-twilio-signature') signature?: string,
  ): Promise<string> {
    // Verify the request really came from Twilio. With no auth token
    // configured, unsigned requests are accepted in local dev only.
    if (this.twilioAuthToken === null) {
      if (!this.allowUnsigned) {
        throw new NotAuthenticatedError();
      }
    } else {
      const url = `${this.baseUrl}${req.originalUrl}`;
      if (!verifyTwilioSignature(this.twilioAuthToken, url, body, signature)) {
        throw new NotAuthenticatedError();
      }
    }
    const reply = await this.gateway.handle(body.From ?? '', body.Body ?? '');
    return twimlMessage(reply);
  }

  @Post('android')
  @HttpCode(200)
  async androidInbound(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
    @Headers('x-signature') signature?: string,
    @Headers('x-timestamp') timestamp?: string,
  ): Promise<{ ok: true }> {
    const android = this.android;
    if (android === null) {
      throw new NotFoundException();
    }
    if (android.config.signingKey === null) {
      if (!this.allowUnsigned) {
        throw new NotAuthenticatedError();
      }
    } else {
      const raw = req.rawBody?.toString('utf8') ?? '';
      const now = Math.floor(this.clock.now().getTime() / 1000);
      if (!verifyAndroidGatewaySignature(android.config.signingKey, raw, timestamp, signature, now)) {
        throw new NotAuthenticatedError();
      }
    }
    const sms = parseAndroidWebhook(body);
    if (sms === null) {
      return { ok: true }; // delivery reports, pings: nothing to do
    }
    if (sms.envelopeId !== '') {
      if (this.seenEnvelopes.includes(sms.envelopeId)) {
        return { ok: true };
      }
      this.seenEnvelopes.push(sms.envelopeId);
      if (this.seenEnvelopes.length > SEEN_LIMIT) {
        this.seenEnvelopes.shift();
      }
    }
    const reply = await this.gateway.handle(sms.sender, sms.message);
    await android.reply.send(sms.sender, reply, this.clock.now().toISOString());
    return { ok: true };
  }
}
