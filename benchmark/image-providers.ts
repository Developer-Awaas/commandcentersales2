/**
 * One-off image-provider benchmark — produces real per-image and
 * per-interaction cost data so the §5.5 economics and the §6.5 default
 * provider can be chosen from measurement, not assumption.
 *
 * This is a DEV TOOL, not a deployed Edge Function. It is never imported by
 * aanya.ts or any Edge Function — it calls the SAME generateImage()
 * abstraction Aanya uses (supabase/functions/_shared/image-provider.ts),
 * just from a local script instead of from the orchestrator, so the
 * benchmark numbers are guaranteed to reflect exactly what production
 * would pay/get.
 *
 * Usage:
 *   export OPENAI_API_KEY=...
 *   export GEMINI_API_KEY=...   # omit to skip Gemini (will be reported as skipped)
 *   deno run --allow-net --allow-env --allow-read --allow-write benchmark/image-providers.ts
 *
 * Flags:
 *   --providers=openai,gemini   (default: both)
 *   --n=3                       generations per provider per brief (default 3)
 *   --briefs=apartment-launch,villa   (default: all)
 *
 * Output (all under benchmark/output/, gitignored):
 *   output/{provider}/{briefId}/v{n}.{ext}   — generated images
 *   output/results.csv                       — raw per-generation rows
 *   output/results.md                        — aggregated cost/latency table
 *   output/quality-scoring-template.csv       — empty, for human review
 */

import {
  generateImage,
  type ImageProvider,
  type ImageSize,
} from '../supabase/functions/_shared/image-provider.ts'

interface Brief {
  id: string
  category: string
  size: ImageSize
  prompt: string
}

// 8 briefs covering Aanya's actual use case — realistic Indian-market
// scenarios, not generic stock-photo prompts. Each is a complete,
// self-contained text-to-image prompt (scene + composition + lighting +
// color + mood) so the SAME prompt is fair to compare across providers.
const BRIEFS: Brief[] = [
  {
    id: 'apartment-launch',
    category: 'New apartment launch',
    size: '1024x1024',
    prompt:
      'A photorealistic dusk exterior shot of a modern 28-storey premium residential tower in Whitefield, Bangalore, named "Skyline Greens" — glass and beige sandstone facade, curved balconies with glass railings, landscaped podium garden with palm trees in the foreground, infinity pool visible on the terrace level, warm amber window lighting against a deep blue-orange dusk sky, three-quarter low-angle architectural shot on a 24mm wide lens, soft golden-hour backlight at 3200K with long shadows, color palette of warm beige, deep blue, and gold accents, aspirational and premium mood suitable for a real-estate launch ad, ultra-detailed, 8k architectural photography style, no people, no text.',
  },
  {
    id: 'villa',
    category: 'Villa community',
    size: '1024x1024',
    prompt:
      'A photorealistic daytime exterior of a single large contemporary villa within a gated villa community near Gurugram — clean white and natural stone facade, double-height glass living room window, private landscaped lawn with a small reflecting pool, mature trees framing the composition, clear bright blue sky with soft natural clouds, three-quarter front angle on a 35mm lens, midday sunlight at 5600K with crisp short shadows, color palette of white, warm stone beige, and deep green lawn, calm and aspirational lifestyle mood, ultra-detailed architectural photography, no people, no text.',
  },
  {
    id: 'plot-land',
    category: 'Plot / land parcel',
    size: '1024x1024',
    prompt:
      'A photorealistic aerial drone shot of a neatly demarcated open residential plotted-development site on the outskirts of Hyderabad — visible internal roads laid out in a grid, individual plots marked with white boundary stakes, young saplings planted along the road edges, distant hills and a clear horizon under a bright late-morning sky, captured from a 100m altitude drone perspective with a wide-angle lens, natural daylight at 5500K with minimal shadows, color palette of earthy red-brown soil, green sapling rows, and pale grey roads, optimistic and expansive mood suitable for a "your land, your future" land-investment ad, ultra-detailed aerial photography, no people, no text.',
  },
  {
    id: 'commercial-space',
    category: 'Commercial / office space',
    size: '1024x1024',
    prompt:
      'A photorealistic exterior shot of a modern Grade-A commercial office building in the Bandra-Kurla Complex, Mumbai — sleek dark glass curtain-wall facade with horizontal aluminum fins, a wide stone-paved plaza entrance with seating and young trees, a few parked cars hinting at scale, dramatic late-afternoon city skyline in the soft-focus background, three-quarter architectural angle on a 24mm lens, late-afternoon light at 4500K with defined shadows, color palette of charcoal grey, silver, and warm amber reflections, professional and prestigious mood suitable for a commercial leasing ad, ultra-detailed architectural photography, no people, no text.',
  },
  {
    id: 'pre-launch-teaser',
    category: 'Pre-launch teaser',
    size: '1024x1536',
    prompt:
      'A photorealistic moody teaser shot of a residential tower under construction at twilight in Pune, shown partially wrapped in a dark construction scrim with a glowing site floodlight illuminating the silhouette of the rising structure, a faint architectural rendering of the finished tower subtly overlaid as a translucent ghost-image above the real structure, deep indigo twilight sky, vertical portrait composition on a 35mm lens, blue-hour light at 6500K with dramatic rim lighting, color palette of deep indigo, warm floodlight amber, and silver-grey scaffolding, mysterious and anticipatory "something big is coming" mood, ultra-detailed cinematic photography, no people, no text.',
  },
  {
    id: 'price-drop-offer',
    category: 'Price-drop / limited-time offer',
    size: '1024x1024',
    prompt:
      'A photorealistic bright daytime shot of an inviting modern apartment balcony in Chennai overlooking a landscaped courtyard with a swimming pool, warm natural sunlight flooding the balcony with a small potted plant and two outdoor chairs, a sense of immediate move-in readiness and value, eye-level shot on a 35mm lens, midday light at 5600K with soft shadows, color palette of warm terracotta, white, and pool-blue, energetic and urgent "limited-time value" mood without looking cluttered, ultra-detailed real-estate photography, no people, no text, leave the lower third of the frame visually clean and uncluttered for a price/CTA overlay.',
  },
  {
    id: 'amenity-highlight',
    category: 'Amenity highlight',
    size: '1024x1024',
    prompt:
      'A photorealistic shot of a resort-style rooftop infinity swimming pool and clubhouse deck atop a residential tower in Noida, with loungers, string lighting, a small bar counter, and a sweeping city skyline view at golden hour, eye-level shot on a 24mm wide lens, golden-hour light at 3400K with warm long shadows, color palette of turquoise pool water, warm wood decking, and golden sky, indulgent and aspirational lifestyle-amenity mood, ultra-detailed architectural photography, no people, no text.',
  },
  {
    id: 'location-connectivity',
    category: 'Location / connectivity',
    size: '1024x1536',
    prompt:
      'A photorealistic vertical composition showing a modern residential tower in the near foreground on the left third of the frame, with a busy elevated metro line and a metro train passing in the middle distance, and a wide arterial highway with light traffic in the background, set in Pune during late afternoon, conveying strong transit and road connectivity, three-quarter angle on a 28mm lens, late-afternoon light at 4800K with soft shadows, color palette of warm beige building tones, steel-grey infrastructure, and a pale blue sky, confident and convenient "well-connected" mood, ultra-detailed architectural photography, no people, no text, leave the upper third of the frame relatively clean for a headline overlay.',
  },
]

interface ResultRow {
  briefId: string
  category: string
  provider: ImageProvider
  model: string
  variant: number
  success: boolean
  unitCostUsd?: number
  latencyMs?: number
  imagePath?: string
  error?: string
}

function parseArgs() {
  const args = Deno.args
  const get = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
  const providers = (get('providers') ?? 'openai,gemini').split(',').filter(Boolean) as ImageProvider[]
  const n = Number(get('n') ?? '3')
  const briefIds = get('briefs')?.split(',').filter(Boolean)
  const briefs = briefIds ? BRIEFS.filter((b) => briefIds.includes(b.id)) : BRIEFS
  return { providers, n, briefs }
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function extFromMime(mimeType: string): string {
  return mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'bin'
}

async function ensureDir(path: string) {
  await Deno.mkdir(path, { recursive: true })
}

const OUTPUT_DIR = new URL('./output', import.meta.url).pathname

async function runOne(brief: Brief, provider: ImageProvider, variant: number): Promise<ResultRow> {
  const base = { briefId: brief.id, category: brief.category, provider, variant }
  const requiredKey = provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'
  if (!Deno.env.get(requiredKey)) {
    return { ...base, model: provider, success: false, error: `${requiredKey} not set — skipped` }
  }

  const start = performance.now()
  try {
    const result = await generateImage({
      prompt: brief.prompt,
      size: brief.size,
      quality: 'high',
      providerHint: provider,
      observationName: `benchmark-${provider}-${brief.id}-v${variant}`,
    })
    const latencyMs = performance.now() - start

    const dir = `${OUTPUT_DIR}/${provider}/${brief.id}`
    await ensureDir(dir)
    const ext = extFromMime(result.mimeType)
    const imagePath = `${dir}/v${variant}.${ext}`
    await Deno.writeFile(imagePath, base64ToBytes(result.imageBase64))

    return {
      ...base,
      model: result.costMeta.model,
      success: true,
      unitCostUsd: result.costMeta.unitCost,
      latencyMs,
      imagePath,
    }
  } catch (err) {
    return {
      ...base,
      model: provider,
      success: false,
      latencyMs: performance.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function median(values: number[]): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function toCsvValue(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function writeResultsCsv(rows: ResultRow[]): string {
  const headers = ['briefId', 'category', 'provider', 'model', 'variant', 'success', 'unitCostUsd', 'latencyMs', 'imagePath', 'error']
  const lines = [headers.join(',')]
  for (const r of rows) {
    lines.push(headers.map((h) => toCsvValue((r as unknown as Record<string, unknown>)[h])).join(','))
  }
  return lines.join('\n')
}

// INR/USD rate matches the rate already used client-side in Reports.tsx,
// for consistency with the rest of the app's cost reporting.
const INR_PER_USD = 84

// Aanya's loop (aanya.ts) is up to 3 angles × up to 3 critique iterations
// each. These three scenarios bound the real range instead of picking one
// arbitrary average — tune BEST/TYPICAL/WORST once real critique pass-rate
// data exists.
const SCENARIOS = [
  { label: 'Best case (1 iter/angle, no regen)', imagesPerInteraction: 3 },
  { label: 'Typical (assume ~1.5 iter/angle)', imagesPerInteraction: 4.5 },
  { label: 'Worst case (3 iter/angle, full loop)', imagesPerInteraction: 9 },
]

function writeResultsMd(rows: ResultRow[]): string {
  const providers = Array.from(new Set(rows.map((r) => r.provider)))
  const lines: string[] = []
  lines.push('# Image Provider Benchmark Results', '')
  lines.push(`Generated: ${new Date().toISOString()}`, '')

  lines.push('## Per-provider cost & latency', '')
  lines.push('| Provider | Model | Successful images | Failed | Per-image cost (USD) | Per-image cost (INR) | Median latency (ms) |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const provider of providers) {
    const providerRows = rows.filter((r) => r.provider === provider)
    const ok = providerRows.filter((r) => r.success)
    const failed = providerRows.length - ok.length
    const model = ok[0]?.model ?? providerRows[0]?.model ?? provider
    const unitCost = ok[0]?.unitCostUsd // flat per provider in this script
    const latencyMs = median(ok.map((r) => r.latencyMs ?? NaN).filter((n) => !Number.isNaN(n)))
    lines.push(
      `| ${provider} | ${model} | ${ok.length} | ${failed} | ${unitCost?.toFixed(4) ?? 'n/a'} | ${unitCost ? (unitCost * INR_PER_USD).toFixed(2) : 'n/a'} | ${Number.isNaN(latencyMs) ? 'n/a' : latencyMs.toFixed(0)} |`
    )
  }

  lines.push('', '## Projected per-interaction cost vs §5.5 ₹195 figure', '')
  lines.push('Aanya generates up to 3 angles × up to 3 critique iterations each. Scenarios below bound that range:', '')
  lines.push('| Scenario | Images/interaction | ' + providers.map((p) => `${p} cost (INR)`).join(' | ') + ' | vs ₹195 |')
  lines.push('|---|---|' + providers.map(() => '---').join('|') + '|---|')
  for (const scenario of SCENARIOS) {
    const cells = providers.map((p) => {
      const ok = rows.filter((r) => r.provider === p && r.success)
      const unitCost = ok[0]?.unitCostUsd
      if (!unitCost) return 'n/a'
      return (unitCost * INR_PER_USD * scenario.imagesPerInteraction).toFixed(2)
    })
    const anyOver195 = cells.some((c) => c !== 'n/a' && Number(c) > 195)
    lines.push(`| ${scenario.label} | ${scenario.imagesPerInteraction} | ${cells.join(' | ')} | ${anyOver195 ? '⚠️ over' : 'within'} |`)
  }

  lines.push('', '## Failures', '')
  const failures = rows.filter((r) => !r.success)
  if (failures.length === 0) {
    lines.push('None.')
  } else {
    lines.push('| Provider | Brief | Variant | Error |', '|---|---|---|---|')
    for (const f of failures) lines.push(`| ${f.provider} | ${f.briefId} | ${f.variant} | ${f.error} |`)
  }

  return lines.join('\n')
}

function writeQualityTemplateCsv(rows: ResultRow[]): string {
  const headers = [
    'imagePath',
    'provider',
    'model',
    'briefId',
    'category',
    'variant',
    'photorealism_1to5',
    'text_copy_rendering_1to5',
    'architectural_cultural_fit_1to5',
    'brand_safety_1to5',
    'placement_aspect_ratio_1to5',
    'reviewer_notes',
  ]
  const lines = [headers.join(',')]
  for (const r of rows.filter((r) => r.success)) {
    lines.push(
      [r.imagePath, r.provider, r.model, r.briefId, r.category, r.variant, '', '', '', '', '', ''].map(toCsvValue).join(',')
    )
  }
  return lines.join('\n')
}

async function main() {
  const { providers, n, briefs } = parseArgs()
  console.log(`Benchmarking providers=[${providers.join(', ')}] n=${n} briefs=[${briefs.map((b) => b.id).join(', ')}]`)

  for (const provider of providers) {
    const requiredKey = provider === 'openai' ? 'OPENAI_API_KEY' : provider === 'gemini' ? 'GEMINI_API_KEY' : null
    if (requiredKey && !Deno.env.get(requiredKey)) {
      console.warn(`⚠️  ${requiredKey} not set — all "${provider}" generations will be recorded as skipped.`)
    }
  }

  await ensureDir(OUTPUT_DIR)

  const rows: ResultRow[] = []
  for (const brief of briefs) {
    for (const provider of providers) {
      for (let variant = 1; variant <= n; variant++) {
        console.log(`-> ${provider} / ${brief.id} / v${variant}`)
        const row = await runOne(brief, provider, variant)
        rows.push(row)
        console.log(row.success ? `   ok (${row.latencyMs?.toFixed(0)}ms, $${row.unitCostUsd})` : `   FAILED: ${row.error}`)
      }
    }
  }

  await Deno.writeTextFile(`${OUTPUT_DIR}/results.csv`, writeResultsCsv(rows))
  await Deno.writeTextFile(`${OUTPUT_DIR}/results.md`, writeResultsMd(rows))
  await Deno.writeTextFile(`${OUTPUT_DIR}/quality-scoring-template.csv`, writeQualityTemplateCsv(rows))

  console.log(`\nDone. ${rows.filter((r) => r.success).length}/${rows.length} generations succeeded.`)
  console.log(`Results: ${OUTPUT_DIR}/results.csv, ${OUTPUT_DIR}/results.md`)
  console.log(`Quality template: ${OUTPUT_DIR}/quality-scoring-template.csv`)
}

await main()
