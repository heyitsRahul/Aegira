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
  return payload.locationKnown ? 'Reply SEND to dispatch a verified responder.' : '';
}

export function renderContactAlertSms(payload: ContactAlertPayload): string {
  const category = payload.category.replace(/_/g, ' ');
  const where = whereText(payload);
  if (payload.duress) {
    return (
      `AEGIRA DURESS ALERT: ${payload.helpseekerDisplayName} needs help (${category}). ` +
      `Their phone shows "cancelled" - the cancel was coerced. DO NOT call them. ` +
      where +
      `Live view: ${payload.liveSessionLink} ` +
      sendHint(payload)
    );
  }
  if (payload.watchExpired) {
    return (
      `AEGIRA: ${payload.helpseekerDisplayName} did not check in from their journey (${category}) ` +
      `and may need help. ${where}Live view: ${payload.liveSessionLink} ` +
      sendHint(payload)
    );
  }
  if (payload.escalation) {
    return (
      `AEGIRA ESCALATION: ${payload.helpseekerDisplayName} still has no responder (${category}). ` +
      `${where}Live view: ${payload.liveSessionLink} ` +
      sendHint(payload)
    );
  }
  return (
    `AEGIRA ALERT: ${payload.helpseekerDisplayName} needs help (${category}). ` +
    `${where}Live view: ${payload.liveSessionLink} ` +
    sendHint(payload)
  );
}

export function renderResponderOfferSms(payload: ResponderOfferPayload): string {
  const category = payload.category.replace(/_/g, ' ');
  return (
    `AEGIRA DISPATCH: ${payload.alias} needs help (${category}) in area ` +
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
