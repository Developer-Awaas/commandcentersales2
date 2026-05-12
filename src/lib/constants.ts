export const DEV_ORG_ID = '00000000-0000-0000-0000-000000000001';
export const DEV_USER_ID = '00000000-0000-0000-0000-000000000002';
export const ADMIN_EMAIL = 'rdev332@gmail.com';

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
