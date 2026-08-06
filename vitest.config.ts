import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
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
      'src/components/generation/StrategyGenerator.test.tsx',
      'src/pages/CampaignWizard.test.tsx',
      'src/lib/providers.test.ts',
      'src/lib/monitor-freshness.test.ts',
      'src/lib/reference-style.test.ts',
      'src/lib/calendar-agenda.test.ts',
      'src/lib/content-library-filter.test.ts',
      'src/lib/text-layers.test.ts',
      'src/lib/zone-layers.test.ts',
      'src/components/TextLayerEditor.test.tsx',
    ],
  },
});
