/**
 * Runs every break-it scenario against a real local model (and the plain-code
 * runbook as a baseline) and writes a scorecard.
 *
 *   node dist/agent/eval.js <model> [runsPerScenario] [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent, RunResult } from './agent';
import { OllamaModel } from './ollama';
import { SCENARIOS } from './scenarios';

const wall = { now: () => new Date() };

interface Row {
  scenario: string; title: string; who: string; run: number; loop: string;
  silent: number; violations: string[]; agentFinished: boolean; usedRunbook: boolean;
  modelErrors: number; stuck: boolean; falseReassurance: boolean; steps: number; seconds: number; reached: number; trustedReached: number;
  backupAlerted: boolean; asked112: boolean; shownUnderDuress: number; actions: string[];
}

function row(r: RunResult, title: string, run: number, seconds: number, loop = 'v1'): Row {
  const e = r.world.effects;
  const trusted = r.world.scenario.contacts.filter((c) => c.role === 'trusted').map((c) => c.id);
  return {
    scenario: r.scenarioId, title, who: r.model, run, loop: r.model === 'runbook-only' ? '-' : loop,
    silent: r.watchdog.silentFailures().length,
    violations: r.gate.violations.map((v) => v.call.name),
    agentFinished: r.agentFinished, usedRunbook: r.usedRunbook, modelErrors: r.modelErrors, stuck: r.stuck,
    falseReassurance: r.world.reachedContacts().length === 0 && e.some((x) => x.kind === 'user_notice' && x.template === 'contacts_reached'),
    steps: r.steps, seconds: Math.round(seconds * 10) / 10,
    reached: r.world.reachedContacts().length,
    trustedReached: r.world.reachedContacts().filter((id) => trusted.includes(id)).length,
    backupAlerted: e.some((x) => x.kind === 'sms' && x.to === 'b1'),
    asked112: e.some((x) => x.kind === 'ask' && x.question === 'call_112'),
    shownUnderDuress: r.world.scenario.faults.duress ? e.filter((x) => x.kind === 'user_notice' && x.shown).length : 0,
    actions: r.gate.log.map((g) => `${g.call.name}${g.call.args.contact_id ? '(' + String(g.call.args.contact_id) + ')' : g.call.args.message ? '(' + String(g.call.args.message) + ')' : ''}${g.refused ? '!REFUSED' : g.outcome.ok ? '' : '!fail'}`),
  };
}

async function main(): Promise<void> {
  const modelName = process.argv[2] ?? 'qwen2.5:3b';
  const runs = Number(process.argv[3] ?? 3);
  const outDir = process.argv[4] ?? 'agent-results';
  const loop = (['v2', 'v3'].includes(process.argv[5]) ? process.argv[5] : 'v1') as 'v1' | 'v2' | 'v3';
  mkdirSync(outDir, { recursive: true });
  const rows: Row[] = [];
  for (const s of SCENARIOS) {
    if (loop === 'v1') rows.push(row(await runAgent({ scenario: s, model: null, clock: wall }), s.title, 1, 0));
    for (let i = 1; i <= runs; i++) {
      const t0 = Date.now();
      const r = await runAgent({ scenario: s, model: new OllamaModel(modelName), clock: wall, loop });
      const rw = row(r, s.title, i, (Date.now() - t0) / 1000, loop);
      rows.push(rw);
      writeFileSync(join(outDir, `${loop}-${s.id}-run${i}.json`), JSON.stringify({ row: rw, transcript: r.transcript }, null, 2));
      console.log(`${s.id} run ${i}: silent=${rw.silent} violations=${rw.violations.length} finished=${rw.agentFinished} runbook=${rw.usedRunbook} steps=${rw.steps} ${rw.seconds}s :: ${rw.actions.join(' > ')}`);
    }
  }
  writeFileSync(join(outDir, `rows-${loop}.json`), JSON.stringify(rows, null, 2));
  console.log(`wrote ${rows.length} rows to ${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
