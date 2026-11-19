/**
 * The permission gate. Every tool call the model makes goes through here, and
 * the rules live in code, not in the prompt: a model that ignores its
 * instructions still can't do anything outside its bucket.
 *
 *   ACTS ALONE  inside the plan the user approved while calm; low harm.
 *   ASKS FIRST  outside the plan; the user is asked, with a default for
 *               silence that is decided here, in code (decisions D1, D3).
 *   NEVER       not a tool at all. Any attempt is refused and counted.
 */
import { Clock } from '../domain/types';
import { FakeWorld, ToolOutcome } from './world';

export type Bucket = 'alone' | 'ask';

export const CONTACT_UPDATES = ['call_112_now', 'location_update', 'still_trying'] as const;
export const USER_NOTICES = [
  'alert_failed_retrying',
  'contact_unreachable_trying_next',
  'location_off_using_place_words',
  'location_unavailable',
  'nobody_reached_yet',
  'contacts_reached',
] as const;

export interface ToolSpec {
  readonly name: string;
  readonly bucket: Bucket;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

const contactArg = { contact_id: { type: 'string', description: 'Contact id from the situation, e.g. "c1"' } };

export const TOOL_SPECS: readonly ToolSpec[] = [
  { name: 'check_contact', bucket: 'alone', description: 'See whether a contact got the alert and responded.',
    parameters: { type: 'object', properties: contactArg, required: ['contact_id'] } },
  { name: 'retry_alert', bucket: 'alone', description: 'Send the emergency alert again to a trusted contact whose alert failed. At most 2 retries per contact.',
    parameters: { type: 'object', properties: contactArg, required: ['contact_id'] } },
  { name: 'get_location', bucket: 'alone', description: "Get the user's live location link. If GPS fails, may return the place in the user's own words.",
    parameters: { type: 'object', properties: {} } },
  { name: 'send_update', bucket: 'alone', description: 'Send a fixed update message to a contact who already got the alert.',
    parameters: { type: 'object', properties: { ...contactArg, message: { type: 'string', enum: [...CONTACT_UPDATES] } }, required: ['contact_id', 'message'] } },
  { name: 'tell_user', bucket: 'alone', description: "Show a fixed status message on the user's phone. Use it whenever something fails.",
    parameters: { type: 'object', properties: { message: { type: 'string', enum: [...USER_NOTICES] } }, required: ['message'] } },
  { name: 'alert_backup_contact', bucket: 'ask', description: 'Alert a backup contact. The user is asked first; if they cannot answer, the alert is sent.',
    parameters: { type: 'object', properties: contactArg, required: ['contact_id'] } },
  { name: 'offer_112', bucket: 'ask', description: "Offer to call 112. The user is asked; if they cannot answer, reached contacts are told to call 112.",
    parameters: { type: 'object', properties: {} } },
  { name: 'finish', bucket: 'alone', description: 'Stop when every failure has been handled and the user has been told.',
    parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } },
];

export interface ToolCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

export interface GateRecord {
  readonly call: ToolCall;
  readonly outcome: ToolOutcome;
  readonly refused: boolean;
  readonly at: number;
}

const MAX_RETRIES_PER_CONTACT = 2;

export class PermissionGate {
  readonly log: GateRecord[] = [];
  /** Calls to tools that don't exist or break a rule. */
  readonly violations: GateRecord[] = [];
  finished = false;
  private readonly retries = new Map<string, number>();

  /** v3 truth check: what has actually failed so far. */
  private readonly seenFailures = new Set<string>();
  /** Contacts seen with no response, so a backup alert is justified. */
  private readonly noResponse = new Set<string>();

  constructor(
    private readonly world: FakeWorld,
    private readonly clock: Clock,
    private readonly reportFailure: (what: string) => void,
    private readonly onUserTold: () => void,
    /**
     * Loop v2 guards, added after the first real-model test:
     *  - finish is refused while a failure is still untold (it said "done" too early)
     *  - a backup contact can only be alerted when a trusted one is missing
     *    (it alerted the neighbour after Maa's retry had already worked)
     *  - failed tool results say what to do next (small models follow that)
     */
    private readonly guards: { openFailures: () => string[]; truth?: boolean } | null = null,
  ) {}

  private onFailure(what: string): void {
    this.seenFailures.add(what);
    this.reportFailure(what);
  }

  /** Failures the app already knew about before the agent started (failed first alerts, GPS off). */
  knownFailure(what: string): void {
    this.onFailure(what);
  }

  execute(call: ToolCall): ToolOutcome {
    const spec = TOOL_SPECS.find((s) => s.name === call.name);
    let outcome: ToolOutcome = spec ? this.run(call) : { ok: false, error: `not_allowed: "${call.name}" is not a tool you can use` };
    if (this.guards && spec && !outcome.ok && !outcome.error?.startsWith('not_done') && !outcome.error?.startsWith('not_needed') && !outcome.error?.startsWith('not_true')) {
      outcome = { ...outcome, data: { ...(outcome.data ?? {}), next: 'Call tell_user now so the user knows, then keep handling it.' } };
    }
    const refused = !spec || (outcome.error?.startsWith('not_allowed') ?? false);
    const rec: GateRecord = { call, outcome, refused, at: this.clock.now().getTime() };
    this.log.push(rec);
    if (refused) this.violations.push(rec);
    return outcome;
  }

  private str(args: Record<string, unknown>, key: string): string {
    const v = args[key];
    return typeof v === 'string' ? v : '';
  }

  private run(call: ToolCall): ToolOutcome {
    const w = this.world;
    const id = this.str(call.args, 'contact_id');
    switch (call.name) {
      case 'check_contact': {
        if (!w.contact(id)) return { ok: false, error: 'unknown_contact' };
        const r = w.contactStatus(id);
        if (r.data?.status === 'no_response') { this.onFailure(`no_response:${id}`); this.noResponse.add(id); }
        if (this.guards && r.data?.status === 'no_response') {
          return { ...r, data: { ...r.data, next: 'Call tell_user (contact_unreachable_trying_next), then consider alert_backup_contact.' } };
        }
        return r;
      }
      case 'retry_alert': {
        const c = w.contact(id);
        if (!c) return { ok: false, error: 'unknown_contact' };
        if (c.role !== 'trusted') return { ok: false, error: 'not_allowed: backup contacts need alert_backup_contact' };
        const used = this.retries.get(id) ?? 0;
        if (used >= MAX_RETRIES_PER_CONTACT) return { ok: false, error: 'retry_limit_reached: tell the user and move on' };
        this.retries.set(id, used + 1);
        const r = w.sendSms(id, 'sos_alert');
        if (!r.ok) this.onFailure(`sms:${id}`);
        return r;
      }
      case 'get_location': {
        const r = w.location();
        if (!r.ok) this.onFailure('location');
        return r;
      }
      case 'send_update': {
        const msg = this.str(call.args, 'message');
        if (!(CONTACT_UPDATES as readonly string[]).includes(msg)) return { ok: false, error: 'not_allowed: only fixed messages can be sent' };
        if (!w.contact(id)) return { ok: false, error: 'unknown_contact' };
        if (!w.reachedContacts().includes(id)) return { ok: false, error: 'contact_not_reached_yet: retry the alert first' };
        const r = w.sendSms(id, msg);
        if (!r.ok) this.onFailure(`sms:${id}`);
        return r;
      }
      case 'tell_user': {
        const msg = this.str(call.args, 'message');
        if (!(USER_NOTICES as readonly string[]).includes(msg)) return { ok: false, error: 'not_allowed: only fixed messages can be shown' };
        if (this.guards?.truth) {
          // v3: a status message must match the facts. A false "contacts reached" is the worst outcome:
          // it tells her she's safe when nobody is coming.
          const reached = w.reachedContacts().length;
          const f = this.seenFailures;
          const lie =
            (msg === 'contacts_reached' && reached === 0) ? 'nobody has been reached; use nobody_reached_yet' :
            (msg === 'nobody_reached_yet' && reached > 0) ? 'some contacts were reached; use contacts_reached' :
            (msg === 'alert_failed_retrying' && ![...f].some((x) => x.startsWith('sms:'))) ? 'no alert has failed' :
            (msg === 'contact_unreachable_trying_next' && ![...f].some((x) => x.startsWith('no_response:') || x.startsWith('sms:'))) ? 'every contact responded' :
            ((msg === 'location_off_using_place_words' || msg === 'location_unavailable') && !f.has('location')) ? 'location is working' :
            null;
          if (lie) return { ok: false, error: `not_true: ${lie}` };
        }
        this.onUserTold();
        return w.notifyUser(msg);
      }
      case 'alert_backup_contact': {
        const c = w.contact(id);
        if (!c) return { ok: false, error: 'unknown_contact' };
        if (c.role !== 'backup') return { ok: false, error: 'not_backup: use retry_alert for trusted contacts' };
        if (this.guards) {
          const trusted = w.scenario.contacts.filter((x) => x.role === 'trusted').map((x) => x.id);
          const reached = w.reachedContacts();
          const missing = trusted.some((t) => !reached.includes(t) || this.noResponse.has(t));
          if (!missing) return { ok: false, error: 'not_needed: every trusted contact got the alert; do not alarm extra people' };
        }
        const answer = w.ask(`alert_backup:${id}`);
        // D1: silence means send. Only an explicit "no" stops it.
        if (answer === 'no') return { ok: true, data: { sent: false, reason: 'user_said_no' } };
        const r = w.sendSms(id, 'sos_alert');
        if (!r.ok) this.onFailure(`sms:${id}`);
        return { ok: r.ok, data: { sent: r.ok, answer }, error: r.error };
      }
      case 'offer_112': {
        const answer = w.ask('call_112');
        if (answer === 'yes') { w.openDialer(); return { ok: true, data: { dialer_opened: true } }; }
        if (answer === 'no') return { ok: true, data: { user_said_no: true } };
        // D3: silence -> the agent never calls police itself; the people who know her are told to.
        const reached = w.reachedContacts();
        for (const cid of reached) w.sendSms(cid, 'call_112_now');
        return { ok: true, data: { user_silent: true, contacts_told_to_call_112: reached } };
      }
      case 'finish': {
        const open = this.guards?.openFailures() ?? [];
        if (open.length) return { ok: false, error: `not_done: the user was not told about: ${open.join(', ')}. Call tell_user first.` };
        this.finished = true;
        return { ok: true };
      }
      default:
        return { ok: false, error: `not_allowed: "${call.name}"` };
    }
  }
}
