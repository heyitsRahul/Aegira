import { SessionCategory } from '../domain/types';

/**
 * Notification payload types and the Notifier port. Payload interfaces are
 * deliberately closed (no index signatures): a name, phone number, or
 * precise coordinate cannot be added to a responder payload without
 * changing the type — and the privacy-negative tests assert on the wire
 * shape as well.
 */

/**
 * Sent to the helpseeker's own trusted contacts on activation. Contains
 * the helpseeker's name (contacts know them) but never raw coordinates:
 * live location is viewed through the session-scoped link, so an SMS or
 * push payload at rest never carries a position.
 */
export interface ContactAlertPayload {
  readonly kind: 'contact_alert';
  readonly sessionId: string;
  /** The contact's own delivery address. */
  readonly to: string;
  readonly helpseekerDisplayName: string;
  readonly category: SessionCategory;
  /** Session-scoped live view link; location only exists behind it. */
  readonly liveSessionLink: string;
  /** True when activation was signalled under duress. */
  readonly duress: boolean;
  readonly sentAt: string;
}

/**
 * Sent to candidate responders. Identity-free by design (invariant 6):
 * session alias and coarse (~1 km) cell only. Precise location is released
 * to the single accepted responder via an authenticated session endpoint,
 * never in a notification.
 */
export interface ResponderOfferPayload {
  readonly kind: 'responder_offer';
  readonly sessionId: string;
  /** Routing only: the responder id this offer is addressed to. */
  readonly to: string;
  readonly alias: string;
  readonly coarseCell: string;
  readonly category: SessionCategory;
  readonly sentAt: string;
}

/** Production implementations (SMS, push) implement this same interface. */
export interface Notifier {
  sendContactAlert(payload: ContactAlertPayload): Promise<void>;
  sendResponderOffer(payload: ResponderOfferPayload): Promise<void>;
}

/** Dev/test stub: records exactly what would have gone over the wire. */
export class StubNotifier implements Notifier {
  readonly contactAlerts: ContactAlertPayload[] = [];
  readonly responderOffers: ResponderOfferPayload[] = [];

  async sendContactAlert(payload: ContactAlertPayload): Promise<void> {
    this.contactAlerts.push(payload);
  }

  async sendResponderOffer(payload: ResponderOfferPayload): Promise<void> {
    this.responderOffers.push(payload);
  }
}
