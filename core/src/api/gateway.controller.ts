import { Body, Controller, Header, Headers, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { NotAuthenticatedError } from '../domain/errors';
import { SmsGatewayService } from '../services/sms-gateway.service';
import { twimlMessage, verifyTwilioSignature } from '../services/twilio';
import { tokenMatches } from './runtime-config';

export const SMS_GATEWAY = 'SMS_GATEWAY';
export const GATEWAY_SECRET = 'GATEWAY_SECRET';
export const TWILIO_AUTH_TOKEN = 'TWILIO_AUTH_TOKEN';
export const PUBLIC_BASE_URL = 'PUBLIC_BASE_URL';
export const ALLOW_UNSIGNED_TWILIO = 'ALLOW_UNSIGNED_TWILIO';

/**
 * Inbound webhooks for the SMS provider. Two shapes:
 *
 *  - POST /gateway/sms     — a simple JSON webhook (used by the /phone
 *    simulator and any provider you adapt), authenticated by a shared secret.
 *    Carries an optional approximate position the carrier supplied.
 *  - POST /gateway/twilio  — Twilio's native form-encoded webhook, authenticated
 *    by verifying the X-Twilio-Signature, replying with TwiML.
 *
 * Either way, location only ever enters with an SOS/WATCH (invariant 1); Twilio
 * does not supply coordinates, so SMS triggers over Twilio rely on the carrier
 * integration or in-app location and otherwise report position unavailable.
 */
@Controller('gateway')
export class GatewayController {
  constructor(
    @Inject(SMS_GATEWAY) private readonly gateway: SmsGatewayService,
    @Inject(GATEWAY_SECRET) private readonly secret: string | null,
    @Inject(TWILIO_AUTH_TOKEN) private readonly twilioAuthToken: string | null,
    @Inject(PUBLIC_BASE_URL) private readonly baseUrl: string,
    @Inject(ALLOW_UNSIGNED_TWILIO) private readonly allowUnsignedTwilio: boolean,
  ) {}

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
      if (!this.allowUnsignedTwilio) {
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
}
