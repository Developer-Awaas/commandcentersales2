// src/lib/design-system-learning.ts
// PURPOSE: The recursive learning loop. After creatives run and metrics come in,
// this module:
//   1. Computes performance scores for each creative
//   2. Tags top/middle/bottom performers
//   3. Aggregates winning patterns into the project's Design DNA
//   4. Generates a natural-language DNA summary for prompt injection
//
// Triggered:
//   - Manually from Project Performance tab (Recompute Design DNA button)
//   - Automatically after Analyzer saves new metrics for a project
//   - Scheduled weekly via a Supabase cron job

import { supabase } from './supabase';

export interface CreativeRecord {
  id: string;
  project_id: string;
  org_id: string;
  design_dna_tags: {
    angle?: string;
    composition?: string;
    color_treatment?: string;
    copy_angle?: string;
    lighting?: string;
  };
  variant?: string;
  created_at: string;
}

export interface MetricsRecord {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  conversions?: number;
  date: string;
}

// ============================================================
// 1. CALCULATE PERFORMANCE SCORE FOR A CREATIVE
// ============================================================

interface PerformanceContext {
  project_avg_cpl: number;
  project_avg_ctr: number;
  industry_baseline_cpl: number;
}

export function calculatePerformanceScore(
  metrics: { cpl: number; ctr: number; conversion_rate?: number },
  context: PerformanceContext
): { score: number; tier: 'top_25' | 'middle_50' | 'bottom_25' | 'insufficient_data' } {
  // Score from 0-10 weighted: CPL 50%, CTR 30%, Conversion 20%
  // Lower CPL = better, higher CTR = better

  if (!metrics.cpl || metrics.cpl === 0) {
    return { score: 0, tier: 'insufficient_data' };
  }

  // CPL component: how much better/worse than project average
  // Score 10 if CPL is 50% of average; score 5 if equal; score 0 if 200% of average
  const cplRatio = context.project_avg_cpl > 0 ? metrics.cpl / context.project_avg_cpl : 1;
  const cplScore = Math.max(0, Math.min(10, 10 - (cplRatio - 0.5) * 10));

  // CTR component
  const ctrRatio = context.project_avg_ctr > 0 ? metrics.ctr / context.project_avg_ctr : 1;
  const ctrScore = Math.max(0, Math.min(10, 5 + (ctrRatio - 1) * 5));

  // Conversion component (optional)
  let convScore = 5; // neutral if not available
  if (metrics.conversion_rate !== undefined && metrics.conversion_rate > 0) {
    convScore = Math.min(10, metrics.conversion_rate * 100); // 10% conv = 10 score
  }

  const finalScore = cplScore * 0.5 + ctrScore * 0.3 + convScore * 0.2;

  let tier: 'top_25' | 'middle_50' | 'bottom_25';
  if (finalScore >= 7.5) tier = 'top_25';
  else if (finalScore >= 4.5) tier = 'middle_50';
  else tier = 'bottom_25';

  return { score: Math.round(finalScore * 10) / 10, tier };
}

// ============================================================
// 2. AGGREGATE PATTERNS BY DIMENSION
// ============================================================

interface PerformanceRecord {
  creative_id: string;
  design_dna_tags: any;
  cpl: number;
  ctr: number;
  performance_score: number;
  performance_tier: string;
}

function aggregateByDimension(
  records: PerformanceRecord[],
  dimension: 'angle' | 'composition' | 'color_treatment' | 'copy_angle' | 'lighting'
) {
  // Group by dimension value
  const grouped: Record<string, PerformanceRecord[]> = {};

  records.forEach(r => {
    const value = r.design_dna_tags?.[dimension];
    if (!value) return;
    if (!grouped[value]) grouped[value] = [];
    grouped[value].push(r);
  });

  // Compute aggregates
  const aggregated = Object.entries(grouped).map(([value, group]) => {
    const cpls = group.map(g => g.cpl).filter(c => c > 0);
    const ctrs = group.map(g => g.ctr).filter(c => c > 0);
    const scores = group.map(g => g.performance_score).filter(s => s > 0);

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a,b) => a+b, 0) / arr.length : 0;

    return {
      [dimension]: value,
      avg_cpl: Math.round(avg(cpls)),
      avg_ctr: Math.round(avg(ctrs) * 100) / 100,
      avg_score: Math.round(avg(scores) * 10) / 10,
      sample_size: group.length,
      example_creative_ids: group.slice(0, 3).map(g => g.creative_id),
      confidence: group.length >= 5 ? 'high' : group.length >= 3 ? 'medium' : 'low',
    };
  });

  return aggregated.sort((a, b) => b.avg_score - a.avg_score);
}

// ============================================================
// 3. RECOMPUTE DESIGN SYSTEM FOR A PROJECT
// ============================================================

export async function recomputeProjectDesignSystem(projectId: string): Promise<{
  success: boolean;
  total_analyzed: number;
  confidence: string;
  message: string;
}> {
  // Step 1: Pull all creative_performance records for this project
  const { data: perfRecords, error: perfError } = await supabase
    .from('creative_performance')
    .select(`
      id, creative_id, performance_score, performance_tier,
      cpl, ctr, total_leads, total_spend,
      design_dna_snapshot
    `)
    .eq('project_id', projectId);

  if (perfError) {
    return { success: false, total_analyzed: 0, confidence: 'insufficient', message: `Error: ${perfError.message}` };
  }

  if (!perfRecords || perfRecords.length === 0) {
    return { success: false, total_analyzed: 0, confidence: 'insufficient', message: 'No creative performance records yet for this project.' };
  }

  // Filter to records with valid DNA snapshots
  const validRecords: PerformanceRecord[] = perfRecords
    .filter(r => r.design_dna_snapshot && Object.keys(r.design_dna_snapshot).length > 0)
    .map(r => ({
      creative_id: r.creative_id,
      design_dna_tags: r.design_dna_snapshot,
      cpl: r.cpl || 0,
      ctr: r.ctr || 0,
      performance_score: r.performance_score || 0,
      performance_tier: r.performance_tier || 'insufficient_data',
    }));

  if (validRecords.length === 0) {
    return { success: false, total_analyzed: 0, confidence: 'insufficient', message: 'No creatives with design DNA tags yet. Generate new creatives with the Senior Designer system.' };
  }

  // Step 2: Aggregate by each dimension
  const angles = aggregateByDimension(validRecords, 'angle').slice(0, 5);
  const compositions = aggregateByDimension(validRecords, 'composition').slice(0, 5);
  const colorTreatments = aggregateByDimension(validRecords, 'color_treatment').slice(0, 5);
  const copyAngles = aggregateByDimension(validRecords, 'copy_angle').slice(0, 5);
  const lightings = aggregateByDimension(validRecords, 'lighting').slice(0, 5);

  // Step 3: Identify underperforming patterns (bottom 25% with sample_size >= 2)
  const allDimensions = [...angles, ...compositions, ...colorTreatments, ...copyAngles, ...lightings];
  const underperformers = allDimensions
    .filter(p => p.avg_score < 4 && p.sample_size >= 2)
    .map(p => {
      const dim = Object.keys(p).find(k => !['avg_cpl','avg_ctr','avg_score','sample_size','example_creative_ids','confidence'].includes(k));
      return {
        pattern: `${dim}: ${(p as any)[dim!]}`,
        avg_cpl: p.avg_cpl,
        avg_score: p.avg_score,
        sample_size: p.sample_size,
        verdict: 'avoid',
      };
    });

  // Step 4: Determine confidence level
  const totalAnalyzed = validRecords.length;
  let confidence: string;
  if (totalAnalyzed < 3) confidence = 'insufficient';
  else if (totalAnalyzed < 10) confidence = 'low';
  else if (totalAnalyzed < 25) confidence = 'medium';
  else if (totalAnalyzed < 50) confidence = 'high';
  else confidence = 'very_high';

  // Step 5: Generate natural-language DNA summary for prompt injection
  const dnaSummary = generateDNASummary({
    totalAnalyzed,
    confidence,
    topAngle: angles[0],
    topComposition: compositions[0],
    topColor: colorTreatments[0],
    topCopy: copyAngles[0],
    topLighting: lightings[0],
    underperformers: underperformers.slice(0, 3),
  });

  // Step 6: Get org_id for the project
  const { data: project } = await supabase
    .from('projects')
    .select('org_id')
    .eq('id', projectId)
    .single();

  if (!project) {
    return { success: false, total_analyzed: totalAnalyzed, confidence, message: 'Project not found.' };
  }

  // Step 7: Upsert project_design_systems
  const { error: upsertError } = await supabase
    .from('project_design_systems')
    .upsert({
      project_id: projectId,
      org_id: project.org_id,
      best_performing_angles: angles,
      best_performing_compositions: compositions,
      best_performing_color_treatments: colorTreatments,
      best_performing_copy_angles: copyAngles,
      best_performing_lighting_styles: lightings,
      underperforming_patterns: underperformers,
      total_creatives_analyzed: totalAnalyzed,
      total_campaigns_analyzed: 0, // could compute from distinct campaign_ids
      confidence_level: confidence,
      dna_summary: dnaSummary,
      last_recomputed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'project_id' });

  if (upsertError) {
    return { success: false, total_analyzed: totalAnalyzed, confidence, message: `Upsert error: ${upsertError.message}` };
  }

  return {
    success: true,
    total_analyzed: totalAnalyzed,
    confidence,
    message: `Design DNA recomputed from ${totalAnalyzed} creatives. Confidence: ${confidence}. Top angle: "${angles[0]?.angle || 'N/A'}" (CPL ₹${angles[0]?.avg_cpl || 'N/A'}).`,
  };
}

// ============================================================
// 4. NATURAL LANGUAGE DNA SUMMARY GENERATOR
// ============================================================

function generateDNASummary(input: {
  totalAnalyzed: number;
  confidence: string;
  topAngle?: any;
  topComposition?: any;
  topColor?: any;
  topCopy?: any;
  topLighting?: any;
  underperformers: any[];
}): string {
  const parts: string[] = [];

  parts.push(`Based on ${input.totalAnalyzed} past creatives (confidence: ${input.confidence}):`);

  if (input.topAngle && input.topAngle.sample_size >= 2) {
    parts.push(`The strongest angle is "${input.topAngle.angle}" with avg CPL ₹${input.topAngle.avg_cpl} across ${input.topAngle.sample_size} creatives.`);
  }

  if (input.topComposition && input.topComposition.sample_size >= 2) {
    parts.push(`The most effective composition pattern is "${input.topComposition.composition}".`);
  }

  if (input.topColor && input.topColor.sample_size >= 2) {
    parts.push(`The best-performing color treatment is "${input.topColor.color_treatment}".`);
  }

  if (input.topCopy && input.topCopy.sample_size >= 2) {
    parts.push(`Copy angle "${input.topCopy.copy_angle}" has driven the strongest engagement.`);
  }

  if (input.topLighting && input.topLighting.sample_size >= 2) {
    parts.push(`Lighting style "${input.topLighting.lighting}" has been most effective visually.`);
  }

  if (input.underperformers.length > 0) {
    const avoidList = input.underperformers.map(p => `"${p.pattern}"`).join(', ');
    parts.push(`Patterns to avoid based on weak performance: ${avoidList}.`);
  }

  if (input.confidence === 'low' || input.confidence === 'insufficient') {
    parts.push(`This DNA is still developing — treat as soft preference, continue experimenting.`);
  } else if (input.confidence === 'high' || input.confidence === 'very_high') {
    parts.push(`This DNA is well-established — deviations should be intentional experiments only.`);
  }

  return parts.join(' ');
}

// ============================================================
// 5. LINK CREATIVE TO PERFORMANCE METRICS
// ============================================================
// Called when:
//   - User uploads daily metrics in Analyzer
//   - User manually links a creative to a campaign
//   - Background job aggregates weekly

export async function linkCreativeToMetrics(args: {
  creative_id: string;
  campaign_id?: string;
  project_id: string;
  metrics: {
    spend: number;
    impressions: number;
    clicks: number;
    leads: number;
    conversions?: number;
  };
  period_start: string;
  period_end: string;
  design_dna_snapshot: any;
}): Promise<{ success: boolean; performance_score: number; message: string }> {
  const { metrics } = args;

  // Calculate KPIs
  const cpl = metrics.leads > 0 ? Math.round(metrics.spend / metrics.leads) : 0;
  const ctr = metrics.impressions > 0 ? Math.round((metrics.clicks / metrics.impressions) * 10000) / 100 : 0;
  const cpm = metrics.impressions > 0 ? Math.round((metrics.spend / metrics.impressions) * 1000) : 0;
  const conversion_rate = metrics.leads > 0 && metrics.conversions ? metrics.conversions / metrics.leads : 0;

  // Get project benchmarks for context
  const { data: projectMetrics } = await supabase
    .from('daily_metrics')
    .select('cpl, ctr')
    .eq('project_id', args.project_id);

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a,b) => a+b, 0) / arr.length : 0;
  const projectAvgCPL = projectMetrics ? avg(projectMetrics.map((m: any) => m.cpl).filter((c: number) => c > 0)) : 100;
  const projectAvgCTR = projectMetrics ? avg(projectMetrics.map((m: any) => m.ctr).filter((c: number) => c > 0)) : 1.5;

  // Calculate performance score
  const { score, tier } = calculatePerformanceScore(
    { cpl, ctr, conversion_rate },
    {
      project_avg_cpl: projectAvgCPL,
      project_avg_ctr: projectAvgCTR,
      industry_baseline_cpl: 130, // Indian real estate baseline
    }
  );

  // Get org_id
  const { data: project } = await supabase
    .from('projects')
    .select('org_id')
    .eq('id', args.project_id)
    .single();

  if (!project) {
    return { success: false, performance_score: 0, message: 'Project not found.' };
  }

  const days = Math.ceil(
    (new Date(args.period_end).getTime() - new Date(args.period_start).getTime()) / (1000 * 60 * 60 * 24)
  );

  // Insert performance record
  const { error } = await supabase
    .from('creative_performance')
    .insert({
      creative_id: args.creative_id,
      campaign_id: args.campaign_id,
      project_id: args.project_id,
      org_id: project.org_id,
      total_spend: metrics.spend,
      total_impressions: metrics.impressions,
      total_clicks: metrics.clicks,
      total_leads: metrics.leads,
      total_conversions: metrics.conversions || 0,
      cpl,
      ctr,
      cpm,
      conversion_rate,
      performance_score: score,
      performance_tier: tier,
      design_dna_snapshot: args.design_dna_snapshot,
      period_start: args.period_start,
      period_end: args.period_end,
      days_active: days,
    });

  if (error) {
    return { success: false, performance_score: 0, message: `Insert error: ${error.message}` };
  }

  // Trigger DNA recompute (async, don't wait)
  recomputeProjectDesignSystem(args.project_id).catch(err =>
    console.error('DNA recompute failed:', err)
  );

  return {
    success: true,
    performance_score: score,
    message: `Creative linked. Performance: ${score}/10 (${tier}). Project DNA updated.`,
  };
}

// ============================================================
// 6. FETCH DESIGN DNA FOR PROMPT INJECTION
// ============================================================

export async function getDesignDNAForProject(projectId: string) {
  const { data, error } = await supabase
    .from('project_design_systems')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}
