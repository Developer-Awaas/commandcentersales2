// Tiny, unobtrusive build identifier so every tester always knows which build
// they're looking at. SHA + build time are injected at build (vite.config.ts).
// Fixed bottom-left, low opacity, click to copy — never blocks UI (pointer-events
// only on the chip itself). The same values are console.logged at boot.
const SHA = typeof __COMMIT_SHA__ !== 'undefined' ? __COMMIT_SHA__ : 'unknown';
const BUILT = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'unknown';

export const BUILD_SHA_SHORT = SHA.slice(0, 7);
export const BUILD_TIME = BUILT;

export function logBuildStamp() {
  // eslint-disable-next-line no-console
  console.log(`%c[build] ${BUILD_SHA_SHORT} · ${BUILT}`, 'color:#64748b');
}

export function BuildStamp() {
  const label = `${BUILD_SHA_SHORT} · ${BUILT.replace('T', ' ').replace(/:\d\d\.\d+Z$/, 'Z')}`;
  return (
    <div
      onClick={() => navigator.clipboard?.writeText(`${SHA} ${BUILT}`)}
      title={`Build ${SHA}\n${BUILT}\n(click to copy)`}
      style={{
        position: 'fixed', bottom: 4, left: 6, zIndex: 9999,
        font: '10px/1.4 ui-monospace, monospace', color: 'rgba(148,163,184,0.55)',
        cursor: 'pointer', userSelect: 'none', pointerEvents: 'auto',
      }}
    >
      {label}
    </div>
  );
}
