// CC-P4 Step 5 — anti-runaway cost guard for text agents (Kavya/Dhruv).
// Simpler than Aanya's BudgetTracker (which meters an image-gen loop): a text
// agent makes ONE bounded LLM call per turn, so the guard is a single pre-call
// estimate. If the worst-case cost of the call would exceed the tier ceiling,
// abort BEFORE spending. Post-call reconciliation is the existing
// agent_interactions cost row (actual tokens) — no separate ledger needed.
//
// Same per-token rate as arjun/aanya/diya/aarav-orchestrate: $3/M input,
// $15/M output.

export class TextBudgetCapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TextBudgetCapError'
  }
}

// Conservative token estimate from prompt characters (~4 chars/token) plus the
// call's max_tokens output ceiling — never under-estimates (input is rounded up
// via the /4 ratio and output is the hard max the model can emit).
export function estimateTextCostUsd(promptChars: number, maxTokens: number): number {
  const inputTokensEst = Math.ceil(promptChars / 4)
  return (inputTokensEst * 3 + maxTokens * 15) / 1_000_000
}

// Throws TextBudgetCapError if the estimated worst-case cost exceeds the
// ceiling. No-op when ceilingUsd is undefined (legacy callers / tests).
export function assertWithinTextBudget(ceilingUsd: number | undefined, promptChars: number, maxTokens: number): void {
  if (ceilingUsd === undefined) return
  const est = estimateTextCostUsd(promptChars, maxTokens)
  if (est > ceilingUsd) {
    throw new TextBudgetCapError(
      `Estimated cost $${est.toFixed(4)} exceeds this plan's per-interaction ceiling $${ceilingUsd.toFixed(2)}.`,
    )
  }
}
