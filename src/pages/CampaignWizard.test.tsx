import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// Proves CampaignWizard COMPOSES the shared generation components (the
// actual de-dup deliverable) rather than re-testing their internals,
// which StrategyGenerator.test.tsx and history-service.test.ts already
// cover. Stubs both as simple buttons that fire their real onSaved
// contract shape.
vi.mock('../components/generation/StrategyGenerator', () => ({
  StrategyGenerator: ({ campaignId, onSaved }: { campaignId: string | null; onSaved: (r: unknown) => void }) => (
    <button
      data-testid="strategy-generator-stub"
      data-campaign-id={campaignId ?? 'null'}
      onClick={() => onSaved({
        outputId: 'strategy-output-1', data: { creative_concept: 'x' }, projectId: 'proj1',
        projectName: 'Test Project', funnelStage: 'BOFU', savedCreativeId: 'creative1',
      })}
    >
      StrategyGenerator stub
    </button>
  ),
}));
vi.mock('../components/generation/CreativeGenerator', () => ({
  CreativeGenerator: ({ campaignId, strategyOutputId, onSaved }: { campaignId: string | null; strategyOutputId: string | null; onSaved: (r: unknown) => void }) => (
    <button
      data-testid="creative-generator-stub"
      data-campaign-id={campaignId ?? 'null'}
      data-strategy-output-id={strategyOutputId ?? 'null'}
      onClick={() => onSaved({ outputId: 'creatives-output-1', assetIds: ['a1', 'a2'] })}
    >
      CreativeGenerator stub
    </button>
  ),
}));

const insertedCampaigns: Record<string, unknown>[] = [];
const updatedToolOutputs: { id: string; campaign_id: string }[] = [];

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      const builder: Record<string, unknown> = {};
      const returnSelf = () => builder;
      builder.select = vi.fn(returnSelf);
      builder.eq = vi.fn(returnSelf);
      builder.order = vi.fn(returnSelf);
      builder.limit = vi.fn(returnSelf);
      builder.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
      builder.single = vi.fn(() => Promise.resolve({ data: { id: 'campaign1' }, error: null }));
      builder.insert = vi.fn((row: Record<string, unknown>) => {
        if (table === 'campaigns') insertedCampaigns.push(row);
        return builder;
      });
      builder.update = vi.fn((row: Record<string, unknown>) => {
        if (table === 'tool_outputs' && 'campaign_id' in row) {
          updatedToolOutputs.push({ id: 'pending', campaign_id: row.campaign_id as string });
        }
        return builder;
      });
      builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
      return builder;
    }),
  },
}));
vi.mock('../lib/constants', () => ({ getOrgId: () => 'org1' }));

beforeEach(() => { vi.clearAllMocks(); insertedCampaigns.length = 0; updatedToolOutputs.length = 0; });
afterEach(() => { cleanup(); });

describe('CampaignWizard composition', () => {
  it('Strategy step renders StrategyGenerator; saving creates a real campaigns row and threads campaign_id into the Creatives step', async () => {
    const { CampaignWizard } = await import('./CampaignWizard');
    render(<CampaignWizard />);

    const strategyStub = await screen.findByTestId('strategy-generator-stub');
    expect(strategyStub.getAttribute('data-campaign-id')).toBe('null');

    fireEvent.click(strategyStub);

    // handleStrategyResult creates the campaigns row and attaches
    // campaign_id back onto the just-saved strategy tool_output.
    await waitFor(() => expect(insertedCampaigns).toHaveLength(1));
    expect(insertedCampaigns[0]).toMatchObject({ org_id: 'org1', project_id: 'proj1', status: 'active' });
    await waitFor(() => expect(updatedToolOutputs).toHaveLength(1));
    expect(updatedToolOutputs[0].campaign_id).toBe('campaign1');

    // Advance to step 2 — Save & Continue is enabled now that strategyResult exists.
    fireEvent.click(screen.getByRole('button', { name: /save & continue/i }));

    const creativeStub = await screen.findByTestId('creative-generator-stub');
    expect(creativeStub.getAttribute('data-campaign-id')).toBe('campaign1');
    expect(creativeStub.getAttribute('data-strategy-output-id')).toBe('strategy-output-1');
  });
});
