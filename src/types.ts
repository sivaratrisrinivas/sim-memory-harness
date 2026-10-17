import type { Message } from '@/providers/types'

export type FactType = 'id_number' | 'constraint' | 'preference' | 'correction' | 'isolation'
export type LoadShape = 'short_chat' | 'chitchat' | 'tool_heavy' | 'long_paste'
export type Position = 'next' | 'recent' | 'inside' | 'edge_in' | 'edge_out' | 'far'

/** One stored message plus harness-only labels (never sent to the provider). */
export interface StoredMessage extends Message {
  /** harness label: what this message is for, used by the timeline view and error discovery */
  kind?: 'fact' | 'stale' | 'correction' | 'filler' | 'tool_call' | 'tool_result' | 'paste' | 'ack'
}

export interface MustKeep {
  value: string
  /** 'fact' must be present. 'latest' must be present. 'stale' is the superseded value. */
  role: 'fact' | 'latest' | 'stale'
}

export interface Case {
  id: string
  split: 'dev' | 'held_out'
  tuple: { fact_type: FactType; load_shape: LoadShape; position: Position; distance: number }
  conversationId: string
  systemPrompt: string
  history: StoredMessage[]
  probe: string
  mustKeep: MustKeep[]
  /** another conversation in the same store; none of these strings may appear in the request */
  neighbor: { conversationId: string; history: StoredMessage[]; sentinels: string[] }
}

export type SettingId = 'none' | 'full_context' | 'window_messages' | 'window_tokens'
