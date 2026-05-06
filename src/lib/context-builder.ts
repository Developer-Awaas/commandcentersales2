import { supabase } from './supabase';

export async function buildContext(options?: { projectId?: string; sessionType?: string }): Promise<string> {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

    let sessionsQuery = supabase
      .from('ai_sessions')
      .select('created_at, session_type, input_summary, output_data, health_score, actions_taken')
      .order('created_at', { ascending: false })
      .limit(5);

    if (options?.projectId) {
      sessionsQuery = sessionsQuery.contains('project_ids', [options.projectId]);
    }

    const [sessionsRes, benchmarksRes, bestCreativeRes, worstCreativeRes, campaignsRes, funnelRes] =
      await Promise.all([
        sessionsQuery,
        supabase
          .from('benchmarks')
          .select('metric_name, current_value, avg_7d, avg_14d, trend, status')
          .order('date', { ascending: false })
          .limit(10),
        supabase
          .from('creatives')
          .select('angle, format, ctr, cpl, review_score')
          .gt('ctr', 0)
          .order('ctr', { ascending: false })
          .limit(1),
        supabase
          .from('creatives')
          .select('angle, format, ctr, cpl, review_score, retirement_reason')
          .eq('status', 'retired')
          .order('ctr', { ascending: true })
          .limit(1),
        supabase
          .from('campaigns')
          .select('campaign_name, funnel_stage, platform, budget, status')
          .eq('status', 'active')
          .limit(10),
        supabase
          .from('lead_funnel')
          .select('total_leads, contacted, sv_done, booked')
          .gte('week_start', thirtyDaysAgo),
      ]);

    const sections: string[] = [];

    const sessions = sessionsRes.data ?? [];
    if (sessions.length > 0) {
      const lines = sessions.map((s, i) => {
        const date = new Date(s.created_at).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });
        const summary = (s.input_summary ?? '').slice(0, 100);
        const score = s.health_score != null ? ` [Score: ${s.health_score}/10]` : '';
        return `${i + 1}. [${date}] ${s.session_type}: ${summary}${score}`;
      });
      sections.push(`PAST SESSIONS:\n${lines.join('\n')}`);
    }

    const benchmarks = benchmarksRes.data ?? [];
    if (benchmarks.length > 0) {
      const seen = new Set<string>();
      const deduped = benchmarks.filter((b) => {
        if (seen.has(b.metric_name)) return false;
        seen.add(b.metric_name);
        return true;
      });
      const lines = deduped.map((b) => {
        const arrow = b.trend === 'up' ? '↑' : b.trend === 'down' ? '↓' : '→';
        const status = b.status ? ` [${String(b.status).toUpperCase()}]` : '';
        const avg7d = b.avg_7d != null ? `, 7d avg: ${b.avg_7d}` : '';
        const avg14d = b.avg_14d != null ? `, 14d: ${b.avg_14d}` : '';
        return `${b.metric_name}: ${b.current_value} (${avg7d}${avg14d}) ${arrow}${status}`;
      });
      sections.push(`BENCHMARKS:\n${lines.join('\n')}`);
    }

    const best = (bestCreativeRes.data ?? [])[0];
    if (best) {
      const score = best.review_score != null ? ` Score: ${best.review_score}/10` : '';
      sections.push(
        `BEST CREATIVE: ${best.angle} angle, ${best.format}. CTR: ${best.ctr}%, CPL: Rs ${best.cpl}.${score}`
      );
    }

    const worst = (worstCreativeRes.data ?? [])[0];
    if (worst) {
      const reason = worst.retirement_reason ? ` Retired: ${worst.retirement_reason}` : '';
      sections.push(
        `WORST CREATIVE: ${worst.angle} angle. CTR: ${worst.ctr}%, CPL: Rs ${worst.cpl}.${reason}`
      );
    }

    const campaigns = campaignsRes.data ?? [];
    if (campaigns.length > 0) {
      const lines = campaigns.map((c) => `- ${c.campaign_name} on ${c.platform}, Rs ${c.budget}/day`);
      sections.push(`ACTIVE CAMPAIGNS: ${campaigns.length} running\n${lines.join('\n')}`);
    }

    const funnelRows = funnelRes.data ?? [];
    if (funnelRows.length > 0) {
      const totals = funnelRows.reduce(
        (acc, row) => ({
          leads: acc.leads + (Number(row.total_leads) || 0),
          contacted: acc.contacted + (Number(row.contacted) || 0),
          sv: acc.sv + (Number(row.sv_done) || 0),
          booked: acc.booked + (Number(row.booked) || 0),
        }),
        { leads: 0, contacted: 0, sv: 0, booked: 0 }
      );
      const svRate = totals.leads > 0 ? Math.round((totals.sv / totals.leads) * 100) : 0;
      const bookingRate = totals.leads > 0 ? Math.round((totals.booked / totals.leads) * 100) : 0;
      sections.push(
        `LEAD FUNNEL (30 days): ${totals.leads} leads → ${totals.contacted} contacted → ${totals.sv} site visits → ${totals.booked} booking. SV rate: ${svRate}%, Booking rate: ${bookingRate}%`
      );
    }

    if (sections.length === 0) {
      return 'No historical data yet — recommendations based on industry best practices for Bhubaneswar real estate.';
    }

    const result = `HISTORICAL CONTEXT (learn from this):\n\n${sections.join('\n\n')}`;
    return result.length > 2000 ? result.slice(0, 1997) + '…' : result;
  } catch {
    return '';
  }
}
