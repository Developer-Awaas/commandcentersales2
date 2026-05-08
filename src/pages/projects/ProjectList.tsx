import { useState } from 'react';
import { Plus, Search, FolderKanban } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { type Project, PRIORITY_STYLES, type ProjectConfiguration } from './types';

function getPriceDisplay(p: Project): string | null {
  const configs: ProjectConfiguration[] = p.configurations?.filter((c) => c.available) ?? [];
  if (configs.length > 0) {
    const prices = configs.map((c) => parseFloat(c.price_lacs)).filter((n) => !isNaN(n) && n > 0);
    if (prices.length === 0) return p.price_range_lacs ?? null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max ? `₹${min} L` : `₹${min}–${max} L`;
  }
  return p.price_range_lacs ? `₹${p.price_range_lacs} L` : null;
}

interface ProjectListProps {
  projects: Project[];
  onSelect: (p: Project) => void;
  onAdd: () => void;
}

function avatarLetter(name: string) {
  return name.trim().charAt(0).toUpperCase();
}

export function ProjectList({ projects, onSelect, onAdd }: ProjectListProps) {
  const [search, setSearch] = useState('');

  const filtered = projects.filter((p) => {
    const q = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.locality ?? '').toLowerCase().includes(q) ||
      (p.city ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-8 min-h-screen bg-surface">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FolderKanban size={20} className="text-brand" />
          <div>
            <h1 className="text-xl font-semibold text-text-primary">
              Projects
              <span className="ml-2 text-sm font-normal text-text-tertiary">({projects.length})</span>
            </h1>
            <p className="text-text-tertiary text-xs mt-0.5">Manage your real estate projects and inventory</p>
          </div>
        </div>
        <Button onClick={onAdd} size="sm">
          <Plus size={15} />
          Add Project
        </Button>
      </div>

      <div className="relative mb-5">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <input
          type="text"
          placeholder="Search by name or locality…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-surface-elevated border border-border rounded-lg pl-9 pr-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-colors"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FolderKanban size={40} className="text-text-disabled mb-4" />
          {search ? (
            <p className="text-text-tertiary text-sm">No projects match "{search}".</p>
          ) : (
            <>
              <p className="text-text-tertiary text-sm">No projects yet.</p>
              <button
                onClick={onAdd}
                className="mt-3 text-sm text-brand hover:underline"
              >
                Click Add Project to get started.
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelect(p)}
              className="w-full text-left flex items-center gap-4 px-5 py-4 rounded-xl bg-surface-elevated border border-border hover:border-brand/30 hover:bg-surface-elevated/80 transition-all duration-150 group"
            >
              <div
                className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-lg font-bold bg-brand-subtle text-brand-text"
              >
                {avatarLetter(p.name)}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-text-primary group-hover:text-brand transition-colors truncate">
                  {p.name}
                </p>
                <p className="text-[12px] text-text-tertiary mt-0.5 truncate">
                  {[p.locality, p.city].filter(Boolean).join(', ') || 'Location not set'}
                </p>
              </div>

              <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                {getPriceDisplay(p) && (
                  <span className="text-[13px] font-medium text-text-primary">
                    {getPriceDisplay(p)}
                  </span>
                )}
                <div className="flex items-center gap-2">
                  {(p.units_remaining != null || p.total_units != null) && (
                    <span className="text-[11px] text-text-tertiary">
                      {p.units_remaining ?? '?'}/{p.total_units ?? '?'} units
                    </span>
                  )}
                  {p.priority && (
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        PRIORITY_STYLES[p.priority] ?? PRIORITY_STYLES['Medium']
                      }`}
                    >
                      {p.priority}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
