export interface ProjectConfiguration {
  type: string;
  carpet: string;
  price_lacs: string;
  total_units: number | null;
  remaining_units: number | null;
  available: boolean;
  notes: string;
}

export interface PriceHistoryEntry {
  date: string;
  type: string;
  old_price: string;
  new_price: string;
  source: string;
}

export interface Project {
  id: string;
  org_id: string | null;
  name: string;
  code: string | null;
  locality: string | null;
  city: string | null;
  nearest_landmarks: string | null;
  status: string | null;
  completion_pct: number | null;
  expected_possession: string | null;
  total_units: number | null;
  units_remaining: number | null;
  unit_types: string | null;
  carpet_area_range: string | null;
  price_range_lacs: string | null;
  per_sqft_rate: number | null;
  usps: string | null;
  amenities: string | null;
  target_buyer: string | null;
  priority: string | null;
  budget_segment: string | null;
  rera_number: string | null;
  landing_page_url: string | null;
  brochure_url: string | null;
  whatsapp_flow: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  configurations: ProjectConfiguration[] | null;
  price_history: PriceHistoryEntry[] | null;
}

export type ProjectView = 'list' | 'detail' | 'form';

export const EMPTY_FORM: Omit<Project, 'id' | 'org_id' | 'is_active' | 'created_at' | 'updated_at'> = {
  name: '',
  code: '',
  locality: '',
  city: 'Bhubaneswar',
  nearest_landmarks: '',
  status: 'Upcoming',
  completion_pct: null,
  expected_possession: '',
  total_units: null,
  units_remaining: null,
  unit_types: '',
  carpet_area_range: '',
  price_range_lacs: '',
  per_sqft_rate: null,
  usps: '',
  amenities: '',
  target_buyer: 'End-user',
  priority: 'Medium',
  budget_segment: '',
  rera_number: '',
  landing_page_url: '',
  brochure_url: '',
  whatsapp_flow: '',
  notes: '',
  configurations: [],
  price_history: [],
};

export const PRIORITY_STYLES: Record<string, string> = {
  High: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  Medium: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
  Low: 'bg-[#7a9988]/10 text-[#7a9988] border border-[#7a9988]/20',
};

export const CONFIG_TYPE_OPTIONS = [
  '1BHK', '1.5BHK', '2BHK', '2.5BHK', '3BHK', '3.5BHK', '4BHK', '5BHK',
  'Studio', 'Penthouse', 'Duplex', 'Villa', 'Plot', 'Shop', 'Office',
];

export const EMPTY_CONFIG: ProjectConfiguration = {
  type: '2BHK',
  carpet: '',
  price_lacs: '',
  total_units: null,
  remaining_units: null,
  available: true,
  notes: '',
};

export function deriveFieldsFromConfigs(configs: ProjectConfiguration[]): {
  unit_types: string;
  total_units: number | null;
  units_remaining: number | null;
  price_range_lacs: string;
  carpet_area_range: string;
} {
  if (!configs.length) {
    return { unit_types: '', total_units: null, units_remaining: null, price_range_lacs: '', carpet_area_range: '' };
  }
  const types = [...new Set(configs.map((c) => c.type))].join(', ');
  const total = configs.reduce((s, c) => s + (c.total_units ?? 0), 0);
  const remaining = configs.reduce((s, c) => s + (c.remaining_units ?? 0), 0);
  const prices = configs.map((c) => parseFloat(c.price_lacs)).filter((n) => !isNaN(n));
  const carpets = configs.map((c) => parseFloat(c.carpet)).filter((n) => !isNaN(n));
  const priceRange = prices.length
    ? prices.length === 1 ? String(prices[0]) : `${Math.min(...prices)}–${Math.max(...prices)}`
    : '';
  const carpetRange = carpets.length
    ? carpets.length === 1 ? `${carpets[0]} sqft` : `${Math.min(...carpets)}–${Math.max(...carpets)} sqft`
    : '';
  return {
    unit_types: types,
    total_units: total || null,
    units_remaining: remaining || null,
    price_range_lacs: priceRange,
    carpet_area_range: carpetRange,
  };
}

export function autoCreateConfigFromProject(p: Project): ProjectConfiguration[] {
  if (p.configurations && p.configurations.length > 0) return p.configurations;
  const types = (p.unit_types ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!types.length) {
    return [{
      type: '2BHK',
      carpet: p.carpet_area_range ?? '',
      price_lacs: p.price_range_lacs ?? '',
      total_units: p.total_units,
      remaining_units: p.units_remaining,
      available: (p.units_remaining ?? 0) > 0,
      notes: '',
    }];
  }
  return types.map((t) => ({
    type: t,
    carpet: p.carpet_area_range ?? '',
    price_lacs: p.price_range_lacs ?? '',
    total_units: null,
    remaining_units: null,
    available: true,
    notes: '',
  }));
}
