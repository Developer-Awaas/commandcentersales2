/**
 * smm-brand-live-check.ts — T-007a live evidence: an SMM Creatives generation
 * carries the org's own brand kit in the assembled prompt.
 *
 * Mirrors SMMCreatives.tsx generate() exactly, importing the real code:
 *   getBrandProvider().getBrandKit(orgId) → buildSMMCreativePrompt → aiCall
 *   → generateImageWithGemini(nanoPrompt, '1:1', …, { feature: 'smm-creative-gen' })
 * No prompt text lives in this file.
 *
 * Signs in as the dedicated TEST e2e account (.env.e2e.local — E2E_EMAIL /
 * E2E_PASSWORD), whose org is ZZ-INTERNAL-TEST. Never the reviewer account:
 * its org is Demo Builder, which stays pristine for the human Meta reviewer,
 * and every LLM call here writes an agent_interactions cost row.
 *
 * Prints the assembled text prompt and the nanoPrompt that went to the image
 * provider; the image itself is not saved.
 *
 * Run:  npx tsx scripts/smm-brand-live-check.ts [--no-image]
 * Reqs: .env.local pointing at TEST, .env.e2e.local. Costs one Claude call
 *       and (without --no-image) one image generation.
 */
import fs from 'node:fs';

const env = (file: string, re: RegExp) => {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(re);
    if (m) process.env[m[1]] = m[2].trim();
  }
};
// src/lib/supabase.ts reads its config at module load — env first, then import.
env('.env.local', /^(VITE_[A-Z_]+)=(.*)$/);
env('.env.e2e.local', /^(E2E_[A-Z_]+)=(.*)$/);

const memoryStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
};
(globalThis as any).localStorage = memoryStorage();
(globalThis as any).sessionStorage = memoryStorage();
// gemini-service turns the finished job's Blob into a data URL via FileReader.
(globalThis as any).FileReader = class {
  result: string | null = null;
  onloadend: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readAsDataURL(blob: Blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buf).toString('base64')}`;
      this.onload?.(); this.onloadend?.();
    }, (e) => this.onerror?.(e));
  }
};

async function main() {
  const { supabase } = await import('../src/lib/supabase');
  const { error: authErr, data: auth } = await supabase.auth.signInWithPassword({
    email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD!,
  });
  if (authErr || !auth.user) throw new Error(`sign-in failed: ${authErr?.message}`);
  const { data: profile } = await supabase.from('profiles').select('org_id').eq('id', auth.user.id).single();
  if (!profile?.org_id) throw new Error('no org for the signed-in user');
  localStorage.setItem('user_org_id', profile.org_id);
  localStorage.setItem('user_id', auth.user.id);

  const { getOrgId } = await import('../src/lib/constants');
  const { getBrandProvider } = await import('../src/lib/providers');
  const { buildSMMCreativePrompt } = await import('../src/lib/smm-prompts');
  const { aiCall } = await import('../src/lib/ai-service');
  const { generateImageWithGemini } = await import('../src/lib/gemini-service');

  const brandKit = await getBrandProvider().getBrandKit(getOrgId()).catch(() => null);
  const prompt = buildSMMCreativePrompt({
    type: 'company_branding',
    description: 'Festive greeting post celebrating our community this Diwali',
    platform: 'Nanobanana (Gemini)',
    brandKit,
  });
  console.log(`org=${getOrgId()}\n\n=== ASSEMBLED TEXT PROMPT (${prompt.length} chars) ===\n${prompt}\n`);

  const res = await aiCall(prompt);
  const nano = typeof res.nanoPrompt === 'string' ? res.nanoPrompt : '';
  if (!nano) throw new Error(`no nanoPrompt: ${JSON.stringify(res).slice(0, 300)}`);
  console.log(`=== nanoPrompt → image provider (${nano.length} chars) ===\n${nano}\n`);

  if (process.argv.includes('--no-image')) return;
  const started = new Date().toISOString();
  const imgs = await generateImageWithGemini(nano, '1:1', undefined, undefined, { feature: 'smm-creative-gen', projectId: null });
  console.log(`image: ${imgs[0] ? `${imgs[0].mimeType}, ${imgs[0].base64.length} b64 chars` : 'NONE'}; started ${started}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
