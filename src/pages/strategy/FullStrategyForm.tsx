import { CheckSquare, Square, Target } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Spinner } from '../../components/ui/Spinner';
import { type FullStrategyInputs, type StrategyProject } from './types';

const SCALE_OPTIONS = [
  { value: '0-1 bookings/month', label: '0–1 bookings / month' },
  { value: '2-5 bookings/month', label: '2–5 bookings / month' },
  { value: '5-10 bookings/month', label: '5–10 bookings / month' },
  { value: '10+ bookings/month', label: '10+ bookings / month' },
];

interface FullStrategyFormProps {
  projects: StrategyProject[];
  projectsLoading: boolean;
  inputs: FullStrategyInputs;
  onChange: (inputs: FullStrategyInputs) => void;
  onSubmit: () => void;
  submitting: boolean;
}

export function FullStrategyForm({
  projects,
  projectsLoading,
  inputs,
  onChange,
  onSubmit,
  submitting,
}: FullStrategyFormProps) {
  function set<K extends keyof FullStrategyInputs>(key: K, value: FullStrategyInputs[K]) {
    onChange({ ...inputs, [key]: value });
  }

  function toggleProject(id: string) {
    const current = inputs.selectedProjectIds;
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    set('selectedProjectIds', next);
  }

  const noneSelected = inputs.selectedProjectIds.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-5">
        <Card className="p-5 flex flex-col gap-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">Configuration</p>

          <Input
            label="Monthly Budget (₹)"
            type="number"
            min={0}
            value={inputs.monthlyBudget}
            onChange={(e) => set('monthlyBudget', Number(e.target.value))}
          />

          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Leads / mo"
              type="number"
              min={0}
              value={inputs.leadsPerMonth}
              onChange={(e) => set('leadsPerMonth', Number(e.target.value))}
            />
            <Input
              label="SVs / mo"
              type="number"
              min={0}
              value={inputs.svsPerMonth}
              onChange={(e) => set('svsPerMonth', Number(e.target.value))}
            />
            <Input
              label="Bookings / mo"
              type="number"
              min={0}
              value={inputs.bookingsPerMonth}
              onChange={(e) => set('bookingsPerMonth', Number(e.target.value))}
            />
          </div>

          <Select
            label="Scale"
            options={SCALE_OPTIONS}
            value={inputs.scale}
            onChange={(e) => set('scale', e.target.value)}
          />

          <label className="flex items-center gap-3 cursor-pointer group">
            <button
              type="button"
              onClick={() => set('enableOdia', !inputs.enableOdia)}
              className="flex-shrink-0"
            >
              {inputs.enableOdia
                ? <CheckSquare size={16} className="text-brand" />
                : <Square size={16} className="text-text-tertiary group-hover:text-text-primary" />}
            </button>
            <span className="text-sm text-text-primary">Enable Odia vernacular ads</span>
          </label>

          <div className="pt-2 border-t border-[#1e2e24] flex flex-col gap-3">
            <label className="flex items-center gap-3 cursor-pointer group">
              <button
                type="button"
                onClick={() => set('includePerSqft', !inputs.includePerSqft)}
                className="flex-shrink-0"
              >
                {inputs.includePerSqft
                  ? <CheckSquare size={16} className="text-brand" />
                  : <Square size={16} className="text-text-tertiary group-hover:text-text-primary" />}
              </button>
              <span className="text-sm text-text-primary">Include price per sq.ft in ads</span>
            </label>
            {inputs.includePerSqft && (
              <Input
                label="₹ per sq.ft"
                value={inputs.perSqftRate}
                onChange={(e) => set('perSqftRate', e.target.value)}
                placeholder="e.g. 4800"
              />
            )}
          </div>
        </Card>

        <Card className="p-5 flex flex-col gap-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">Select Projects</p>

          {projectsLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Spinner size="sm" />
              <span className="text-xs text-text-tertiary">Loading projects…</span>
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Target size={28} className="text-[#1e2e24] mb-3" />
              <p className="text-sm text-text-tertiary">No active projects found.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2 max-h-[340px] overflow-y-auto pr-1">
              {projects.map((p) => {
                const selected = inputs.selectedProjectIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => toggleProject(p.id)}
                    className={`w-full text-left rounded-lg border p-3 transition-all duration-150 ${
                      selected
                        ? 'border-[#2dd4a8]/50 bg-[#2dd4a8]/[0.06]'
                        : 'border-[#1e2e24] hover:border-[#2dd4a8]/20 hover:bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex-shrink-0">
                        {selected
                          ? <CheckSquare size={14} className="text-brand" />
                          : <Square size={14} className="text-text-tertiary" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${selected ? 'text-brand' : 'text-text-primary'}`}>
                          {p.name}
                        </p>
                        <div className="flex items-center gap-3 mt-0.5">
                          {p.units_remaining != null && (
                            <span className="text-[11px] text-text-tertiary">{p.units_remaining} units left</span>
                          )}
                          {p.price_range_lacs && (
                            <span className="text-[11px] text-text-tertiary">₹{p.price_range_lacs}L</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {inputs.selectedProjectIds.length > 0 && (
            <p className="text-xs text-brand text-right">
              {inputs.selectedProjectIds.length} project{inputs.selectedProjectIds.length !== 1 ? 's' : ''} selected
            </p>
          )}
        </Card>
      </div>

      <Button onClick={onSubmit} disabled={submitting || noneSelected} className="w-full py-3">
        {submitting ? <Spinner size="sm" /> : <Target size={15} />}
        {submitting ? 'Generating…' : 'Generate Strategy'}
      </Button>
    </div>
  );
}
