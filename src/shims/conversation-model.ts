// FAKED. Sim resolves limits from its provider tables. Sim's own fallback for an unknown model is a
// 32,000 token context window; we use that for every case. Output reserve is also a stand-in.
export function getConversationModelLimits(_modelId: string): { contextWindow: number; outputTokens: number } {
  return { contextWindow: 32_000, outputTokens: 4_096 }
}
