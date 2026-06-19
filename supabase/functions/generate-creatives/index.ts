import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database } from '../_shared/database.types.ts'

type DB = SupabaseClient<Database>
type FunnelStage = Database['public']['Tables']['creative_assets']['Row']['funnel_stage']
type CreativeAngle = Database['public']['Tables']['creative_assets']['Row']['angle']

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

const TONE_MAP: Record<string, string> = {
  awareness: 'aspirational, dream-building, wide establishing shot, golden hour lighting',
  consideration: 'informative, feature-highlighting, lifestyle-oriented, warm interiors',
  conversion: 'urgent, value-driven, action-oriented closeup, clear CTA space at bottom third',
}

const ANGLE_MAP: Record<string, string> = {
  lifestyle: 'Family enjoying the space, natural light, premium feel, aspirational',
  architecture: 'Dramatic exterior shot, strong geometry, sky backdrop, professional photography',
  amenity: 'Close-up of key amenity (pool/gym/garden/lobby), aspirational detail shot',
}

interface BrandKit {
  primaryColor: string
  accentColor: string
  photographyStyle: string
  typographyStyle: string
}

interface ProjectContext {
  name: string
  city: string
  type: string
  description: string
  targetBuyer: string
  adFormat: string
}

interface RequestBody {
  orgId: string
  campaignId: string
  funnelStage: FunnelStage
  brandKit: BrandKit
  projectContext: ProjectContext
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() })
  }

  const supabase = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not set' }), { status: 500, headers: corsHeaders() })
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders() })
  }

  const { orgId, campaignId, funnelStage, brandKit, projectContext } = body
  const angles = ['lifestyle', 'architecture', 'amenity'] as const

  // Generate all 3 images in parallel
  const settled = await Promise.allSettled(
    angles.map((angle) => generateAndStore(supabase, apiKey, orgId, campaignId, funnelStage, angle, brandKit, projectContext))
  )

  const assets: Record<string, unknown>[] = []
  const errors: string[] = []

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    if (result.status === 'fulfilled') {
      assets.push(result.value)
    } else {
      errors.push(`${angles[i]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)
    }
  }

  return new Response(
    JSON.stringify({ success: assets.length > 0, assets, errors }),
    { headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
  )
})

async function generateAndStore(
  supabase: DB,
  apiKey: string,
  orgId: string,
  campaignId: string,
  funnelStage: FunnelStage,
  angle: CreativeAngle,
  brandKit: BrandKit,
  projectContext: ProjectContext
): Promise<Record<string, unknown>> {
  const prompt = buildImagePrompt(brandKit, projectContext, funnelStage, angle)

  // Call Gemini Imagen API
  const url = `${GEMINI_BASE}/imagen-3.0-generate-002:predict?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: '1:1', addWatermark: false },
    }),
  })

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(errJson?.error?.message ?? `Gemini API error ${res.status}`)
  }

  const data = await res.json() as { predictions?: { bytesBase64Encoded: string; mimeType?: string }[] }
  const prediction = (data.predictions ?? [])[0]
  if (!prediction) throw new Error('Gemini returned no image')

  const { bytesBase64Encoded: base64, mimeType = 'image/png' } = prediction
  const ext = mimeType.split('/')[1] ?? 'png'

  // Convert base64 to Uint8Array
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  // Upload to Supabase Storage
  const storagePath = `${orgId}/creatives/${campaignId}/${funnelStage}-${angle}.${ext}`
  const { error: uploadErr } = await supabase.storage
    .from('creative-assets')
    .upload(storagePath, bytes, { contentType: mimeType, upsert: true })
  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`)

  const { data: urlData } = supabase.storage.from('creative-assets').getPublicUrl(storagePath)
  const imageUrl = urlData.publicUrl

  // Insert row into creative_assets
  const { data: asset, error: insertErr } = await supabase
    .from('creative_assets')
    .insert({
      org_id: orgId,
      campaign_id: campaignId || null,
      funnel_stage: funnelStage,
      angle,
      image_url: imageUrl,
      storage_path: storagePath,
      prompt_used: prompt,
      model_used: 'imagen-3.0-generate-002',
      status: 'generated',
    })
    .select()
    .single()

  if (insertErr) throw new Error(`DB insert failed: ${insertErr.message}`)
  return asset as Record<string, unknown>
}

function buildImagePrompt(
  brandKit: BrandKit,
  project: ProjectContext,
  funnelStage: FunnelStage,
  angle: CreativeAngle
): string {
  const tone = TONE_MAP[funnelStage] ?? 'aspirational, high quality'
  const angleDesc = ANGLE_MAP[angle] ?? angle
  return `Professional real estate advertisement for ${project.name}.
Location: ${project.city}, India.
Property: ${project.type} — ${project.description}.
Target buyer: ${project.targetBuyer}.
Ad funnel stage: ${funnelStage} — tone: ${tone}.
Visual approach: ${angleDesc}.
Brand palette: primary ${brandKit.primaryColor}, accent ${brandKit.accentColor}.
Style: ${brandKit.photographyStyle}. Photorealistic, high quality.
NO text overlays, NO logos, NO watermarks.
Format: square 1:1 for Instagram/Facebook Feed.`
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  }
}
