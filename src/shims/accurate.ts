// FAKED. Sim's real `getAccurateTokenCount` uses a model tokenizer.
// Here: ceil(characters / 4), a common rough rule for English. Labelled FAKE in the UI and README.
export function getAccurateTokenCount(text: string, _model?: string): number {
  return Math.ceil(text.length / 4)
}
