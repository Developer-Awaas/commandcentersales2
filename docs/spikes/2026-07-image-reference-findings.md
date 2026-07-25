# Spike findings — GPT-Image-1 reference-image generation + logo compositing

**Branch (deleted):** `spike/image-reference-test`, off `main` at `b5fc6f2`.
**Purpose:** measure real-world drift (geometry, color, invented content) of GPT-Image-1 against real project photos via `/v1/images/edits`, to inform the sacrosanct-media architecture decision. Local-only test harness, never deployed, never merged.

## Findings

Reference attachment works — GPT-Image-1's `/v1/images/edits` endpoint accepts multipart `image[]` parts alongside a text prompt and does incorporate the attached photos' visual content into the output. However, it *repaints* rather than *preserves*: the model treats attachments as strong visual inspiration, not as fixed pixels to composite around, so geometry/color/detail drift against the source photos should be expected and must be constrained via explicit per-image fidelity instructions in the prompt, not assumed away. The logo must never be sent to or rendered by the model — it is only ever safe as a deterministic, server-side compositing step on top of the model's output (this is why `compositeLogo()` in the spike, and the real system's overlay/text-layer pattern, structurally separates "what the model sees" from "what gets composited after"). Fidelity invariants (floor count, window-bay count, facade color, roofline shape) must be read from the actual reference photograph, not inferred from project metadata/descriptions — a text description of a building is not a substitute for looking at the real photo when writing per-image preservation constraints.

**No drift-log run data exists to attach here** — the spike never got past local-stack setup (blocked on Docker Desktop + `OPENAI_API_KEY` availability for most of its life) before being retired as validated. `project_media_test` and `creative-output-test` were both empty at teardown time. The templates and splice patterns below are the artifact this spike produced; they're what a future real integration should start from, not a data-backed drift table.

## The prompt templates (production input for Aanya's future reference-aware prompts)

### Simple mode — `buildPrompt(brief, photos, logoPosition)`

```
{brief}

REFERENCE IMAGES (attached in this exact order):
Image 1 ({display_name}): {label}. INVARIANTS — {fidelity_notes}.
Image 2 ({display_name}): {label}. INVARIANTS — {fidelity_notes}.
...

FIDELITY RULES (non-negotiable):
- The attached images show the real, existing project. Reproduce the building(s) faithfully.
- Preserve exactly: number of floors, number of window bays, facade colors and materials, roofline shape, and overall proportions as stated in each image's INVARIANTS.
- You MAY: change time of day and lighting, soften edges, remove temporary clutter (vehicles, cables, water stains, AC units), improve sky and atmosphere.
- You MUST NOT: add or remove floors or windows, change facade color, add structures, landscaping, trees, or amenities that are not visible in the reference images.

COMPOSITION:
- Keep the {logoPosition} corner visually quiet and free of text or objects — clean space will be used for branding.
```

Where `fidelity_notes` is null per-image, substitute `"preserve all visible architectural details unchanged"` and flag it (`fidelityMissing: true` on that manifest entry) so the caller can warn that fidelity notes were missing for that image, rather than silently under-constraining it.

### Structured mode — `buildStructuredPrompt(structuredPrompt, photos, logoPosition)`

For merging into a full Aanya-style 9-section prompt (the shape `senior-designer-prompts.ts` actually produces) rather than a bare brief. Two deterministic splices only — no other parsing or rewriting of the pasted prompt:

**Splice 1 — prepend SECTION 0** (before everything else):

```
SECTION 0: REFERENCE IMAGES & FIDELITY (attached in this exact order)
Image 1 ({display_name}) → this is the REAL photograph that must appear as the content of PHOTO PANEL 1. INVARIANTS — {fidelity_notes}.
Image 2 ({display_name}) → this is the REAL photograph that must appear as the content of PHOTO PANEL 2. INVARIANTS — {fidelity_notes}.
[one line per photo; panel index = manifest order]

FIDELITY RULES (non-negotiable):
- The attached images are real photographs of the actual project. Place them as the photo-panel contents; reproduce them faithfully.
- Preserve exactly: floor count, window-bay count, facade colors and materials, roofline shape, proportions, as stated per-image.
- You MAY: adjust lighting, time-of-day mood, and color grade of the photos to match SECTION 4; soften edges; remove temporary clutter (vehicles, cables, stains, AC units).
- You MUST NOT: change camera angle or framing of any attached photo, add or remove floors or windows, alter facade color, or introduce structures, trees, landscaping, or amenities not visible in the attached photos.
Keep the {logoPosition} corner of the final composition visually quiet — clean space reserved for branding compositing.
```

**Splice 2 — append to SECTION 8** (locate a line starting `SECTION 8`, case-insensitive, tolerant of `:`/`—`/`-` punctuation; insert the addendum immediately before the `SECTION 9` line, or at end-of-text if there's no SECTION 9):

```
DO NOT repaint, restructure, or re-angle the attached reference photographs — relighting per SECTION 4 is the only permitted transformation. DO NOT invent building details not present in the attached images.
```

If no `SECTION 8` header exists at all, append a new `SECTION 8: NEGATIVE PROMPTS (FIDELITY)` block at the end and surface a warning (`"no SECTION 8 found — fidelity negatives appended as new section"`) rather than failing or silently doing nothing.

**Rule for any future implementation:** keep the splicing dumb and deterministic. No regex surgery on SECTION 1's narrative, no camera-angle edits — those are the prompt author's responsibility to pre-edit. The merge function's only job is: prepend S0, append to S8.

### Manifest shape

Every photo produces `{ order, display_name, storage_path, sha256, fidelityMissing }`. The `sha256` exists so a human can verify byte-identical files were used between an automated run and a manual platform-UI test (`certutil -hashfile <file> SHA256` on Windows). `fidelityMissing` drives the warning surfaced when a photo has no stated invariants.

### Structural guarantee worth preserving

`dry_run` and the real generation path must call the *same* prompt-building function — never two separately-maintained copies. That's what makes `prompt === prompt_used` a structural guarantee instead of a "should match" convention that can silently drift.
