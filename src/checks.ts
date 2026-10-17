// Code-based checker (evals-skills: write-code-eval). No LLM judge. Each check returns { pass, reason }.
import type { Message } from '@/providers/types'
import type { Case } from './types.ts'

export interface CheckResult { pass: boolean; reason: string }
export type CheckName = 'system_kept' | 'probe_last' | 'history_order' | 'tool_pairs' | 'isolation' | 'facts_kept' | 'correction_order'
export type Checks = Record<CheckName, CheckResult>

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
const text = (m: Message) => norm(m.content ?? '')
const ok = (reason = 'ok'): CheckResult => ({ pass: true, reason })
const bad = (reason: string): CheckResult => ({ pass: false, reason })
const same = (a: Message, b: Message) => JSON.stringify([a.role, a.content, a.tool_calls, a.tool_call_id, a.name]) === JSON.stringify([b.role, b.content, b.tool_calls, b.tool_call_id, b.name])

export const VALID_CHECKS: CheckName[] = ['system_kept', 'probe_last', 'history_order', 'tool_pairs', 'isolation']

export function runChecks(c: Case, request: Message[]): Checks {
  const first = request[0]
  const last = request[request.length - 1]
  const system_kept = first && first.role === 'system' && first.content === c.systemPrompt ? ok() : bad('system prompt is not the first message, or was changed')
  const probe_last = last && last.role === 'user' && last.content === c.probe ? ok() : bad('current user message is not last')

  // history = everything between the system prompt and the current message
  const hist = request.slice(system_kept.pass ? 1 : 0, probe_last.pass ? -1 : undefined)
  const stored = c.history
  const k = hist.length
  let history_order: CheckResult
  if (k > stored.length) history_order = bad(`request has ${k} history messages but the conversation only stored ${stored.length}`)
  else {
    const tail = stored.slice(stored.length - k)
    const at = tail.findIndex((m, i) => !same(m, hist[i]))
    history_order = at === -1 ? ok(`kept the last ${k} of ${stored.length} stored messages in order`) : bad(`history is not an unmodified, in-order suffix (first mismatch at position ${at})`)
  }

  // tool exchanges must be complete: every tool result follows its call, every call gets its results
  let pending = new Set<string>()
  let tool_pairs: CheckResult = ok()
  for (const m of request) {
    if (m.role === 'tool') {
      if (!m.tool_call_id || !pending.delete(m.tool_call_id)) { tool_pairs = bad(`tool result ${m.tool_call_id} has no matching call before it`); break }
    } else {
      if (pending.size) { tool_pairs = bad('a tool call was not answered before the next message'); break }
      for (const t of m.tool_calls ?? []) pending.add(t.id)
    }
  }
  if (tool_pairs.pass && pending.size) tool_pairs = bad('a tool call at the end has no result')

  const all = norm(JSON.stringify(request))
  const leaked = c.neighbor.sentinels.filter((s) => all.includes(norm(s)))
  const isolation = leaked.length ? bad(`another conversation's value is in the request: ${leaked.join(', ')}`) : ok('no value from the neighbor conversation')

  // facts: look in history + current message only (not the system prompt)
  const body = request.filter((m) => m.role !== 'system')
  const where = (v: string) => body.findIndex((m) => text(m).includes(norm(v)))
  const need = c.mustKeep.filter((m) => m.role !== 'stale')
  const missing = need.filter((m) => where(m.value) === -1)
  const facts_kept = missing.length ? bad(`missing: ${missing.map((m) => m.value).join(' | ')}`) : ok(`kept: ${need.map((m) => m.value).join(' | ')}`)

  const stale = c.mustKeep.find((m) => m.role === 'stale')
  const latest = c.mustKeep.find((m) => m.role === 'latest')
  let correction_order = ok('not a correction case')
  if (stale && latest) {
    const s = where(stale.value), l = where(latest.value)
    if (l === -1) correction_order = bad(s === -1 ? 'neither the old nor the corrected value is present' : 'only the OLD value is present, the correction is gone')
    else if (s !== -1 && s > l) correction_order = bad('old value appears after the correction')
    else correction_order = ok(s === -1 ? 'corrected value present, old one dropped' : 'both present, correction comes after the old value')
  }
  // a correction case only counts as kept when the corrected value is there and the order is sane
  const facts_final = facts_kept.pass && correction_order.pass ? facts_kept : facts_kept.pass ? correction_order : facts_kept
  return { system_kept, probe_last, history_order, tool_pairs, isolation, facts_kept: facts_final, correction_order }
}

export const requestValid = (ch: Checks) => VALID_CHECKS.every((n) => ch[n].pass)

/** Second, deliberately naive implementation used only to audit the checker above (see run.ts). */
export function naiveFactsKept(c: Case, request: Message[]): boolean {
  const blob = JSON.stringify(request.slice(1)).toLowerCase()
  return c.mustKeep.filter((m) => m.role !== 'stale').every((m) => blob.includes(m.value.toLowerCase()))
}
