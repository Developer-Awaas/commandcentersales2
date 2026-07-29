export const DEV_ORG_ID = '00000000-0000-0000-0000-000000000001';
export const DEV_USER_ID = '00000000-0000-0000-0000-000000000002';
export const ADMIN_EMAIL = 'rdev332@gmail.com';

// Single backend-owned default — the creative-platform/model picker was removed
// from every generation form (users never chose a specific AI provider anyway;
// the actual image provider is controlled server-side via IMAGE_PROVIDER in
// _shared/image-provider.ts). Kept as a literal string, not an enum, because
// existing branching logic (`.toLowerCase().includes('nanobanana')`) and stored
// `platform_used` values depend on this exact value.
// TODO(multi-platform): re-expose per-org when multiple providers wired.
export const DEFAULT_CREATIVE_PLATFORM = 'Nanobanana (Gemini)';

const ORG_ID_KEY = 'user_org_id';
const USER_ID_KEY = 'user_id';

export function getOrgId(): string {
  return localStorage.getItem(ORG_ID_KEY) || DEV_ORG_ID;
}

export function getUserId(): string {
  return localStorage.getItem(USER_ID_KEY) || DEV_USER_ID;
}

export function setStoredOrgId(orgId: string): void {
  localStorage.setItem(ORG_ID_KEY, orgId);
}

export function clearStoredOrgId(): void {
  localStorage.removeItem(ORG_ID_KEY);
}

export function isLearningMode(): boolean {
  return localStorage.getItem('learning_mode') !== 'false';
}
