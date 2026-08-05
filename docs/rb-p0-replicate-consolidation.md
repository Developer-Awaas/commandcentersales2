# RB-P0 — Copy-creative (replicate) fix + reference consolidation

**Branch:** `review-build` only. **Date:** 2026-08-05. Live-evaluated on CC-TEST (`yelmuykbqdyeikgbmkoq`), headless direct-invoke against `generate-image`, Ananta Enclave hero as the swapped building.

## Diagnosis (confirmed in code)

In replicate/"use-as-is" mode the model prompt was `buildReplicatePrompt(promptFeed)` where `promptFeed = data.nanobanana_prompt_main` — the **full 9-section senior-designer prompt**. So the 9-section content both *executed* (Stage 2 ran) and *contaminated* the edit directive, making GPT-Image-1 re-imagine a scene instead of preserving the reference layout.

Branch points: `Strategy.tsx` (`runTwoStageQuickGenerate(..., {layouts:['main']})`), `StrategyResult.tsx:~1448` (`buildReplicatePrompt(promptFeed)`), `senior-designer-prompts.ts:~1519` (concatenated `\n\n${layoutPrompt}`). Ad copy comes from Stage 1 (`ad_copy`), not Stage 2 — so Stage 2 is unnecessary in replicate mode.

## STEP 1 — Rung 1 (shipped)

Hard branch **before** the 9-section assembly:
- `Strategy.tsx` — replicate mode passes `layouts: []`: Stage 1 (concept + `ad_copy`) runs, **Stage 2 never executes**, no `nanobanana_prompt_main` produced.
- `buildReplicatePrompt(copy)` — rewritten to a **short edit directive** built from `{headline, price, cta}` only. ~150 words, zero 9-section artifacts (no SECTION headers, hex palette, camera/lens/Kelvin, lighting temps, composition-%, or scene narrative). IMAGE 1 = reference layout to preserve, IMAGE 2 = project hero as the only building.
- `StrategyResult.tsx` — auto-gen re-gated on `replicateAspect` (the main prompt is now absent); replicate slot builds the directive from `data.ad_copy`; logs `🎨 [REPLICATE PROMPT]` for evidence.

## STEP 3 — Live-eval verdicts

Text is garbled in every output — GPT-Image-1's pixel-level text-rendering limit (bug #38), **not** a layout defect. Legible copy is the **text-overlay layer system**'s job (crisp app-rendered text on top). The eval scores **layout adherence**.

| Case | Complexity | Verdict | Notes |
|---|---|---|---|
| A | simple (1 photo + headline + footer) | **PASS** | Frame, logo-top, headline, photo, corner arc, footers preserved; building swapped |
| B | complex multi-zone (price bar + 3-icon feature row) | **PASS** | All zones incl. two-part price bar + 3 icons preserved; building swapped |
| C | text-heavy (stat badges + 5-item checklist + QR) | **PARTIAL** | Macro layout/swoosh/QR/logos held; the dense 3-cell stat row + 5-item checklist dropped. Prompt refinement #1 recovered a badge strip but not full fidelity → **model ceiling on dense text-block fidelity**, not a prompt gap |

**Conclusion:** Rung 1 works — the 9-section removal flips the model from re-imagining to editing/preserving. Reliable for the common (simple / moderately-complex) cases; ceiling only on the densest text-block structures.

## STEP 2 — Reference consolidation (lean, shipped)

`ReferenceAnalysis.mode: 'style_hints' | 'replicate_layout'` (optional, back-compat) + `referenceMode()` resolver — both reference systems (CC-P5 text-to-image conditioning and the Strategy replicate path) now share **one typed shape**. `analyzeReferenceStyle` stamps `'style_hints'`. **Zone extraction deferred** (its only consumer is Rung 2, which is doc'd-not-built). No literal parallel code path exists to delete — the two are distinct mechanisms, unified at the type level.

## STEP 4 — Rung 2 design (DOCUMENTED, not built)

Trigger: only when text-heavy dense-zone fidelity (case C) becomes a priority.

**Mask-based building-only edit.** From `reference_analysis` photo-zone extraction (`replicate_layout` mode), generate a binary **mask** of the reference's photo area(s) → OpenAI `/v1/images/edits` **with `mask`** so only the masked photo region regenerates to the project hero, and **every non-masked zone (text, badges, checklist, logos) is pixel-preserved from the reference**. Text-swap stays a known limitation this pass (reference text remains; legible project copy comes from the text-overlay layer). This removes the dense-zone-fidelity problem because those zones are never regenerated.

Prerequisite: implement the deferred zone-extraction in `analyzeReferenceStyle` (bounding boxes of photo zones) → persist on the `replicate_layout` analysis → build the mask from it.

## Portability to `main`

The Rung-1 fix is 3 client files (`buildReplicatePrompt`, `Strategy.tsx` `layouts:[]`, `StrategyResult.tsx` gating+directive), provider-agnostic, touching neither the guard nor the budget. But `main` reverted the whole replicate feature (#33), so it has nothing to patch — the Rung-1 fix ports **only as part of re-introducing replicate to main**, not as a standalone cherry-pick.
