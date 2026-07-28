// Centralized feature flags. Reads VITE_-prefixed env vars; all default to false
// when unset so new features ship dark until explicitly enabled.

export const LEADGEN_V2_ENABLED =
  (import.meta.env.VITE_LEADGEN_V2_ENABLED as string | undefined) === 'true';

// Testing-only: when on, ai-service.ts's aiCall/aiVision/describeImageForFlux
// and gemini-service.ts's generateImageWithGemini return canned fixtures
// (src/mocks/ai-fixtures.ts) instead of calling claude-proxy/generate-image.
// The persistence path (Storage upload, DB inserts) still runs for real —
// only the model call itself is faked. Default false so this never ships on.
export const MOCK_AI_ENABLED =
  (import.meta.env.VITE_MOCK_AI as string | undefined) === 'true';

// GPT-Image-1 generation costs real money per image (~INR 60/image at the
// sizes/quality this app uses) — testing on review-build with the full
// 3-images-per-generation product behavior is not cost-feasible there, so
// review-build sets this to true. On main/production, all 3 images per
// generation is the actual product behavior — this must stay false here.
export const SINGLE_IMAGE_TESTING_MODE = false;
