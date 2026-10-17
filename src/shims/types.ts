// Stand-in for Sim's `@/providers/types`. Same `Message` shape as sim @ 8df65ad (files omitted).
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'function' | 'tool'
  content: string | null
  files?: unknown[]
  name?: string
  function_call?: { name: string; arguments: string }
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}
