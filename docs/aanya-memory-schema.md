# Aanya Memory — Training Creative Schema & Interpretation Guide

> Reference for understanding how uploaded ad creatives are stored, what Aanya extracts from each image, and how that data feeds into Design DNA synthesis.

---

## 1. Full Row Schema (`aanya_training_creatives`)

```json
{
  "id": "uuid — auto-generated primary key",
  "org_id": "uuid — must match the uploading user's org (enforced by RLS)",
  "project_id": "uuid | null — links creative to a specific project for project-scoped DNA",
  "image_url": "string — public storage URL (brand-assets bucket, aanya-training/ path)",
  "storage_path": "string — relative path inside brand-assets bucket",
  "source": "own_ad | competitor | industry_reference | winning_template",
  "platform": "meta_feed | meta_story | instagram_feed | instagram_story | whatsapp | google_display | null",
  "performance_tier": "top_performer | good_performer | average | underperformer | reference_only",
  "cpl": "number | null — Cost Per Lead in ₹",
  "ctr": "number | null — Click-Through Rate in %",
  "notes": "string | null — free-text notes about what worked / didn't work",
  "vision_analysis": {
    "description": "string — 2-3 sentence visual summary from Claude Haiku",
    "patterns": ["string", "string", "..."]
  },
  "extracted_patterns": {
    "patterns": ["string", "string", "..."]
  },
  "created_at": "timestamp"
}
```

---

## 2. The `vision_analysis` Object

This is the core of what Aanya learns. It is populated automatically when an image is uploaded — Claude Haiku (vision model) reads the image and returns two fields.

### 2a. `description`

A 2–3 sentence visual summary that covers:

| Element | What Haiku extracts |
|---|---|
| Layout type | Grid, hero, dual-card, checklist-overlay, editorial, etc. |
| Dominant visual | Building render, lifestyle photo, typography-forward, abstract |
| Color palette | Dominant colors with hex codes where readable |
| Typography style | Bold all-caps, editorial serif, light sans, mixed weight |
| Overall mood | Luxury, aspirational, affordable, trust, urgency |

**Example (Neelachala Meadows ad):**
```
"Square-format real estate ad using a 60/40 composition split — the upper 60% is a
photorealistic hero render of a 3-storey residential building with warm terracotta
(#C8762A), chocolate brown (#6B3F2A), and white facade panels under a soft dusk sky.
The lower 40% uses a near-black charcoal overlay (#1A1A1A at ~85% opacity) that grounds
all typography and the feature grid. A bold white all-caps headline anchors the mid-frame,
with a rectangular gold CTA button (#C9A150) immediately below, followed by a 3-column
bullet-point amenity checklist."
```

---

### 2b. `patterns`

An array of 4–6 specific design/copy patterns. Each pattern is prefixed with a category label so Aanya can group them during DNA synthesis.

#### Pattern Categories

| Prefix | What it captures | Example |
|---|---|---|
| `Layout:` | Structural arrangement of elements on the canvas | `"Layout: dark gradient overlay on bottom 40% with hero building in top 60%"` |
| `Color:` | Dominant color pairing, palette, contrast approach | `"Color: gold/amber CTA panel (#C9A150) on near-black charcoal base (#1A1A1A)"` |
| `Typography:` | Font weight, case, hierarchy, size relationship | `"Typography: bold white all-caps headline + location tag in spaced caps above headline"` |
| `Copy angle:` | The messaging strategy and CTA approach | `"Copy angle: affordability positioning + 6-item feature checklist in 3-column grid"` |
| `Composition:` | Camera framing, subject placement, negative space | `"Composition: full-bleed architectural render with overlaid dark panel for text legibility"` |
| `Mood:` | Emotional register and audience signal | `"Mood: approachable affordable housing — warm earth tones, no luxury coldness"` |

---

## 3. Complete Example — Neelachala Meadows Ad

```json
{
  "org_id": "a1b2c3d4-...",
  "project_id": "e5f6g7h8-...",
  "image_url": "https://<supabase>/storage/v1/object/public/brand-assets/aanya-training/.../neelachala-meadows.jpg",
  "storage_path": "aanya-training/<orgId>/1718123456789-k8x2m.jpg",
  "source": "own_ad",
  "platform": "instagram_feed",
  "performance_tier": "top_performer",
  "cpl": null,
  "ctr": null,
  "notes": null,
  "vision_analysis": {
    "description": "Square-format real estate ad using a 60/40 composition split — the upper 60% is a photorealistic hero render of a 3-storey residential building with warm terracotta (#C8762A), chocolate brown (#6B3F2A), and white facade panels under a soft dusk sky. The lower 40% uses a near-black charcoal overlay (#1A1A1A at ~85% opacity) that grounds all typography and the feature grid. A bold white all-caps headline anchors the mid-frame, with a rectangular gold CTA button (#C9A150) immediately below it, followed by a 3-column bullet-point amenity checklist.",
    "patterns": [
      "Layout: dark gradient overlay on bottom 40% with hero building in top 60%",
      "Color: gold/amber CTA panel (#C9A150) on near-black charcoal base (#1A1A1A)",
      "Typography: bold white all-caps headline + location tag in spaced caps above headline",
      "Copy angle: affordability positioning + 6-item feature checklist in 3-column grid",
      "Composition: full-bleed architectural render with overlaid dark panel for text legibility",
      "Mood: approachable affordable housing — warm earth tones, no luxury coldness"
    ]
  },
  "extracted_patterns": {
    "patterns": [
      "Layout: dark gradient overlay on bottom 40% with hero building in top 60%",
      "Color: gold/amber CTA panel (#C9A150) on near-black charcoal base (#1A1A1A)",
      "Typography: bold white all-caps headline + location tag in spaced caps above headline",
      "Copy angle: affordability positioning + 6-item feature checklist in 3-column grid",
      "Composition: full-bleed architectural render with overlaid dark panel for text legibility",
      "Mood: approachable affordable housing — warm earth tones, no luxury coldness"
    ]
  }
}
```

---

## 4. How Each Field Is Used by Aanya

### `source` — Where the creative came from

| Value | How Aanya weights it |
|---|---|
| `own_ad` | Highest trust — this is a real ad that ran for the org |
| `competitor` | Negative space learning — understand the market, not the brand |
| `industry_reference` | Benchmark quality — sets the production standard bar |
| `winning_template` | Format library — layout patterns worth replicating |

During DNA synthesis, `own_ad` patterns from `top_performer` creatives carry the most influence on the final `dna_summary`.

---

### `performance_tier` — The single most important field

This is the signal that separates "learn from this" from "avoid this."

| Value | Effect on DNA Synthesis |
|---|---|
| `top_performer` | Patterns aggregated into `best_performing_*` arrays |
| `good_performer` | Patterns aggregated into `best_performing_*` arrays |
| `average` | Included in total count but patterns are not weighted |
| `underperformer` | Patterns aggregated into `underperforming_patterns` — Aanya actively avoids these |
| `reference_only` | Not used in pattern synthesis — visual context only |

---

### `cpl` and `ctr` — Performance anchors

When provided, these are surfaced in the Crawl Parameters panel as a quality benchmark (min/max/avg ranges). They are currently displayed as guidance numbers but are not yet used to weight individual patterns in the synthesis prompt. A future improvement would auto-promote creatives to `top_performer` when CPL drops below a target threshold.

---

### `vision_analysis.description` — Fed into DNA as context

During `synthesizeDNA()`, the descriptions from top/good performers are concatenated and sent to Claude Sonnet as `TOP PERFORMER DESCRIPTIONS`. Sonnet reads these to understand the visual vocabulary of what has worked and writes the `dna_summary` in plain English.

**Example — what Sonnet receives:**
```
TOP PERFORMER DESCRIPTIONS:
Square-format real estate ad using a 60/40 composition split — the upper 60% is a
photorealistic hero render of a 3-storey building with warm terracotta...

[description of creative 2]

[description of creative 3]
```

---

### `vision_analysis.patterns` — Fed into DNA as structured signals

During `synthesizeDNA()`, patterns from top performers are listed as bullet points under `TOP PERFORMER VISUAL PATTERNS (what works)`, and patterns from underperformers under `UNDERPERFORMER PATTERNS (what to avoid)`.

**What Sonnet produces from the patterns:**

```json
{
  "dna_summary": "Neelachala Homes creatives perform best with a 60/40 hero-overlay composition using a full-bleed architectural render in the upper frame and a near-black charcoal panel (#1A1A1A) in the lower 40% for typography. The brand's winning color system pairs gold/amber (#C9A150) CTAs against the dark base, with bold white all-caps headlines. Affordability messaging anchored by a 3-column feature checklist consistently outperforms aspirational lifestyle copy for this segment. Warm earth tones (terracotta, amber, brown) in the building facade reinforce the approachable price-point positioning.",
  "best_performing_angles": [
    "price-led affordability with feature proof",
    "location + configuration (2BHK, Patrapada)"
  ],
  "best_performing_compositions": [
    "full-bleed building hero + dark lower overlay panel",
    "3-column bullet checklist on dark background"
  ],
  "best_performing_color_treatments": [
    "gold/amber CTA on near-black charcoal (#C9A150 on #1A1A1A)",
    "warm earth tones in architecture (terracotta + brown + white)"
  ],
  "best_performing_copy_angles": [
    "affordability headline + BOOK NOW urgency CTA",
    "6-feature checklist: bedrooms, bathrooms, power backup, CCTV, parking, intercom"
  ],
  "underperforming_patterns": [],
  "confidence_level": "low"
}
```

This `dna_summary` is then injected into every future generation prompt for this project under the `DESIGN DNA` block in `buildQuickGenerateBrief`.

---

## 5. Data Flow Summary

```
Upload image
    │
    ▼
Storage upload → brand-assets/aanya-training/{orgId}/...
    │
    ▼
Claude Haiku vision analysis
    │   → description (2-3 sentence visual summary)
    │   → patterns[] (4-6 category-prefixed design signals)
    │
    ▼
INSERT into aanya_training_creatives
    │   vision_analysis   = { description, patterns }
    │   extracted_patterns = { patterns }
    │
    ▼
"Synthesize DNA" button
    │
    ▼
Claude Sonnet reads:
    │   top/good performer patterns  → best_performing_*
    │   underperformer patterns      → underperforming_patterns
    │   top performer descriptions   → narrative context
    │
    ▼
UPSERT into project_design_systems
    │   dna_summary
    │   best_performing_angles
    │   best_performing_compositions
    │   best_performing_color_treatments
    │   best_performing_copy_angles
    │   underperforming_patterns
    │   confidence_level
    │
    ▼
buildQuickGenerateBrief() reads project_design_systems
    │
    ▼
Aanya injects DNA into generation prompt → GPT-Image-1
```

---

## 6. Crawl Agent Usage

The **Crawl Parameters** panel in the Aanya Memory tab exports a JSON blob built from the aggregated patterns. Use this as a briefing input to your scraping/crawling agents:

```json
{
  "generated_at": "2026-06-13T...",
  "scope": "Neelachala Meadows",
  "training_set": {
    "total_creatives": 12,
    "top_good_performers": 4,
    "underperformers": 1,
    "platforms": { "instagram_feed": 6, "meta_feed": 4, "meta_story": 2 },
    "sources": { "own_ad": 7, "competitor": 3, "industry_reference": 2 },
    "cpl_range_inr": { "min": 320, "max": 780, "avg": 490 },
    "ctr_range_pct": { "min": 0.9, "max": 2.4, "avg": 1.6 }
  },
  "crawl_targets": {
    "platforms_to_prioritize": ["instagram_feed", "meta_feed", "meta_story"],
    "visual_patterns_to_replicate": {
      "Layout": ["dark gradient overlay on bottom 40% with hero building in top 60%"],
      "Color": ["gold/amber CTA panel on near-black charcoal base"],
      "Typography": ["bold white all-caps headline + location tag in spaced caps"],
      "Copy angle": ["affordability positioning + 6-item feature checklist in 3-column grid"],
      "Composition": ["full-bleed architectural render with overlaid dark panel"],
      "Mood": ["approachable affordable housing — warm earth tones, no luxury coldness"]
    },
    "sample_visual_descriptions": [
      "Square-format real estate ad using a 60/40 composition split..."
    ]
  },
  "avoid": {
    "patterns": []
  }
}
```

**How to instruct your crawling agent:** pass `crawl_targets.visual_patterns_to_replicate` as search criteria (e.g. find Instagram ads matching "dark overlay + gold CTA + building hero + feature checklist"), prioritise `platforms_to_prioritize`, and filter for creatives whose CPL is within or below `cpl_range_inr.avg`. Tag each fetched creative with `source: competitor` or `source: industry_reference` before uploading to Aanya Memory.

---

## 7. Web Crawl Agent — Step-by-Step Process

This section is a complete operational guide for a testing agent (Claude Code agent, Python script, or any LLM agent) that fetches real-world ad creatives from the web and inserts them into Aanya's training pipeline in the correct format.

---

### Prerequisites

| Requirement | Where to get it |
|---|---|
| Supabase service role key | Supabase dashboard → Settings → API → `service_role` |
| Supabase project URL | Supabase dashboard → Settings → API → Project URL |
| Anthropic API key | For Claude Haiku vision analysis (same key the app uses) |
| Crawl Parameters JSON | Aanya Memory tab → "Copy JSON" button |

Set these as environment variables before running:
```bash
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
ANTHROPIC_API_KEY=<key>
ORG_ID=<uuid>          # from Supabase profiles table
PROJECT_ID=<uuid>      # optional — links creatives to a project for scoped DNA
```

---

### STEP 1 — Receive the Crawl Parameters Brief

The agent's entry point is the JSON exported from the Crawl Parameters panel. Parse these fields:

```
crawl_targets.platforms_to_prioritize   → which platforms to search
crawl_targets.visual_patterns_to_replicate → what to look for (by category)
crawl_targets.sample_visual_descriptions   → reference descriptions for similarity matching
avoid.patterns                            → visual patterns to discard
training_set.cpl_range_inr.avg           → CPL quality benchmark (₹)
training_set.ctr_range_pct.avg           → CTR quality benchmark (%)
```

Build a **search query string** by joining `visual_patterns_to_replicate` values into natural language:

```
"Indian real estate Instagram ad dark overlay gold CTA building hero checklist affordable"
```

Build a **negative filter list** from `avoid.patterns` — any image matching these should be skipped.

---

### STEP 2 — Discover Ad Creative URLs

Use one or more of these sources depending on what's available:

#### Option A — Meta Ad Library (public, no auth required)
```
GET https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=IN&q=<search_query>&media_type=image
```
Parse returned ad cards. Extract:
- `ad_creative_images[].resized_image_url` — the image URL
- `page_name` — competitor brand name (use as notes)
- `ad_delivery_start_time` — used for recency filtering

Filter to keep only ads from the last 90 days. Skip video-only ads.

#### Option B — Google Images / Bing Images (via web search API)
Use a web search tool with the constructed query + `site:instagram.com OR site:facebook.com`:
```
Indian real estate ad "2BHK" OR "3BHK" dark background gold CTA site:instagram.com
```
Extract `<img>` `src` URLs from results. Prefer `.jpg` or `.png` over `.webp` where possible.

#### Option C — Direct Instagram profile scraping (for known competitor handles)
For each competitor handle in `training_set.sources.competitor`:
```
GET https://www.instagram.com/<handle>/?__a=1&__d=dis
```
Parse `edge_owner_to_timeline_media.edges[].node.display_url` for image URLs.

#### Quality gate — discard before downloading
Skip an image if:
- Dimensions < 600×600 px (too low resolution for Haiku vision)
- It is a video thumbnail (check URL extension or content-type)
- Its alt-text or surrounding copy contains any `avoid.patterns` keyword

---

### STEP 3 — Download and Upload to Supabase Storage

For each surviving image URL:

```python
import httpx, uuid, time
from supabase import create_client

sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

def download_and_upload(image_url: str, org_id: str) -> dict:
    # 1. Download the image
    r = httpx.get(image_url, timeout=15, follow_redirects=True)
    r.raise_for_status()
    content_type = r.headers.get("content-type", "image/jpeg")
    ext = content_type.split("/")[-1].split(";")[0]  # jpeg, png, webp

    # 2. Build deterministic-ish storage path
    slug = f"{int(time.time())}-{uuid.uuid4().hex[:8]}"
    path = f"aanya-training/{org_id}/{slug}.{ext}"

    # 3. Upload to brand-assets bucket
    sb.storage.from_("brand-assets").upload(
        path, r.content,
        file_options={"content-type": content_type, "upsert": "false"}
    )

    # 4. Get public URL
    public_url = sb.storage.from_("brand-assets").get_public_url(path)

    return {"path": path, "url": public_url, "content_type": content_type}
```

If the upload returns a 400 (duplicate path), generate a new slug and retry once.

---

### STEP 4 — Run Claude Haiku Vision Analysis

For each uploaded image, call Claude Haiku with the **exact same prompt** used in `analyzeCreativeWithVision()` in `AanyaMemory.tsx:79`:

```python
import anthropic

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

def analyze_creative(image_url: str) -> dict | None:
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=600,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "url", "url": image_url}},
                {
                    "type": "text",
                    "text": """You are Aanya Mehta, Senior Creative Director. Analyze this real estate ad creative.

Return a JSON object with exactly these fields:
{
  "description": "2-3 sentence visual description: layout type, dominant visual element, color palette (include hex if readable), typography style, and overall mood",
  "patterns": ["pattern1", "pattern2", "pattern3", "pattern4", "pattern5"]
}

For "patterns", extract 4-6 specific design/copy patterns like:
- Layout: "dark background with dual photo cards"
- Color: "gold accent on navy base"
- Typography: "bold sans-serif headline + light subtext"
- Copy angle: "price + urgency CTA"
- Composition: "architectural hero shot + feature checklist"
- Mood: "aspirational luxury"

Return ONLY the JSON object, no markdown, no preamble."""
                }
            ]
        }]
    )
    import json
    text = msg.content[0].text.strip()
    text = text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return json.loads(text)
```

**Pattern relevance filter**: after getting `patterns[]`, compare each pattern against `avoid.patterns` from the crawl brief using simple substring matching. If ≥2 patterns match avoid-patterns, mark this creative as `performance_tier: underperformer` rather than discarding — Aanya still learns from negative examples.

---

### STEP 5 — Assign Metadata

Map crawl context to the Aanya schema fields:

```python
def assign_metadata(image_url: str, crawl_brief: dict, source_platform: str) -> dict:
    # source: all crawled creatives are competitor or industry_reference
    source = "competitor" if "competitor" in image_url.lower() else "industry_reference"

    # platform: map from crawl source to enum value
    platform_map = {
        "instagram_feed": "instagram_feed",
        "instagram_story": "instagram_story",
        "meta_feed": "meta_feed",
        "meta_story": "meta_story",
        "facebook": "meta_feed",
        "whatsapp": "whatsapp",
    }
    platform = platform_map.get(source_platform, "meta_feed")

    # performance_tier: default to reference_only
    # promote to good_performer if Haiku patterns closely match crawl_targets
    # demote to underperformer if patterns match avoid list
    tier = "reference_only"

    return {
        "source": source,
        "platform": platform,
        "performance_tier": tier,
        "cpl": None,   # unknown from web — must be manually set
        "ctr": None,   # unknown from web — must be manually set
        "notes": f"Auto-crawled — {source_platform} — {crawl_brief['scope']}",
    }
```

**Tier auto-promotion logic**: count how many of the image's Haiku patterns match patterns in `crawl_targets.visual_patterns_to_replicate` (string similarity ≥ 70%). If ≥3 patterns match, set `performance_tier: good_performer`. If ≥5 match, set `top_performer`. This lets the agent pre-sort quality without manual review.

---

### STEP 6 — Insert Row into `aanya_training_creatives`

```python
def insert_training_creative(
    storage_result: dict,
    vision: dict,
    meta: dict,
    org_id: str,
    project_id: str | None
):
    row = {
        "org_id": org_id,
        "project_id": project_id,
        "image_url": storage_result["url"],
        "storage_path": storage_result["path"],
        "source": meta["source"],
        "platform": meta["platform"],
        "performance_tier": meta["performance_tier"],
        "cpl": meta["cpl"],
        "ctr": meta["ctr"],
        "notes": meta["notes"],
        "vision_analysis": {
            "description": vision["description"],
            "patterns": vision["patterns"],
        },
        "extracted_patterns": {
            "patterns": vision["patterns"],
        },
    }

    result = sb.table("aanya_training_creatives").insert(row).execute()
    if result.data:
        print(f"Inserted: {result.data[0]['id']}")
    else:
        print(f"Insert failed: {result}")
```

RLS on `aanya_training_creatives` uses `org_id = get_current_user_org_id()`. The agent uses the **service role key** which bypasses RLS — this is correct for batch ingestion. Never use the anon key for agent inserts.

---

### STEP 7 — Deduplication Check

Before inserting, check whether the image URL or a near-identical storage path already exists:

```python
def is_duplicate(image_url: str, org_id: str) -> bool:
    # Exact URL match
    result = (
        sb.table("aanya_training_creatives")
        .select("id")
        .eq("org_id", org_id)
        .eq("image_url", image_url)
        .limit(1)
        .execute()
    )
    return len(result.data) > 0
```

Skip the image if `is_duplicate` returns `True`. For image-hash deduplication (same image, different URL), compute a perceptual hash of the downloaded bytes and store it in `notes` — compare before insert.

---

### STEP 8 — Rate Limiting and Batch Control

Run the pipeline with these guards:

```python
MAX_CREATIVES_PER_RUN = 20        # avoid flooding Aanya's memory in one session
DELAY_BETWEEN_IMAGES_SEC = 2      # respect robots.txt / API rate limits
HAIKU_CALLS_PER_MINUTE = 30       # Haiku tier limit

for i, image_url in enumerate(candidate_urls[:MAX_CREATIVES_PER_RUN]):
    if is_duplicate(image_url, ORG_ID):
        continue
    storage_result = download_and_upload(image_url, ORG_ID)
    vision = analyze_creative(storage_result["url"])
    if vision is None:
        continue   # Haiku failed — skip rather than insert empty analysis
    meta = assign_metadata(image_url, crawl_brief, detected_platform)
    insert_training_creative(storage_result, vision, meta, ORG_ID, PROJECT_ID)
    time.sleep(DELAY_BETWEEN_IMAGES_SEC)
```

---

### STEP 9 — Post-Ingestion: Trigger DNA Synthesis (Optional)

After inserting ≥5 new creatives, the agent can trigger DNA synthesis automatically by calling the Supabase Edge Function (if one exists) or by posting a notification. Currently, synthesis requires a human click in the UI — this is intentional so the user can review crawled creatives before distilling.

**Recommended agent output** — write a summary JSON to stdout:

```json
{
  "run_at": "2026-06-13T14:30:00Z",
  "scope": "Neelachala Meadows",
  "candidates_found": 34,
  "duplicates_skipped": 6,
  "vision_failures": 2,
  "inserted": 20,
  "tier_breakdown": {
    "top_performer": 2,
    "good_performer": 7,
    "reference_only": 9,
    "underperformer": 2
  },
  "next_step": "Open Aanya's Memory → select project → click Synthesize DNA"
}
```

---

### Full Agent Flow Diagram

```
Crawl Parameters JSON (from UI)
    │
    ▼
STEP 1 — Parse brief → build search query + avoid list
    │
    ▼
STEP 2 — Discover image URLs (Meta Ad Library / Google / Instagram)
    │   apply quality gate: size, format, content-type
    │
    ▼
STEP 3 — Download + upload to brand-assets/aanya-training/{orgId}/
    │
    ▼
STEP 4 — Claude Haiku vision → description + patterns[]
    │   apply avoid-pattern filter → set tier: underperformer if ≥2 matches
    │
    ▼
STEP 5 — Assign source / platform / performance_tier / notes
    │   auto-promote tier if ≥3 patterns match crawl_targets
    │
    ▼
STEP 6 — INSERT into aanya_training_creatives
    │   (service role key — bypasses RLS)
    │
    ▼
STEP 7 — Dedup check (skip if URL already in org's training set)
    │
    ▼
STEP 8 — Rate limit: 2s delay, max 20 per run, 30 Haiku calls/min
    │
    ▼
STEP 9 — Print summary → prompt user to click "Synthesize DNA" in UI
```

---

### Schema Validation Checklist

Before every insert, verify these constraints or the DB will reject the row:

| Field | Allowed values | Default if unknown |
|---|---|---|
| `source` | `own_ad` `competitor` `industry_reference` `winning_template` | `industry_reference` |
| `platform` | `meta_feed` `meta_story` `instagram_feed` `instagram_story` `whatsapp` `google_display` `null` | `null` |
| `performance_tier` | `top_performer` `good_performer` `average` `underperformer` `reference_only` | `reference_only` |
| `vision_analysis` | `{ description: string, patterns: string[] }` | `null` (skip row) |
| `org_id` | must match a valid org UUID | agent must read from env |
| `image_url` | must be a reachable public URL (Supabase storage public URL) | — |
| `storage_path` | relative path inside `brand-assets` bucket | — |