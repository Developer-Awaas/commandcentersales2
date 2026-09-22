import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSMMCreativePrompt, brandKitDirectives, resolveBrandName, stripPlaceholders } from './smm-prompts';

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

// T-007a: the org's own brand kit, never a baked-in palette.
describe('SMM creative prompt uses the org brand kit', () => {
  const base = { type: 'company_branding', description: 'Diwali greeting', platform: 'Nanobanana (Gemini)' };
  const kit = {
    primary_color: '#BC1E2D', secondary_color: '#7A0D22', accent_color: '', text_color: '  ',
    primary_font: 'Inter', secondary_font: '', display_font: 'Bebas Neue',
    design_aesthetic: 'premium_minimal', cultural_motifs: ['konark_wheel_subtle', ''],
    logo_color_url: '',
  };

  it('carries the kit colours, fonts, aesthetic and motifs', () => {
    const prompt = buildSMMCreativePrompt({ ...base, brandKit: kit });
    expect(prompt).toContain('primary #BC1E2D, secondary #7A0D22');
    expect(prompt).toContain('Fonts: primary Inter, display Bebas Neue');
    expect(prompt).toContain('Design aesthetic: premium minimal');
    expect(prompt).toContain('Cultural motifs (subtle, never dominant): konark wheel subtle');
    expect(prompt).toContain('BRAND KIT colours (exact hex) and fonts above');
  });

  it("treats '' and whitespace as absent, never as a value", () => {
    const lines = brandKitDirectives(kit);
    expect(lines).toContain('- Colours (use these exact hex codes, no other brand colours): primary #BC1E2D, secondary #7A0D22');
    expect(lines).toContain('- Cultural motifs (subtle, never dominant): konark wheel subtle');
    expect(lines.join(' ')).not.toMatch(/accent|text\s|secondary Inter/);
    expect(brandKitDirectives({ primary_color: '', cultural_motifs: [''] })).toEqual([]);
  });

  it('asks for clean logo space, never a drawn logo (T-007b)', () => {
    const prompt = buildSMMCreativePrompt(base);
    expect(prompt).not.toContain('logo placement');
    expect(prompt).toContain('top-left corner left empty for a logo placed later');
  });

  it('never hard-codes a palette when the org has no kit', () => {
    for (const brandKit of [undefined, null, {}]) {
      const prompt = buildSMMCreativePrompt({ ...base, brandKit });
      expect(prompt).not.toMatch(/#1B4332|#2DD4A8|BRAND KIT/);
    }
  });
});

// T-022: an org with no brand kit still gets a real brand name, and no
// bracketed placeholder ever survives into the rendered result.
describe('T-022 — brand name resolution and placeholder guard', () => {
  it('resolveBrandName: org name wins over project name', () => {
    expect(resolveBrandName('Demo Builder Pvt Ltd', 'ZZ-E2E Test Project')).toBe('Demo Builder Pvt Ltd');
  });

  it('resolveBrandName: falls back to project name when org name is blank', () => {
    expect(resolveBrandName('', 'ZZ-E2E Test Project')).toBe('ZZ-E2E Test Project');
    expect(resolveBrandName(null, 'ZZ-E2E Test Project')).toBe('ZZ-E2E Test Project');
  });

  it('resolveBrandName: last-resort generic term when both are blank', () => {
    expect(resolveBrandName(null, null)).toBe('our company');
    expect(resolveBrandName('  ', '')).toBe('our company');
  });

  it('buildSMMCreativePrompt: names the brand and forbids placeholders, org with no kit', () => {
    const prompt = buildSMMCreativePrompt({
      type: 'company_branding', description: 'Diwali greeting', platform: 'Nanobanana (Gemini)',
      brandKit: null, orgName: 'Demo Builder Pvt Ltd',
    });
    expect(prompt).toContain('BRAND NAME: Demo Builder Pvt Ltd — use this exact name');
    expect(prompt).toMatch(/NEVER write a bracketed placeholder/);
  });

  it('stripPlaceholders: replaces every [...] token, nested through objects and arrays', () => {
    const out = stripPlaceholders(
      {
        captionEn: 'At [Brand Name], we believe in [Company Name] values.',
        carouselSlides: ['Slide 1 — [Brand Name] presents', 'Slide 2 — clean, no token'],
        nested: { hook: 'Welcome to [Brand Name]' },
        hashtags: ['#RealEstate'],
      },
      'Demo Builder Pvt Ltd',
    );
    expect(out.captionEn).toBe('At Demo Builder Pvt Ltd, we believe in Demo Builder Pvt Ltd values.');
    expect(out.carouselSlides[0]).toBe('Slide 1 — Demo Builder Pvt Ltd presents');
    expect(out.carouselSlides[1]).toBe('Slide 2 — clean, no token');
    expect(out.nested.hook).toBe('Welcome to Demo Builder Pvt Ltd');
    expect(out.hashtags).toEqual(['#RealEstate']);
  });

  it('stripPlaceholders: a clean result is returned unchanged (no false positives)', () => {
    const clean = { captionEn: 'Come visit us this festive season!', tags: ['x', 'y'] };
    expect(stripPlaceholders(clean, 'Demo Builder Pvt Ltd')).toEqual(clean);
  });
});
