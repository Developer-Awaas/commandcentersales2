import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// Build stamp — injected at build so every deployed bundle self-identifies which
// commit it was built from. On Vercel, VERCEL_GIT_COMMIT_SHA is provided
// automatically; locally we fall back to `git rev-parse`. Rendered tiny in the
// app (BuildStamp) + console.logged at boot, so any tester report carries the SHA.
const commitSha =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  (() => { try { return execSync('git rev-parse HEAD').toString().trim(); } catch { return 'unknown'; } })();
const buildTime = new Date().toISOString();

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  define: {
    __COMMIT_SHA__: JSON.stringify(commitSha),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
});
