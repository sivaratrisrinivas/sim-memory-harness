// Message assembly for one replayed conversation under one memory setting.
//
// REAL (vendored, byte for byte): selectConversationMessageWindow, selectConversationTokenWindow,
// selectConversationContextWindow, selectConversationContextGroups, getConversationHistoryTokenBudget.
// The order of stages mirrors sim @ 8df65ad:
//   stage 1  executor/handlers/agent/memory.ts  fetchMemoryMessages: pick the setting's window
//   stage 2  providers/conversation-generation.ts: request-level budget (system + prompt required,
//            history capped at 16,000 tokens and 90% of the context window minus fixed and output reserve)
// FAKED / STAND-IN (labelled in the UI): token counter (chars/4), model limits (32k window), fixed and
// output reserves, the in-memory store, and group building (Sim builds groups when it stores a turn).
import { MEMORY } from '@/lib/memory/constants'
import {
  selectConversationContextWindow,
  selectConversationMessageWindow,
  selectConversationTokenWindow,
} from '@/lib/memory/history-window'
import { selectConversationContextGroups, DEFAULT_AGENT_HISTORY_TOKENS, type ConversationContextGroup } from '@/lib/memory/context-policy'
import { getConversationTokenCount } from '@/lib/memory/context-tokens'
import type { Message } from '@/providers/types'
import type { Case, SettingId, StoredMessage } from './types.ts'

export const SETTINGS: { id: SettingId; label: string; sim: string }[] = [
  { id: 'none', label: 'None', sim: "memoryType: 'none'" },
  { id: 'full_context', label: 'Full context', sim: "memoryType: 'conversation'" },
  { id: 'window_messages', label: 'Window: last 10 messages', sim: "memoryType: 'sliding_window' (default 10)" },
  { id: 'window_tokens', label: 'Window: 4,000 tokens', sim: "memoryType: 'sliding_window_tokens' (default 4000)" },
]
export const DEMO_MODEL = 'demo-model'
/** FAKED adapter reserves: tool schemas etc. and output tokens. */
export const FIXED_TOKENS = 600
export const OUTPUT_TOKENS = 4096
export const CONTEXT_WINDOW = 32_000

export type Mutant =
  | 'reverse_history' | 'drop_system' | 'off_by_one_window' | 'no_groups'
  | 'oldest_first_window' | 'neighbor_prefix_leak' | 'drop_probe'

export interface Assembly {
  request: Message[]
  /** number of stored messages (from the end) that stage 1 selected / the final request kept */
  stage1Count: number
  finalCount: number
  historyTokens: number
}

const clean = (m: StoredMessage): Message => {
  const { kind: _k, ...rest } = m
  return rest as Message
}
export const msgTokens = (m: Message) => getConversationTokenCount(JSON.stringify(m), DEMO_MODEL)

/** Stand-in for Sim's stored groups: a tool call and its results travel together. */
export function buildGroups(messages: Message[]): Message[][] {
  const groups: Message[][] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.tool_calls?.length) {
      const g = [m]
      while (messages[i + 1]?.role === 'tool') g.push(messages[++i])
      groups.push(g)
    } else groups.push([m])
  }
  return groups
}

/** Stand-in store: exact conversationId lookup (Sim's real store is Postgres, not run here). */
export function fetchStored(c: Case, mutant?: Mutant): StoredMessage[] {
  const store = new Map<string, StoredMessage[]>([
    [c.conversationId, c.history],
    [c.neighbor.conversationId, c.neighbor.history],
  ])
  if (mutant === 'neighbor_prefix_leak') {
    return [...store.entries()].filter(([k]) => k.startsWith(c.conversationId)).flatMap(([, v]) => v)
  }
  return store.get(c.conversationId) ?? []
}

export function assemble(c: Case, setting: SettingId, mutant?: Mutant): Assembly {
  const stored = fetchStored(c, mutant).map(clean)
  const groups = mutant === 'no_groups' ? undefined : buildGroups(stored)
  const idx = new Map<Message, number>(stored.map((m, i) => [m, i]))
  const system: Message = { role: 'system', content: c.systemPrompt }
  const probe: Message = { role: 'user', content: c.probe }

  let stage1: Message[]
  const lim = mutant === 'off_by_one_window' ? MEMORY.DEFAULT_SLIDING_WINDOW_SIZE - 1 : MEMORY.DEFAULT_SLIDING_WINDOW_SIZE
  switch (setting) {
    case 'none': stage1 = []; break
    case 'full_context': stage1 = selectConversationContextWindow(stored, DEMO_MODEL, groups); break
    case 'window_messages': stage1 = selectConversationMessageWindow(stored, lim, groups); break
    case 'window_tokens': stage1 = selectConversationTokenWindow(stored, MEMORY.DEFAULT_SLIDING_WINDOW_TOKENS, DEMO_MODEL, groups); break
  }
  if (mutant === 'oldest_first_window' && setting !== 'none') stage1 = stored.slice(0, stage1.length)

  // stage 2: request-level budget (real selectConversationContextGroups)
  const hist = buildGroups(stage1)
  const policy: ConversationContextGroup<Message[]>[] = [
    { value: [system], tokens: msgTokens(system), required: true },
    ...hist.map((g) => ({ value: g, tokens: g.reduce((t, m) => t + msgTokens(m), 0) })),
    { value: [probe], tokens: msgTokens(probe), required: true },
  ]
  const selected = selectConversationContextGroups(policy, {
    contextWindow: CONTEXT_WINDOW, fixedTokens: FIXED_TOKENS, outputTokens: OUTPUT_TOKENS, historyTokens: DEFAULT_AGENT_HISTORY_TOKENS,
  })
  let request = selected.flat()
  const finalHistory = request.slice(1, -1)
  if (mutant === 'reverse_history') request = [system, ...[...finalHistory].reverse(), probe]
  if (mutant === 'drop_system') request = request.slice(1)
  if (mutant === 'drop_probe') request = request.slice(0, -1)
  return {
    request,
    stage1Count: stage1.length,
    finalCount: finalHistory.length,
    historyTokens: finalHistory.reduce((t, m) => t + msgTokens(m), 0),
  }
}
