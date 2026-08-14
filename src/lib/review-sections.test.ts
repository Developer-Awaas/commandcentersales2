import { describe, it, expect } from 'vitest';
import { strategyReviewSections, creativeReviewSections } from './review-sections';

describe('strategyReviewSections', () => {
  it('always offers the overall concept', () => {
    expect(strategyReviewSections({}).map((s) => s.key)).toContain('concept');
  });

  it('omits sections the result did not actually produce', () => {
    // Asking someone to score a section that was never generated teaches them
    // the form is boilerplate — and the 4 they type to clear it then looks
    // identical to a real 4.
    const keys = strategyReviewSections({ headline: 'Live the skyline' }).map((s) => s.key);
    expect(keys).toContain('headline');
    expect(keys).not.toContain('budget');
    expect(keys).not.toContain('image_brief');
  });

  it('includes budget and image brief when present', () => {
    const keys = strategyReviewSections({
      headline: 'x', targeting: { locations: ['BBSR'] },
      nanobanana_prompt_main: 'a prompt', budget: { daily: 500 },
    }).map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['targeting', 'image_brief', 'budget']));
  });

  it('treats empty-string and null fields as absent', () => {
    const keys = strategyReviewSections({ headline: '', budget: null }).map((s) => s.key);
    expect(keys).not.toContain('headline');
    expect(keys).not.toContain('budget');
  });

  it('never exceeds what the popup will render, and survives null input', () => {
    expect(strategyReviewSections(null).length).toBeGreaterThan(0);
    expect(strategyReviewSections(undefined).length).toBeGreaterThan(0);
  });
});

describe('creativeReviewSections', () => {
  it('names the linked strategy in the fit question', () => {
    // The same creative can be excellent and wrong for the brief that asked
    // for it — the label is what makes that the question being answered.
    const [fit] = creativeReviewSections('lead_generation');
    expect(fit.key).toBe('strategy_fit');
    expect(fit.label).toContain('lead generation');
  });

  it('falls back cleanly when no strategy type is known', () => {
    const [fit] = creativeReviewSections(null);
    expect(fit.label).toBe('Fit for the strategy');
    expect(creativeReviewSections('   ')[0].label).toBe('Fit for the strategy');
  });

  it('always asks exactly the two creative questions', () => {
    expect(creativeReviewSections('branding').map((s) => s.key)).toEqual(['strategy_fit', 'text_quality']);
  });
});
