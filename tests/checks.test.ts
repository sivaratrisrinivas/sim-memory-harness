import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runChecks, requestValid } from '../src/checks.ts'
import { assemble } from '../src/assemble.ts'
import { generateAll, split, splitHash } from '../src/generate.ts'
import { readFileSync } from 'node:fs'
import type { Case } from '../src/types.ts'

const cases = split(generateAll())
const get = (id: string) => cases.find((c) => c.id === id)!
const mini = (over: Partial<Case> = {}): Case => ({
  id: 't', split: 'dev', tuple: { fact_type: 'id_number', load_shape: 'short_chat', position: 'next', distance: 1 },
  conversationId: 'customer-1', systemPrompt: 'SYS',
  history: [{ role: 'user', content: 'order ORD-11111 total $5.00' }, { role: 'assistant', content: 'noted' }],
  probe: 'refund please', mustKeep: [{ value: 'ORD-11111', role: 'fact' }],
  neighbor: { conversationId: 'customer-10', history: [], sentinels: ['ORD-99999'] }, ...over,
})
const req = (c: Case, hist = c.history) => [{ role: 'system' as const, content: c.systemPrompt }, ...hist, { role: 'user' as const, content: c.probe }]

test('known pass: full history, everything kept', () => {
  const c = mini(); const ch = runChecks(c, req(c))
  assert.ok(ch.facts_kept.pass && requestValid(ch))
})
test('known fail: fact dropped', () => {
  const c = mini(); const ch = runChecks(c, req(c, c.history.slice(1)))
  assert.equal(ch.facts_kept.pass, false); assert.ok(requestValid(ch)) // structure is still valid
})
test('known fail: system prompt missing / probe missing / reordered', () => {
  const c = mini()
  assert.equal(runChecks(c, req(c).slice(1)).system_kept.pass, false)
  assert.equal(runChecks(c, req(c).slice(0, -1)).probe_last.pass, false)
  assert.equal(runChecks(c, req(c, [...c.history].reverse())).history_order.pass, false)
})
test('known fail: leak from another conversation', () => {
  const c = mini(); const r = req(c); r.splice(1, 0, { role: 'user', content: 'other ORD-99999' })
  assert.equal(runChecks(c, r).isolation.pass, false)
})
test('known fail: orphan tool result (borderline: the call was cut)', () => {
  const c = mini({ history: [
    { role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'f', arguments: '{}' } }] },
    { role: 'tool', content: 'big', tool_call_id: 'a' }, { role: 'user', content: 'ORD-11111' }, { role: 'assistant', content: 'ok' }] })
  assert.equal(runChecks(c, req(c, c.history.slice(1))).tool_pairs.pass, false)
  assert.equal(runChecks(c, req(c)).tool_pairs.pass, true)
})
test('borderline: matching ignores case and extra spaces', () => {
  const c = mini({ mustKeep: [{ value: 'Manager  Sign-Off', role: 'fact' }], history: [{ role: 'user', content: 'needs manager sign-off first' }] })
  assert.ok(runChecks(c, req(c)).facts_kept.pass)
})
test('correction: only the old value present fails; new value alone passes; both in order passes', () => {
  const mk = (hist: string[]) => mini({ history: hist.map((t) => ({ role: 'user' as const, content: t })), mustKeep: [{ value: '14 Mill Lane', role: 'stale' }, { value: '9 Harbour Road', role: 'latest' }] })
  let c = mk(['deliver to 14 Mill Lane']); assert.equal(runChecks(c, req(c)).facts_kept.pass, false)
  c = mk(['correction: 9 Harbour Road']); assert.ok(runChecks(c, req(c)).facts_kept.pass)
  c = mk(['deliver to 14 Mill Lane', 'correction: 9 Harbour Road']); assert.ok(runChecks(c, req(c)).facts_kept.pass)
  c = mk(['correction: 9 Harbour Road', 'deliver to 14 Mill Lane']); assert.equal(runChecks(c, req(c)).facts_kept.pass, false)
})

test('real Sim code, unmodified behaviour: 10-message window keeps 10, fact at distance 9 survives and 11 does not', () => {
  const inn = cases.find((c) => c.tuple.load_shape === 'short_chat' && c.tuple.fact_type === 'id_number' && c.tuple.position === 'edge_in')!
  const out = cases.find((c) => c.tuple.load_shape === 'short_chat' && c.tuple.fact_type === 'id_number' && c.tuple.position === 'edge_out')!
  assert.ok(runChecks(inn, assemble(inn, 'window_messages').request).facts_kept.pass)
  assert.equal(runChecks(out, assemble(out, 'window_messages').request).facts_kept.pass, false)
  assert.equal(assemble(inn, 'window_messages').stage1Count, 10)
})
test('none keeps system prompt and probe only', () => {
  const c = get('c001'); const a = assemble(c, 'none'); assert.equal(a.request.length, 2)
})
test('every case: real code passes every structure check under every setting', () => {
  for (const c of cases) for (const s of ['none', 'full_context', 'window_messages', 'window_tokens'] as const) {
    const ch = runChecks(c, assemble(c, s).request); assert.ok(requestValid(ch), `${c.id} ${s}`)
  }
})
test('dataset: 120 cases, 72/48, split frozen, strata balanced, no sentinel leaks into target', () => {
  assert.equal(cases.length, 120)
  assert.equal(cases.filter((c) => c.split === 'dev').length, 72)
  assert.equal(splitHash(cases), JSON.parse(readFileSync('data/split.json', 'utf8')).sha256)
  for (const c of cases) {
    const blob = JSON.stringify([c.history, c.systemPrompt, c.probe]).toLowerCase()
    for (const s of c.neighbor.sentinels) assert.ok(!blob.includes(s.toLowerCase()), `${c.id} sentinel ${s}`)
    for (const m of c.mustKeep) assert.ok(blob.includes(m.value.toLowerCase()), `${c.id} fact ${m.value} planted`)
  }
})
test('the four vendored files are listed in SHA256SUMS (see npm run verify-vendor)', () => {
  assert.equal(readFileSync('vendor/SHA256SUMS', 'utf8').trim().split('\n').length, 4)
})
