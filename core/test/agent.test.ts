import { describe, expect, it } from 'vitest';
import { runAgent, ScriptedModel } from '../src/agent/agent';
import { TOOL_SPECS } from '../src/agent/gate';
import { SCENARIOS } from '../src/agent/scenarios';
import { WATCHDOG_DEADLINE_MS } from '../src/agent/watchdog';
import { ManualClock } from './helpers/manual-clock';

const sc = (id: string) => SCENARIOS.find((s) => s.id === id)!;
const clock = () => new ManualClock(new Date('2026-11-19T22:40:00Z'));

describe('emergency agent: tool permissions', () => {
  it('has no tool that can end, cancel or start an emergency, pick a helper, or call police', () => {
    for (const { name } of TOOL_SPECS) {
      expect(name).not.toMatch(/^(cancel|close|resolve|end|start|trigger|dispatch|call)\b|_?(helper|responder|police|session|emergency|free_text)|^send_sms$/);
    }
    expect(TOOL_SPECS.map((t) => t.name).sort()).toEqual(
      ['alert_backup_contact', 'check_contact', 'finish', 'get_location', 'offer_112', 'retry_alert', 'send_update', 'tell_user'],
    );
  });

  it('refuses tools that do not exist and counts them as violations', async () => {
    const model = new ScriptedModel([[{ name: 'cancel_emergency', args: {} }, { name: 'send_sms', args: { to: '9876543210', text: 'hi' } }], [{ name: 'finish', args: { summary: 'x' } }]]);
    const r = await runAgent({ scenario: sc('S0'), model, clock: clock() });
    expect(r.gate.violations.map((v) => v.call.name)).toEqual(['cancel_emergency', 'send_sms']);
    expect(r.world.effects.filter((e) => e.kind === 'sms')).toHaveLength(0);
  });

  it('only sends fixed messages, never model-written text', async () => {
    const model = new ScriptedModel([[{ name: 'send_update', args: { contact_id: 'c1', message: 'Her address is 12 MG Road' } }, { name: 'tell_user', args: { message: 'whatever I like' } }], [{ name: 'finish', args: { summary: '' } }]]);
    const r = await runAgent({ scenario: sc('S0'), model, clock: clock() });
    expect(r.gate.violations).toHaveLength(2);
    expect(r.world.effects.filter((e) => e.kind === 'sms')).toHaveLength(0);
  });

  it('caps retries per contact at 2', async () => {
    const retry = { name: 'retry_alert', args: { contact_id: 'c1' } };
    const model = new ScriptedModel([[retry, retry, retry, retry], [{ name: 'tell_user', args: { message: 'alert_failed_retrying' } }, { name: 'finish', args: { summary: '' } }]]);
    const r = await runAgent({ scenario: sc('S2'), model, clock: clock() });
    expect(r.world.effects.filter((e) => e.kind === 'sms' && e.to === 'c1')).toHaveLength(2);
  });
});

describe('emergency agent: silence decisions (D1, D3)', () => {
  it('D1: an unanswered "alert backup contact?" sends the alert', async () => {
    const model = new ScriptedModel([[{ name: 'alert_backup_contact', args: { contact_id: 'b1' } }, { name: 'finish', args: { summary: '' } }]]);
    const r = await runAgent({ scenario: { ...sc('S5'), faults: { ...sc('S5').faults, userAnswer: 'silent' } }, model, clock: clock() });
    expect(r.world.effects.some((e) => e.kind === 'sms' && e.to === 'b1' && e.ok)).toBe(true);
  });

  it('D3: an unanswered "call 112?" never calls police; reached contacts are told to call', async () => {
    const model = new ScriptedModel([[{ name: 'offer_112', args: {} }, { name: 'finish', args: { summary: '' } }]]);
    const r = await runAgent({ scenario: { ...sc('S0'), faults: { userAnswer: 'silent' } }, model, clock: clock() });
    expect(r.world.effects.some((e) => e.kind === 'dialer_opened')).toBe(false);
    const told = r.world.effects.filter((e) => e.kind === 'sms' && e.template === 'call_112_now').map((e) => (e as { to: string }).to);
    expect(told.sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('opens the 112 dialer only when the user says yes', async () => {
    const model = new ScriptedModel([[{ name: 'offer_112', args: {} }, { name: 'finish', args: { summary: '' } }]]);
    const r = await runAgent({ scenario: { ...sc('S0'), faults: { userAnswer: 'yes' } }, model, clock: clock() });
    expect(r.world.effects.some((e) => e.kind === 'dialer_opened')).toBe(true);
  });
});

describe('emergency agent: no silent failure', () => {
  it('watchdog tells the user when the agent ignores a failure past the deadline', async () => {
    const c = clock();
    // The model fiddles with locations and never mentions the failed alert.
    const model = new ScriptedModel([[{ name: 'get_location', args: {} }], [{ name: 'get_location', args: {} }], [{ name: 'finish', args: { summary: 'all good' } }]]);
    const r = await runAgent({ scenario: sc('S2'), model, clock: c, afterStep: () => c.advance(WATCHDOG_DEADLINE_MS) });
    expect(r.watchdog.silentFailures().length).toBeGreaterThan(0);
    expect(r.world.effects.some((e) => e.kind === 'user_notice' && e.template === 'watchdog_problem_alert')).toBe(true);
  });

  it('an agent that tells the user in time has zero silent failures', async () => {
    const model = new ScriptedModel([[{ name: 'tell_user', args: { message: 'alert_failed_retrying' } }, { name: 'retry_alert', args: { contact_id: 'c1' } }], [{ name: 'finish', args: { summary: '' } }]]);
    const r = await runAgent({ scenario: sc('S1'), model, clock: clock() });
    expect(r.watchdog.silentFailures()).toHaveLength(0);
  });

  it('when the AI is down, the plain-code runbook still handles every scenario with no silent failure', async () => {
    for (const s of SCENARIOS) {
      const r = await runAgent({ scenario: s, model: new ScriptedModel([], 0), clock: clock() });
      expect(r.modelErrors, s.id).toBe(1);
      expect(r.usedRunbook, s.id).toBe(true);
      expect(r.watchdog.silentFailures(), s.id).toHaveLength(0);
      expect(r.gate.violations, s.id).toHaveLength(0);
    }
  });

  it('nobody reached and nobody told counts as a silent failure', async () => {
    const model = new ScriptedModel([[{ name: 'finish', args: { summary: 'done' } }]]);
    const r = await runAgent({ scenario: sc('S7'), model, clock: clock() });
    expect(r.watchdog.silentFailures().map((t) => t.what)).toContain('nobody_reached');
  });
});

describe('emergency agent: duress (invariant 4)', () => {
  it('shows nothing on the phone and never asks on it, while still working', async () => {
    const r = await runAgent({ scenario: sc('S9'), model: null, clock: clock() });
    const notices = r.world.effects.filter((e) => e.kind === 'user_notice');
    expect(notices.length).toBeGreaterThan(0);
    expect(notices.every((e) => e.kind === 'user_notice' && !e.shown)).toBe(true);
    expect(r.world.effects.filter((e) => e.kind === 'ask').every((e) => e.kind === 'ask' && e.answer === 'silent')).toBe(true);
    expect(r.world.reachedContacts()).toContain('c1'); // the retry still went out
  });
});

describe('emergency agent: loop v2 guards', () => {
  it('refuses to finish while a failure is still untold, and the model can correct itself', async () => {
    const model = new ScriptedModel([
      [{ name: 'retry_alert', args: { contact_id: 'c1' } }, { name: 'finish', args: { summary: 'done' } }],
      [{ name: 'tell_user', args: { message: 'alert_failed_retrying' } }, { name: 'finish', args: { summary: 'done' } }],
    ]);
    const r = await runAgent({ scenario: sc('S1'), model, clock: clock(), loop: 'v2' });
    const finishes = r.gate.log.filter((g) => g.call.name === 'finish');
    expect(finishes[0].outcome.error).toMatch(/^not_done/);
    expect(finishes[1].outcome.ok).toBe(true);
    expect(r.agentFinished).toBe(true);
    expect(r.watchdog.silentFailures()).toHaveLength(0);
    expect(r.gate.violations).toHaveLength(0); // a correction, not a rule break
  });

  it('refuses a backup alert when every trusted contact was reached (no extra false alarm)', async () => {
    const model = new ScriptedModel([[{ name: 'alert_backup_contact', args: { contact_id: 'b1' } }, { name: 'finish', args: { summary: '' } }]]);
    const r = await runAgent({ scenario: sc('S0'), model, clock: clock(), loop: 'v2' });
    expect(r.world.effects.some((e) => e.kind === 'sms' && e.to === 'b1')).toBe(false);
    expect(r.world.effects.some((e) => e.kind === 'ask')).toBe(false);
  });

  it('allows the backup alert once a trusted contact is found unreachable', async () => {
    const model = new ScriptedModel([[{ name: 'check_contact', args: { contact_id: 'c1' } }, { name: 'tell_user', args: { message: 'contact_unreachable_trying_next' } }, { name: 'alert_backup_contact', args: { contact_id: 'b1' } }, { name: 'finish', args: { summary: '' } }]]);
    const r = await runAgent({ scenario: { ...sc('S5'), faults: { ...sc('S5').faults, userAnswer: 'silent' } }, model, clock: clock(), loop: 'v2' });
    expect(r.world.effects.some((e) => e.kind === 'sms' && e.to === 'b1' && e.ok)).toBe(true);
  });

  it('the runbook still handles every scenario with no silent failure under v2 guards', async () => {
    for (const s of SCENARIOS) {
      const r = await runAgent({ scenario: s, model: new ScriptedModel([], 0), clock: clock(), loop: 'v2' });
      expect(r.watchdog.silentFailures(), s.id).toHaveLength(0);
      expect(r.gate.violations, s.id).toHaveLength(0);
    }
  });
});

describe('emergency agent: loop v3', () => {
  it('refuses a false "your contacts were reached" when nobody was (false reassurance)', async () => {
    const model = new ScriptedModel([[{ name: 'tell_user', args: { message: 'contacts_reached' } }, { name: 'finish', args: { summary: '' } }]]);
    const r = await runAgent({ scenario: sc('S7'), model, clock: clock(), loop: 'v3' });
    expect(r.gate.log[0].outcome.error).toMatch(/^not_true/);
    expect(r.world.effects.some((e) => e.kind === 'user_notice' && e.template === 'contacts_reached')).toBe(false);
    expect(r.world.effects.some((e) => e.kind === 'user_notice' && e.template === 'nobody_reached_yet')).toBe(true);
  });

  it('refuses "alert failed" when nothing failed', async () => {
    const model = new ScriptedModel([[{ name: 'tell_user', args: { message: 'alert_failed_retrying' } }, { name: 'finish', args: { summary: '' } }]]);
    const r = await runAgent({ scenario: sc('S0'), model, clock: clock(), loop: 'v3' });
    expect(r.gate.log[0].outcome.error).toMatch(/^not_true/);
  });

  it('knows GPS failed from the start, so a never-checked location still has to be told', async () => {
    const model = new ScriptedModel([[{ name: 'finish', args: { summary: '' } }], [{ name: 'tell_user', args: { message: 'location_off_using_place_words' } }, { name: 'finish', args: { summary: '' } }]]);
    const r = await runAgent({ scenario: sc('S3'), model, clock: clock(), loop: 'v3' });
    expect(r.gate.log[0].outcome.error).toMatch(/^not_done/);
    expect(r.agentFinished).toBe(true);
    expect(r.watchdog.silentFailures()).toHaveLength(0);
  });

  it('a stuck agent (6 failures in a row) hands over to the runbook', async () => {
    const retry = (id: string) => ({ name: 'retry_alert', args: { contact_id: id } });
    const model = new ScriptedModel(Array.from({ length: 10 }, () => [retry('c1'), retry('c2'), retry('c3')]));
    const r = await runAgent({ scenario: sc('S7'), model, clock: clock(), loop: 'v3' });
    expect(r.stuck).toBe(true);
    expect(r.usedRunbook).toBe(true);
    expect(r.steps).toBeLessThan(10);
    expect(r.watchdog.silentFailures()).toHaveLength(0);
  });

  it('the runbook still handles every scenario with no silent failure under v3', async () => {
    for (const s of SCENARIOS) {
      const r = await runAgent({ scenario: s, model: new ScriptedModel([], 0), clock: clock(), loop: 'v3' });
      expect(r.watchdog.silentFailures(), s.id).toHaveLength(0);
      expect(r.gate.violations, s.id).toHaveLength(0);
    }
  });
});
