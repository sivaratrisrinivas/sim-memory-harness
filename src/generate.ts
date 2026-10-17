// Synthetic case generator (evals-skills: generate-synthetic-data).
// Step 1: dimensions. Step 2: tuples (4 fact types + 1 isolation type x 4 load shapes x 6 positions = 120).
// Step 3: realise each tuple with hand-written templates and a seeded generator, so every fact is an exact string.
// All names, ids and amounts are made up.
import { createHash } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { mulberry32, pick, int, shuffle, type Rng } from './rng.ts'
import type { Case, FactType, LoadShape, Position, StoredMessage, MustKeep } from './types.ts'

export const FACT_TYPES: FactType[] = ['id_number', 'constraint', 'preference', 'correction', 'isolation']
export const LOAD_SHAPES: LoadShape[] = ['short_chat', 'chitchat', 'tool_heavy', 'long_paste']
// distance = stored conversational messages (user/assistant, not tool plumbing) after the fact message.
// Odd on purpose so the history ends on an assistant turn. Sim's default window is 10 messages, so
// 9 is the last distance that fits and 11 is the first that does not.
export const POSITIONS: Record<Position, number> = { next: 1, recent: 3, inside: 7, edge_in: 9, edge_out: 11, far: 19 }
const SEED = 20261017

const SYSTEM_PROMPTS = [
  'You are the support agent for Northwind Outfitters. Answer in plain words. Quote the order or ticket ID you act on.',
  'You are a billing helper for Harbor Light Energy. Be brief and polite. Never invent account details.',
  'You are the service desk agent for Juniper Clinic Supplies. Follow the customer rules they give you.',
]
const FIRST = ['Maya', 'Tom', 'Priya', 'Luis', 'Chen', 'Ada', 'Noor', 'Sam', 'Ines', 'Kofi']
const FILL_USER = [
  'ok thanks', 'got it', 'sounds fine to me', 'one sec, checking my email', 'what are your opening hours again?',
  'is there a mobile app?', 'ha, that is funny', 'can you explain the return window in general?',
  'I am on the train so replies may be slow', 'also, how long does standard shipping usually take?',
  'good to know', 'do you have a loyalty program?', 'never mind that, carry on', 'thanks for your patience',
]
const FILL_ASSIST = [
  'Happy to help with that.', 'Of course. Anything else on your mind?', 'Standard shipping usually takes three to five working days.',
  'Our desk is open from 9 to 5 on weekdays.', 'Thanks for waiting.', 'Noted. I will keep going.',
  'There is a mobile app on both major stores.', 'Returns in general are accepted within the posted window.',
]
const CHITCHAT_USER = [
  'I have been a customer for years and the last time I called it took ages, so I am glad this chat works at all.',
  'Funny story, my cat knocked the parcel off the porch last week and I only found it this morning behind the pots.',
  'We are renovating the kitchen at the moment, so deliveries get confusing because nobody is ever home before six.',
  'Weather has been awful here, hope the couriers are coping with all the rain across the region.',
  'My neighbour ordered from you too and said the service was quick, which is why I tried you in the first place.',
]
const CHITCHAT_ASSIST = [
  'That sounds like quite a week. I am glad it turned up in the end, and I am here for whatever comes next on your side.',
  'Thanks for sharing that. Renovations make everything harder, and I will keep that in mind while we sort this out together.',
  'I appreciate the kind words. Quick service is what we aim for, and I will do my best to keep it that way for you today.',
]
const TOOL_NAMES = ['lookup_order', 'search_policy_docs', 'fetch_shipment_events', 'list_invoices']

/** Deterministic filler text, so a 30 KB tool result is reproducible without storing 30 KB. */
export function filler(r: Rng, chars: number, tag: string): string {
  const words = ['status', 'carrier', 'hub', 'scan', 'batch', 'region', 'item', 'queue', 'note', 'code', 'delta', 'ok', 'line', 'zone']
  let s = ''
  let n = 0
  while (s.length < chars) {
    s += `{"seq":${n++},"${pick(r, words)}":"${pick(r, words)}-${int(r, 100, 999)}","tag":"${tag}"},`
  }
  return s.slice(0, chars)
}
const pasteText = (r: Rng, chars: number) => {
  const lines = ['INFO queue drained', 'WARN retry 2 of 5', 'INFO heartbeat ok', 'DEBUG cache miss', 'INFO worker idle', 'WARN slow response']
  let s = 'Here is the log I was sent, not sure if it matters:\n'
  while (s.length < chars) s += `2026-10-0${int(r, 1, 9)} 1${int(r, 0, 9)}:${int(r, 10, 59)}:${int(r, 10, 59)} ${pick(r, lines)} id=${int(r, 1000, 9999)}\n`
  return s.slice(0, chars)
}

interface Fact { text: string; ack: string; mustKeep: MustKeep[]; probe: string }
function makeFact(r: Rng, type: FactType, caseNo: number): { facts: Fact[]; stale?: Fact } {
  const name = pick(r, FIRST)
  const ord = `ORD-${int(r, 10000, 99999)}`
  const amt = `$${int(r, 20, 899)}.${pick(r, ['00', '50', '25', '75'])}`
  switch (type) {
    case 'isolation':
    case 'id_number': {
      const v = pick(r, [0, 1, 2, 3])
      const tkt = `TKT-${int(r, 1000, 9999)}`
      const inv = `INV-2026-${int(r, 1000, 9999)}`
      const texts = [
        `Hi, I am ${name}. My order number is ${ord} and I was charged ${amt}.`,
        `Hello, it is ${name}. Please look at ticket ${tkt}, the refund amount should be ${amt}.`,
        `${name} here. The invoice is ${inv} for ${amt}, and the payment never arrived.`,
        `Quick one from ${name}: reference ${ord}, total ${amt}, delivered to the wrong flat.`,
      ]
      const keys = [[ord, amt], [tkt, amt], [inv, amt], [ord, amt]]
      return {
        facts: [{
          text: texts[v], ack: 'Thanks, I have noted the details you gave.',
          mustKeep: keys[v].map((value) => ({ value, role: 'fact' as const })),
          probe: 'Please go ahead and process my refund now. Which order or reference and amount are you using?',
        }],
      }
    }
    case 'constraint': {
      const v = pick(r, [0, 1, 2, 3])
      const lim = `$${int(r, 5, 95) * 10}`
      const days = int(r, 3, 9)
      const texts = [
        `Rule for my account: any refund above ${lim} needs manager sign-off first.`,
        `Important, ${name}'s team policy: never ship to a PO box, street addresses only.`,
        `For this customer, do not discount more than ${int(r, 5, 25)} percent without written approval.`,
        `Constraint from my finance team: invoices must be paid within ${days} days, no extensions.`,
      ]
      const keys = [`above ${lim}`, 'never ship to a PO box', 'without written approval', `within ${days} days`]
      const ks = [`manager sign-off`, 'street addresses only', 'do not discount more than', 'no extensions']
      return {
        facts: [{
          text: texts[v], ack: 'Understood, I will apply that rule.',
          mustKeep: [{ value: keys[v], role: 'fact' }, { value: ks[v], role: 'fact' }],
          probe: 'Now please handle my latest request. Before you act, which rule of mine applies?',
        }],
      }
    }
    case 'preference': {
      const v = pick(r, [0, 1, 2, 3])
      const hr = int(r, 7, 9)
      const texts = [
        `Preference: reply to me in Spanish please, and keep it short.`,
        `I only want morning deliveries, between ${hr}am and ${hr + 2}am if possible.`,
        `Please contact me by text message only, never by phone call.`,
        `Call me ${name}, not Mr or Ms, and send my receipts as a PDF.`,
      ]
      const keys = [['in Spanish', 'keep it short'], [`${hr}am and ${hr + 2}am`, 'morning deliveries'], ['text message only', 'never by phone call'], [`Call me ${name}`, 'as a PDF']]
      return {
        facts: [{
          text: texts[v], ack: 'Noted, I will follow that preference.',
          mustKeep: keys[v].map((value) => ({ value, role: 'fact' as const })),
          probe: 'Please write me the final confirmation message the way I asked.',
        }],
      }
    }
    case 'correction': {
      const v = pick(r, [0, 1, 2])
      const oldA = pick(r, ['14 Mill Lane', '3 Orchard Close', '88 Quay Street', '21 Birch Row'])
      const newA = pick(r, ['9 Harbour Road', '62 Elm Terrace', '5 Station Yard', '40 Willow Court'])
      const oldQ = int(r, 2, 6), newQ = oldQ + int(r, 2, 5)
      const oldD = pick(r, ['Monday', 'Tuesday', 'Wednesday']), newD = pick(r, ['Thursday', 'Friday', 'Saturday'])
      const S = [
        [`Please deliver it to ${oldA}.`, `Sorry, correction: deliver it to ${newA} instead, not the old address.`, oldA, newA],
        [`Make it ${oldQ} units please.`, `Actually I made a mistake, make it ${newQ} units, ignore the earlier number.`, `${oldQ} units`, `${newQ} units`],
        [`Schedule the visit for ${oldD}.`, `Change of plan, the visit should be on ${newD}, not ${oldD}.`, oldD, newD],
      ][v] as string[]
      return {
        facts: [{
          text: S[1], ack: 'Got it, I have updated that.',
          mustKeep: [{ value: S[3], role: 'latest' }],
          probe: 'Please confirm the final details back to me before you finish.',
        }],
        stale: { text: S[0], ack: 'Sure, noted.', mustKeep: [{ value: S[2], role: 'stale' }], probe: '' },
      }
    }
  }
}

function build(caseNo: number, type: FactType, shape: LoadShape, pos: Position): Omit<Case, 'split'> {
  const r = mulberry32(SEED + caseNo * 7919)
  const d = POSITIONS[pos]
  const conversationId = `customer-${int(r, 100, 899)}`
  const { facts, stale } = makeFact(r, type, caseNo)
  const fact = facts[0]
  let tcount = 0
  const hist: StoredMessage[] = []
  const U = (content: string, kind: StoredMessage['kind'] = 'filler') => hist.push({ role: 'user', content, kind })
  const A = (content: string, kind: StoredMessage['kind'] = 'filler') => hist.push({ role: 'assistant', content, kind })

  // pre-history: two turns, plus a longer one for chitchat
  const pre = shape === 'chitchat' ? 8 : 2
  for (let i = 0; i < pre; i += 2) {
    if (shape === 'long_paste' && i === 0) U(pasteText(r, int(r, 3000, 9000)), 'paste')
    else U(shape === 'chitchat' ? pick(r, CHITCHAT_USER) : pick(r, FILL_USER))
    A(shape === 'chitchat' ? pick(r, CHITCHAT_ASSIST) : pick(r, FILL_ASSIST))
  }
  // For corrections the stale statement sits 3 messages before the correction (user, ack, filler pair).
  if (stale) { U(stale.text, 'stale'); A(stale.ack, 'ack'); U(pick(r, FILL_USER)); A(pick(r, FILL_ASSIST)) }
  const factKind = type === 'correction' ? 'correction' : 'fact'
  U(fact.text, factKind)
  // `d` messages follow the fact: first is the assistant ack, then alternating user/assistant.
  const evens = Array.from({ length: d }, (_, k) => k + 1).filter((x) => x % 2 === 0)
  const pastesAt = new Set<number>(shape === 'long_paste' && evens.length ? [evens[0], evens[evens.length - 1]] : [])
  let toolEvery = 0
  for (let i = 1; i <= d; i++) {
    const isAssistantTurn = i % 2 === 1
    if (i === 1) { A(fact.ack, 'ack'); continue }
    if (isAssistantTurn) {
      if (shape === 'tool_heavy' && ++toolEvery % 1 === 0) {
        // tool exchange (assistant call + tool result) is internal: it does not count as a message slot
        const id = `call_${caseNo}_${tcount++}`
        const name = pick(r, TOOL_NAMES)
        hist.push({ role: 'assistant', content: null, kind: 'tool_call', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify({ q: `lookup ${int(r, 1, 99)}` }) } }] })
        hist.push({ role: 'tool', content: filler(r, int(r, 1200, 20000), `r${tcount}`), tool_call_id: id, name, kind: 'tool_result' })
      }
      A(shape === 'chitchat' ? pick(r, CHITCHAT_ASSIST) : pick(r, FILL_ASSIST))
    } else {
      if (pastesAt.has(i)) U(pasteText(r, int(r, 3000, 9000)), 'paste')
      else U(shape === 'chitchat' ? pick(r, CHITCHAT_USER) : pick(r, FILL_USER))
    }
  }
  const nType: FactType = 'id_number'
  const n = makeFact(mulberry32(SEED + caseNo * 31 + 5), nType, caseNo).facts[0]
  const nid = type === 'isolation' ? conversationId + '0' : `customer-${int(r, 900, 999)}`
  const sentinels = [n.mustKeep[0].value] // the id only: amounts could repeat by chance
  const neighbor = {
    conversationId: nid,
    history: [
      { role: 'user', content: n.text } as StoredMessage,
      { role: 'assistant', content: 'Thanks, I have noted the details you gave.' } as StoredMessage,
    ],
    sentinels,
  }
  const mustKeep = [...(stale ? stale.mustKeep : []), ...fact.mustKeep]
  return {
    id: `c${String(caseNo).padStart(3, '0')}`,
    tuple: { fact_type: type, load_shape: shape, position: pos, distance: d },
    conversationId, systemPrompt: SYSTEM_PROMPTS[caseNo % 3], history: hist, probe: fact.probe, mustKeep, neighbor,
  }
}

export function generateAll(): Omit<Case, 'split'>[] {
  const out: Omit<Case, 'split'>[] = []
  let n = 1
  for (const t of FACT_TYPES) for (const s of LOAD_SHAPES) for (const p of Object.keys(POSITIONS) as Position[]) out.push(build(n++, t, s, p))
  return out
}

/** Stratified frozen split: strata = fact_type x load_shape (20), 6 cases each; 12 strata give 4 to dev, 8 give 3 => 72 / 48. */
export function split(cases: Omit<Case, 'split'>[]): Case[] {
  const r = mulberry32(SEED ^ 0xabcdef)
  const strata = new Map<string, Omit<Case, 'split'>[]>()
  for (const c of cases) {
    const k = `${c.tuple.fact_type}|${c.tuple.load_shape}`
    strata.set(k, [...(strata.get(k) ?? []), c])
  }
  const keys = shuffle(r, [...strata.keys()].sort())
  const four = new Set(keys.slice(0, 12))
  const out: Case[] = []
  for (const k of [...strata.keys()].sort()) {
    const sh = shuffle(r, strata.get(k)!)
    const nDev = four.has(k) ? 4 : 3
    sh.forEach((c, i) => out.push({ ...c, split: i < nDev ? 'dev' : 'held_out' }))
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function splitHash(cases: Case[]): string {
  return createHash('sha256').update(cases.map((c) => `${c.id}:${c.split}`).join('\n')).digest('hex')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cases = split(generateAll())
  mkdirSync('data', { recursive: true })
  // Compact storage: large tool results/pastes are regenerated, so store only a recipe-free copy of small
  // messages and a length marker. Full text is rebuilt by generateAll() (deterministic) at run time.
  const slim = cases.map((c) => ({
    ...c,
    history: c.history.map((m) => (m.content && m.content.length > 400 ? { ...m, content: `[${m.content.length} chars, regenerated from seed]` } : m)),
  }))
  writeFileSync('data/cases.json', JSON.stringify(slim, null, 1) + '\n')
  const dev = cases.filter((c) => c.split === 'dev').length
  const split_ = { frozen: true, seed: SEED, dev, held_out: cases.length - dev, sha256: splitHash(cases), assignment: Object.fromEntries(cases.map((c) => [c.id, c.split])) }
  writeFileSync('data/split.json', JSON.stringify(split_, null, 1) + '\n')
  console.log(`cases=${cases.length} dev=${dev} held_out=${cases.length - dev} sha256=${split_.sha256}`)
}
