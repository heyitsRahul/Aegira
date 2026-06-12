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

export function renderContactAlertSms(payload: ContactAlertPayload): string {
  const category = payload.category.replace(/_/g, ' ');
  if (payload.duress) {
    return (
      `SAHAY DURESS ALERT: ${payload.helpseekerDisplayName} needs help (${category}). ` +
      `Their phone shows "cancelled" - the cancel was coerced. DO NOT call them. ` +
      `Live view: ${payload.liveSessionLink} ` +
      `Reply SEND to dispatch a verified responder.`
    );
  }
  if (payload.escalation) {
    return (
      `SAHAY ESCALATION: ${payload.helpseekerDisplayName} still has no responder (${category}). ` +
      `Live view: ${payload.liveSessionLink} ` +
      `Reply SEND to dispatch a verified responder.`
    );
  }
  return (
    `SAHAY ALERT: ${payload.helpseekerDisplayName} needs help (${category}). ` +
    `Live view: ${payload.liveSessionLink} ` +
    `Reply SEND to dispatch a verified responder.`
  );
}

export function renderResponderOfferSms(payload: ResponderOfferPayload): string {
  const category = payload.category.replace(/_/g, ' ');
  return (
    `SAHAY DISPATCH: ${payload.alias} needs help (${category}) in area ` +
    `${payload.coarseCell} (~1 km). Open the responder app to accept.`
  );
}

/** Notifier that delivers over SMS. */
export class SmsNotifier implements Notifier {
  constructor(private readonly transport: SmsTransport) {}

  async sendContactAlert(payload: ContactAlertPayload): Promise<void> {
    await this.transport.send(payload.to, renderContactAlertSms(payload), payload.sentAt);
  }

  async sendResponderOffer(payload: ResponderOfferPayload): Promise<void> {
    await this.transport.send(payload.to, renderResponderOfferSms(payload), payload.sentAt);
  }
}

/** Fans every notification out to all channels (app stub + SMS, etc.). */
export class CompositeNotifier implements Notifier {
  private readonly notifiers: readonly Notifier[];

  constructor(...notifiers: Notifier[]) {
    this.notifiers = notifiers;
  }

  async sendContactAlert(payload: ContactAlertPayload): Promise<void> {
    for (const notifier of this.notifiers) {
      await notifier.sendContactAlert(payload);
    }
  }

  async sendResponderOffer(payload: ResponderOfferPayload): Promise<void> {
    for (const notifier of this.notifiers) {
      await notifier.sendResponderOffer(payload);
    }
  }
}
