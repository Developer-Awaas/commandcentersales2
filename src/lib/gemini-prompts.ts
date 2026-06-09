export const TONE_MAP: Record<string, string> = {
  awareness: 'aspirational, dream-building, wide establishing shot, golden hour lighting',
  consideration: 'informative, feature-highlighting, lifestyle-oriented, warm interiors',
  conversion: 'urgent, value-driven, action-oriented closeup, clear CTA space at bottom third',
}

export const ANGLE_MAP: Record<string, string> = {
  lifestyle: 'Family enjoying the space, natural light, premium feel, aspirational',
  architecture: 'Dramatic exterior shot, strong geometry, sky backdrop, professional photography',
  amenity: 'Close-up of key amenity (pool/gym/garden/lobby), aspirational detail shot',
}

export interface BrandKit {
  primaryColor: string
  accentColor: string
  photographyStyle: string
  typographyStyle: string
}

export interface ProjectContext {
  name: string
  city: string
  type: string
  description: string
  targetBuyer: string
  adFormat: string
}

export function buildImagePrompt(
  brandKit: BrandKit,
  project: ProjectContext,
  funnelStage: string,
  angle: string
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
