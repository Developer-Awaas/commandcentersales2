export function formatProject(p: any): string {
  if (!p) return 'No project selected';
  const parts = [
    p.name || p['Project Name'] || 'Unknown',
    (p.locality || p.Locality || '') + ' ' + (p.city || p.City || 'Bhubaneswar'),
    'Status: ' + (p.status || p['Project Status'] || 'Unknown'),
    (p.units_remaining || p['Units Remaining'] || 0) + '/' + (p.total_units || p['Total Units'] || 0) + ' units',
    'Rs ' + (p.price_range_lacs || p['Price Range (Lacs)'] || '?') + 'L',
    (p.unit_types || p['Unit Types'] || ''),
    'USPs: ' + (p.usps || p.USPs || 'None listed'),
    'Amenities: ' + (p.amenities || p.Amenities || 'None listed'),
    'Notes: ' + (p.notes || p.Notes || ''),
  ];
  return parts.filter(Boolean).join('. ');
}

export function formatCompetitors(competitors: any): string {
  if (!competitors || competitors.length === 0) return 'No competitors listed';
  return competitors.map((c: any) => typeof c === 'string' ? c : c.name).join(', ');
}
