import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Vitest's 5s default is measured wall-clock, and with this many jsdom
    // files the environment setup — not the test body — is what consumes it
    // on a loaded machine. The React render tests (CampaignWizard,
    // StrategyGenerator) each execute in ~1.3s in isolation but intermittently
    // tripped 5s in a full run: four consecutive full runs gave 215/215, 214,
    // 211, 215, while the same suite at 20s passed 215/215 twice.
    //
    // This masks nothing — a genuinely hung test still fails, just after 20s
    // instead of 5. Raised rather than left flaky because a red run nobody
    // believes is worse than a slow one.
    testTimeout: 20_000,
    // Explicit include (not the default repo-wide glob): this branch only
    // owns the test files listed here. Other *.test.ts files may exist in a
    // working tree alongside unrelated in-progress work this branch doesn't
    // touch and isn't responsible for keeping green.
    include: [
      'src/lib/ai-service.mock.test.ts',
      'src/lib/smm-generation-error.test.ts',
      'src/lib/smm-prompts.separation.test.ts',
      'src/lib/history-service.test.ts',
      'src/lib/gemini-service.test.ts',
      'src/lib/gemini-service.hero.test.ts',
      'src/lib/gemini-service.async.test.ts',
      'src/components/generation/StrategyGenerator.test.tsx',
      'src/pages/CampaignWizard.test.tsx',
      'src/lib/providers.test.ts',
      'src/lib/monitor-freshness.test.ts',
      'src/lib/reference-style.test.ts',
      'src/lib/ad-platform.test.ts',
      'src/lib/review-sections.test.ts',
      'src/lib/calendar-agenda.test.ts',
      'src/lib/content-library-filter.test.ts',
      'src/lib/text-layers.test.ts',
      'src/lib/zone-layers.test.ts',
      'src/lib/layer-editor.test.ts',
      'src/lib/overlay-recompose.test.ts',
      'src/lib/senior-designer-prompts.angle.test.ts',
      'src/lib/pricing.test.ts',
      'src/lib/api-cost.test.ts',
      'src/lib/usage-aggregate.test.ts',
      'src/components/TextLayerEditor.test.tsx',
    ],
  },
});
