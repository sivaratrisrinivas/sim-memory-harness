// Replays every case through the real windowing code under four settings, checks the assembled request,
// runs the mutation check of the checker, and writes results/results.json + results/RESULTS.md.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { generateAll, split, splitHash } from './generate.ts'
import { assemble, SETTINGS, msgTokens, type Mutant } from './assemble.ts'
import { runChecks, requestValid, naiveFactsKept, type Checks } from './checks.ts'
import type { Case, SettingId } from './types.ts'

const cases = split(generateAll())
const frozen = JSON.parse(readFileSync('data/split.json', 'utf8'))
if (splitHash(cases) !== frozen.sha256) throw new Error('split changed: the frozen 72/48 split hash no longer matches data/split.json')

export const COMMIT = '8df65ad39a10a6c34c61ff0674e0e8a7ad2164f0'

interface Row { case_id: string; setting: SettingId; split: string; facts_kept: boolean; valid: boolean; pass: boolean; stage1: number; kept: number; history_tokens: number; cause: string | null; checks: Record<string, { pass: boolean; reason: string }> }

function cause(c: Case, setting: SettingId, a: ReturnType<typeof assemble>, ch: Checks): string | null {
  if (ch.facts_kept.pass) return null
  if (setting === 'none') return 'by_design_no_memory'
  const bulk = c.tuple.load_shape === 'tool_heavy' || c.tuple.load_shape === 'long_paste'
  // was the fact present after stage 1? (stage 1 keeps the last stage1Count messages)
  const need = c.mustKeep.filter((m) => m.role !== 'stale')
  const factIdx = Math.max(...need.map((m) => c.history.findIndex((h) => (h.content ?? '').toLowerCase().includes(m.value.toLowerCase()))))
  const stage1From = c.history.length - a.stage1Count
  const inStage1 = factIdx >= stage1From
  if (setting === 'window_messages') return inStage1 ? 'history_budget_16k_stage2' : bulk ? 'message_count_limit_with_bulk' : 'message_count_limit'
  if (inStage1) return 'history_budget_16k_stage2'
  return bulk ? 'token_window_bulk_displacement' : 'token_window_long_history'
}

function evaluate(mutant?: Mutant) {
  const rows: Row[] = []
  for (const c of cases) for (const s of SETTINGS) {
    const a = assemble(c, s.id, mutant)
    const ch = runChecks(c, a.request)
    rows.push({
      case_id: c.id, setting: s.id, split: c.split, facts_kept: ch.facts_kept.pass, valid: requestValid(ch),
      pass: ch.facts_kept.pass && requestValid(ch), stage1: a.stage1Count, kept: a.finalCount, history_tokens: a.historyTokens,
      cause: cause(c, s.id, a, ch), checks: Object.fromEntries(Object.entries(ch)),
    })
  }
  return rows
}

const base = evaluate()
const rate = (rs: Row[], f: (r: Row) => boolean) => ({ n: rs.length, k: rs.filter(f).length, pct: rs.length ? Math.round((1000 * rs.filter(f).length) / rs.length) / 10 : 0 })
const mean = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / (xs.length || 1))

const table = SETTINGS.map((s) => {
  const rs = base.filter((r) => r.setting === s.id)
  const out: Record<string, unknown> = { setting: s.id, label: s.label, sim: s.sim }
  for (const sp of ['dev', 'held_out', 'all'] as const) {
    const x = rs.filter((r) => sp === 'all' || r.split === sp)
    out[sp] = { facts_kept: rate(x, (r) => r.facts_kept), request_valid: rate(x, (r) => r.valid), case_pass: rate(x, (r) => r.pass), mean_history_tokens: mean(x.map((r) => r.history_tokens)), mean_messages_kept: Math.round(10 * x.reduce((a, r) => a + r.kept, 0) / x.length) / 10 }
  }
  return out
})

// breakdowns of facts_kept by dimension, per setting, dev and held-out together and separately
const byDim = (dim: 'fact_type' | 'load_shape' | 'position') =>
  Object.fromEntries(SETTINGS.map((s) => [s.id, Object.fromEntries([...new Set(cases.map((c) => c.tuple[dim]))].map((v) => {
    const ids = new Set(cases.filter((c) => c.tuple[dim] === v).map((c) => c.id))
    const rs = base.filter((r) => r.setting === s.id && ids.has(r.case_id))
    return [v, rate(rs, (r) => r.facts_kept)]
  }))]))

// error discovery (automated taxonomy of dev failures; see README for how it was made)
const causes: Record<string, Record<string, number>> = {}
for (const r of base.filter((r) => r.cause && r.split === 'dev')) { causes[r.cause!] ??= {}; causes[r.cause!][r.setting] = (causes[r.cause!][r.setting] ?? 0) + 1 }
const causesHeld: Record<string, Record<string, number>> = {}
for (const r of base.filter((r) => r.cause && r.split === 'held_out')) { causesHeld[r.cause!] ??= {}; causesHeld[r.cause!][r.setting] = (causesHeld[r.cause!][r.setting] ?? 0) + 1 }

// checker validation 1: mutation check. Each mutant is a plausible regression in assembly. A mutant is "caught"
// if some (case, setting) that passed on the real code now fails. Measured on dev cases only.
const MUTANTS: { id: Mutant; what: string }[] = [
  { id: 'reverse_history', what: 'history is sent newest first' },
  { id: 'drop_system', what: 'system prompt is lost from the request' },
  { id: 'drop_probe', what: 'the current user message is lost' },
  { id: 'off_by_one_window', what: 'message window keeps 9 instead of 10' },
  { id: 'no_groups', what: 'tool exchanges are not kept together when windowing' },
  { id: 'oldest_first_window', what: 'window keeps the OLDEST messages, not the newest' },
  { id: 'neighbor_prefix_leak', what: 'store finds conversations by id prefix (customer-123 also returns customer-1230)' },
]
const baseKey = new Map(base.map((r) => [`${r.case_id}|${r.setting}`, r]))
const mutants = MUTANTS.map((m) => {
  const rows = evaluate(m.id).filter((r) => r.split === 'dev')
  const tripped: Record<string, number> = {}
  let regress = 0
  for (const r of rows) {
    const b = baseKey.get(`${r.case_id}|${r.setting}`)!
    let hit = false
    for (const [name, res] of Object.entries(r.checks)) if (!res.pass && b.checks[name].pass) { tripped[name] = (tripped[name] ?? 0) + 1; hit = true }
    if (hit) regress++
  }
  return { ...m, caught: regress > 0, regressed_dev_runs: regress, of: rows.length, checks_tripped: tripped }
})

// checker validation 2: agreement with an independent naive implementation (JSON substring), all 480 runs
let agree = 0, total = 0
const disagreements: string[] = []
for (const c of cases) for (const s of SETTINGS) {
  const a = assemble(c, s.id)
  const x = runChecks(c, a.request).facts_kept.pass, y = naiveFactsKept(c, a.request)
  total++
  if (x === y) agree++; else disagreements.push(`${c.id}/${s.id}`)
}

// timeline data for the UI: per case, one row per stored message plus per-setting kept counts
const timeline = cases.map((c) => ({
  id: c.id, split: c.split, tuple: c.tuple, conversationId: c.conversationId, probe: c.probe,
  must_keep: c.mustKeep, neighbor_id: c.neighbor.conversationId,
  messages: c.history.map((m) => ({ role: m.role, kind: m.kind ?? 'filler', tokens: msgTokens({ role: m.role, content: m.content, tool_calls: m.tool_calls, tool_call_id: m.tool_call_id, name: m.name } as never), text: (m.content ?? JSON.stringify(m.tool_calls?.[0]?.function ?? '')).slice(0, 110) })),
  settings: Object.fromEntries(SETTINGS.map((s) => { const r = baseKey.get(`${c.id}|${s.id}`)!; return [s.id, { kept: r.kept, stage1: r.stage1, facts_kept: r.facts_kept, valid: r.valid, cause: r.cause, reason: r.checks.facts_kept.reason, history_tokens: r.history_tokens }] })),
}))

const out = {
  meta: { sim_commit: COMMIT, split_sha256: frozen.sha256, cases: cases.length, dev: frozen.dev, held_out: frozen.held_out, model_limits: 'FAKE 32,000 window', token_counter: 'FAKE ceil(chars/4)', live_llm: false, summary_mode: 'not built' },
  table, by_fact_type: byDim('fact_type'), by_load_shape: byDim('load_shape'), by_position: byDim('position'),
  causes_dev: causes, causes_held_out: causesHeld, mutants,
  checker_audit: { naive_agreement: { agree, total, disagreements } },
  timeline,
}
mkdirSync('results', { recursive: true })
writeFileSync('results/results.json', JSON.stringify(out, null, 1) + '\n')

const f = (x: any) => `${x.k}/${x.n} (${x.pct}%)`
let md = `# Results\n\nSim commit ${COMMIT}. Frozen split sha256 ${frozen.sha256}.\nFAKED: token counter (chars/4), model limits (32k), no live LLM, no summary mode.\n\n| Setting | Dev facts kept | Held-out facts kept | Dev request valid | Held-out request valid | Mean history tokens (dev / held-out) |\n|---|---|---|---|---|---|\n`
for (const t of table as any[]) md += `| ${t.label} | ${f(t.dev.facts_kept)} | ${f(t.held_out.facts_kept)} | ${f(t.dev.request_valid)} | ${f(t.held_out.request_valid)} | ${t.dev.mean_history_tokens} / ${t.held_out.mean_history_tokens} |\n`
md += `\nMutation check (dev): ${mutants.filter((m) => m.caught).length}/${mutants.length} injected regressions caught.\nNaive-checker agreement: ${agree}/${total}.\n`
writeFileSync('results/RESULTS.md', md)
console.log(md)
console.log('causes dev', JSON.stringify(causes, null, 1))
console.log('mutants', JSON.stringify(mutants.map((m) => [m.id, m.caught, m.regressed_dev_runs, m.checks_tripped])))
console.log('disagreements', disagreements)
