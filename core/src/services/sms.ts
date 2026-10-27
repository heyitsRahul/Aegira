import {
  ContactAlertPayload,
  Notifier,
  ResponderOfferPayload,
} from './notification.service';

/**
 * SMS channel for phones with no app and no browser. Outbound texts are
 * rendered from the SAME closed payload types the app uses, so the privacy
 * properties carry over: a responder SMS holds an alias and a coarse cell,
 * never a name, number, or coordinate. Tests assert on the rendered text.
 */

export interface SmsMessage {
  readonly to: string;
  readonly text: string;
  readonly sentAt: string;
}

/** Production: an SMS provider adapter. Dev: the stub below. */
export interface SmsTransport {
  send(to: string, text: string, sentAt: string): Promise<void>;
}

export class StubSmsTransport implements SmsTransport {
  readonly messages: SmsMessage[] = [];

  async send(to: string, text: string, sentAt: string): Promise<void> {
    this.messages.push({ to, text, sentAt });
  }
}

/** Everyday words for each category, as they appear in alert texts. */
const CATEGORY_WORDS: Readonly<Record<string, string>> = {
  personal_safety: 'danger',
  medical: 'medical',
  accident: 'accident',
  other: 'other',
};

/**
 * Where they are, in words: their own description if they gave one, and a
 * plain warning when the phone sent no position (basic-phone SOS).
 */
function whereText(payload: ContactAlertPayload): string {
  const said = payload.placeNote === null ? '' : `They said: "${payload.placeNote}". `;
  if (payload.locationKnown) {
    return said;
  }
  return said + (payload.duress ? 'Location unknown. ' : 'Location unknown - call them. ');
}

/** Only offer SEND when a helper could actually be matched. */
function sendHint(payload: ContactAlertPayload): string {
  return payload.locationKnown ? 'Reply SEND to send a trained helper.' : '';
}

export function renderContactAlertSms(payload: ContactAlertPayload): string {
  const category = CATEGORY_WORDS[payload.category] ?? payload.category.replace(/_/g, ' ');
  const where = whereText(payload);
  if (payload.duress) {
    return (
      `AEGIRA SECRET ALARM: ${payload.helpseekerDisplayName} needs help (${category}). ` +
      `They used their secret PIN: someone may be forcing them. DO NOT call them. ` +
      where +
      `See where: ${payload.liveSessionLink} ` +
      sendHint(payload)
    );
  }
  if (payload.watchExpired) {
    return (
      `AEGIRA: ${payload.helpseekerDisplayName} did not reach on time and may need help. ` +
      `${where}See where: ${payload.liveSessionLink} ` +
      sendHint(payload)
    );
  }
  if (payload.escalation) {
    return (
      `AEGIRA: ${payload.helpseekerDisplayName} still needs help (${category}). Please act now. ` +
      `${where}See where: ${payload.liveSessionLink} ` +
      sendHint(payload)
    );
  }
  return (
    `AEGIRA ALERT: ${payload.helpseekerDisplayName} needs help (${category}). ` +
    `${where}See where: ${payload.liveSessionLink} ` +
    sendHint(payload)
  );
}

export function renderResponderOfferSms(payload: ResponderOfferPayload): string {
  const category = CATEGORY_WORDS[payload.category] ?? payload.category.replace(/_/g, ' ');
  return (
    `AEGIRA DISPATCH: someone needs help (${category}) near area ${payload.coarseCell} ` +
    `(about 1 km). Ref ${payload.alias}. Open the helper app to say you will go.`
  );
}

/**
 * Notifier that delivers over SMS. Responder offers are addressed by
 * responder id, which the simulator understands but a real carrier does
 * not, so real-SMS channels pass `responderOffers: false`.
 */
export class SmsNotifier implements Notifier {
  constructor(
    private readonly transport: SmsTransport,
    private readonly options: { responderOffers: boolean } = { responderOffers: true },
  ) {}

  async sendContactAlert(payload: ContactAlertPayload): Promise<void> {
    await this.transport.send(payload.to, renderContactAlertSms(payload), payload.sentAt);
  }

  async sendResponderOffer(payload: ResponderOfferPayload): Promise<void> {
    if (!this.options.responderOffers) {
      return;
    }
    await this.transport.send(payload.to, renderResponderOfferSms(payload), payload.sentAt);
  }
}

/**
 * Fans every notification out to all channels (app stub + SMS, etc.). One
 * channel failing (a carrier outage, the gateway phone offline) must never
 * stop the others or the emergency itself: failures are counted, not thrown.
 */
export class CompositeNotifier implements Notifier {
  private readonly notifiers: readonly Notifier[];
  private onFailure: () => void = () => {};

  constructor(...notifiers: Notifier[]) {
    this.notifiers = notifiers;
  }

  /** Called once per failed channel delivery (e.g. to count a metric). */
  onChannelFailure(handler: () => void): this {
    this.onFailure = handler;
    return this;
  }

  async sendContactAlert(payload: ContactAlertPayload): Promise<void> {
    for (const notifier of this.notifiers) {
      await this.attempt(() => notifier.sendContactAlert(payload));
    }
  }

  async sendResponderOffer(payload: ResponderOfferPayload): Promise<void> {
    for (const notifier of this.notifiers) {
      await this.attempt(() => notifier.sendResponderOffer(payload));
    }
  }

  private async attempt(send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch {
      this.onFailure();
    }
  }
}
