export const META_API_BASE = 'https://graph.facebook.com/v21.0'

export function parseLeadsFromActions(actions: { action_type: string; value: string }[] | undefined): number {
  return parseInt(actions?.find((a) => a.action_type === 'lead')?.value ?? '0') || 0
}

export function parseCplFromCostPerAction(costPerAction: { action_type: string; value: string }[] | undefined): number | null {
  const cpl = costPerAction?.find((a) => a.action_type === 'lead')?.value
  return cpl ? parseFloat(cpl) : null
}

export function isThrottled(headers: Headers): { throttled: boolean; pct: number } {
  const throttleHeader = headers.get('x-fb-ads-insights-throttle')
  if (!throttleHeader) return { throttled: false, pct: 0 }
  try {
    const parsed = JSON.parse(throttleHeader) as { acc_id_util_pct?: number }
    const pct = parsed.acc_id_util_pct ?? 0
    return { throttled: pct > 75, pct }
  } catch {
    return { throttled: false, pct: 0 }
  }
}
