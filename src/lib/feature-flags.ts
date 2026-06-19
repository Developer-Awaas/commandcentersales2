// Centralized feature flags. Reads VITE_-prefixed env vars; all default to false
// when unset so new features ship dark until explicitly enabled.

export const LEADGEN_V2_ENABLED =
  (import.meta.env.VITE_LEADGEN_V2_ENABLED as string | undefined) === 'true';
