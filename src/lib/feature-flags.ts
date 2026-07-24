// Centralized feature flags. Reads VITE_-prefixed env vars; all default to false
// when unset so new features ship dark until explicitly enabled.

export const LEADGEN_V2_ENABLED =
  (import.meta.env.VITE_LEADGEN_V2_ENABLED as string | undefined) === 'true';

// GPT-Image-1 generation costs real money per image (~INR 60/image at the
// sizes/quality this app uses) — testing on review-build with the full
// 3-images-per-generation product behavior is not cost-feasible. Caps
// Quick Generate and Creatives-page generation to 1 image instead of 3.
// review-build only — flip to false (or delete this flag entirely) before
// any of this ships to main/production, where all 3 images are the actual
// product behavior.
export const SINGLE_IMAGE_TESTING_MODE = true;
