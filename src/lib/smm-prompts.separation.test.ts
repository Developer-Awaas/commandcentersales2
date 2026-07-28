import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSMMCreativePrompt } from './smm-prompts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Markers that are distinctive to the ad-strategy prompt library
// (senior-designer-prompts.ts) — a direct-social SMM post should never read
// like an ad brief for Aanya/GPT-Image-1's 9-section format.
const AD_STRATEGY_MARKERS = [
  'Aanya Mehta',
  'Senior Creative Director',
  'GPT-Image-1',
  'SECTION 1: SCENE NARRATIVE',
  'nanobanana_prompt_main',
];

// Markers that should show up in a real SMM creative prompt (direct-social
// tone: caption + hashtags + posting time, not an ad funnel brief).
const SMM_MARKERS = ['Instagram caption', 'captionEn', 'hashtags'];

describe('SMM creative prompts are a separate template from the ad-strategy library', () => {
  it('buildSMMCreativePrompt output contains SMM-specific fields, not ad-strategy fields', () => {
    const prompt = buildSMMCreativePrompt({
      type: 'company_branding',
      description: 'Showcase our 10th anniversary',
      platform: 'Nanobanana (Gemini)',
    });

    for (const marker of SMM_MARKERS) {
      expect(prompt).toContain(marker);
    }
    for (const marker of AD_STRATEGY_MARKERS) {
      expect(prompt).not.toContain(marker);
    }
  });

  it('smm-prompts.ts does not import from senior-designer-prompts.ts (architectural separation, not just current disuse)', () => {
    const source = readFileSync(join(__dirname, 'smm-prompts.ts'), 'utf8');
    expect(source).not.toMatch(/senior-designer-prompts/);
  });

  it('SMMCreatives.tsx (the page that calls this) imports only smm-prompts.ts, never the ad-strategy library', () => {
    const source = readFileSync(join(__dirname, '..', 'pages', 'SMMCreatives.tsx'), 'utf8');
    expect(source).toMatch(/from ['"]\.\.\/lib\/smm-prompts['"]/);
    expect(source).not.toMatch(/senior-designer-prompts/);
  });
});
