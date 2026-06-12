import { Body, Controller, Headers, Inject, Post } from '@nestjs/common';
import { NotAuthenticatedError } from '../domain/errors';
import { SmsGatewayService } from '../services/sms-gateway.service';

export const SMS_GATEWAY = 'SMS_GATEWAY';
export const GATEWAY_SECRET = 'GATEWAY_SECRET';

/**
 * Inbound webhook for the SMS provider (Twilio/MSG91-shaped). The provider
 * forwards the sender, the text, and — where the carrier offers it — an
 * approximate network position, which is the only way location ever enters
 * via this channel (with the SOS, never with the registration).
 * Authenticated by a shared secret; production verifies provider
 * signatures instead.
 */
@Controller('gateway')
export class GatewayController {
  constructor(
    @Inject(SMS_GATEWAY) private readonly gateway: SmsGatewayService,
    @Inject(GATEWAY_SECRET) private readonly secret: string,
  ) {}

  @Post('sms')
  async inbound(
    @Body() body: { from: string; text: string; approxLat?: number; approxLng?: number },
    @Headers('x-gateway-secret') secret?: string,
  ) {
    if (secret !== this.secret) {
      throw new NotAuthenticatedError();
    }
    const approxLocation =
      typeof body.approxLat === 'number' && typeof body.approxLng === 'number'
        ? { lat: body.approxLat, lng: body.approxLng }
        : undefined;
    return { reply: await this.gateway.handle(body.from, body.text, approxLocation) };
  }
}
