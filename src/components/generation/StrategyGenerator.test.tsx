import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { QuickGenerateInputs } from '../../pages/strategy/types';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(function (this: unknown) { return this; }),
      eq: vi.fn(function (this: unknown) { return this; }),
      order: vi.fn(function (this: unknown) { return this; }),
      insert: vi.fn(function (this: unknown) { return this; }),
      maybeSingle: vi.fn(() => Promise.resolve({ data: { id: 'creative1' }, error: null })),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    })),
  },
}));
vi.mock('../../lib/constants', () => ({ getOrgId: () => 'org1' }));
vi.mock('../../lib/ai-service', () => ({
  isAiEnabled: () => true,
  describeImageForFlux: vi.fn(),
  aiCall: vi.fn(() => Promise.resolve({
    creative_concept: 'Modern living', ad_copy: { headline_english: 'Great homes', cta: 'Send WhatsApp Message' },
    nanobanana_prompt_main: 'a prompt',
  })),
}));
vi.mock('../../lib/senior-designer-prompts', () => ({
  buildQuickGenerateBrief: vi.fn(() => Promise.resolve({ systemPrompt: 'sys', userPrompt: 'user' })),
}));
vi.mock('../../lib/session-logger', () => ({ logAiSession: vi.fn(), logActivity: vi.fn() }));
const saveToolOutputMock = vi.fn(() => Promise.resolve({ id: 'output1' }));
vi.mock('../../lib/history-service', () => ({ saveToolOutput: saveToolOutputMock }));
vi.mock('../../hooks/useGenerationLock', () => ({ useGenerationLock: () => ({ start: vi.fn(), stop: vi.fn() }) }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../pages/strategy/StrategyResult', () => ({ AanyaDesignerNotes: () => null }));
// Real form has many fields — stub it with a single button that fires a
// valid, pre-filled onChange, so this test exercises StrategyGenerator's
// own orchestration (generate -> collapse -> save) rather than re-testing
// QuickGenerateForm's own field-by-field behavior.
vi.mock('../../pages/strategy/QuickGenerateForm', () => ({
  QuickGenerateForm: ({ onChange }: { onChange: (i: QuickGenerateInputs) => void }) => (
    <button
      data-testid="fill-form"
      onClick={() => onChange({
        prompt: 'test brief', projectId: 'proj1',
        customProject: { name: '', locality: '', city: '', price: '', unitsLeft: '', type: '', usps: '' },
        objective: 'Lead Generation', creativePlatform: 'Nanobanana (Gemini)', adPlatform: 'Meta Ads Manager',
        competitorAnalysis: '', includePerSqft: false, perSqftRate: '',
        campaignGoal: 'lead_generation', languages: ['English'], quickRefs: [],
      })}
    >
      Fill form
    </button>
  ),
}));

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe('StrategyGenerator', () => {
  it('collapses the form to a summary and shows a disabled Generated state after first success, then Save Strategy calls onSaved', async () => {
    const { StrategyGenerator } = await import('./StrategyGenerator');
    const onSaved = vi.fn();
    render(<StrategyGenerator onSaved={onSaved} />);

    // Pre-generation: form visible, no result yet.
    fireEvent.click(await screen.findByTestId('fill-form'));
    const generateButton = screen.getByRole('button', { name: /generate strategy/i });
    fireEvent.click(generateButton);

    // Post-generation: form gone (collapsed to summary), generate button
    // replaced by a disabled "Generated" pill — no regenerate affordance.
    await waitFor(() => expect(screen.queryByTestId('fill-form')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /generated/i })).toBeDisabled();
    expect(screen.getByText('Modern living')).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: /save strategy/i });
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(saveToolOutputMock).toHaveBeenCalledWith(expect.objectContaining({ tool: 'strategy', domain: 'ads' }));
    expect(screen.getByText(/strategy saved/i)).toBeInTheDocument();
  });
});
