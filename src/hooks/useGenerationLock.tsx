import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

interface GenerationLockContextValue {
  isGenerating: boolean;
  label: string | null;
  startedAt: number | null;
  start: (label: string) => void;
  stop: () => void;
}

const GenerationLockContext = createContext<GenerationLockContextValue>({
  isGenerating: false,
  label: null,
  startedAt: null,
  start: () => {},
  stop: () => {},
});

export function useGenerationLock() {
  return useContext(GenerationLockContext);
}

export function GenerationLockProvider({ children }: { children: ReactNode }) {
  const [label, setLabel] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Guards against a stale stop() (from an unmounted/aborted caller) clearing
  // a lock a different caller has since started.
  const tokenRef = useRef(0);

  const start = useCallback((nextLabel: string) => {
    tokenRef.current += 1;
    setLabel(nextLabel);
    setStartedAt(Date.now());
  }, []);

  const stop = useCallback(() => {
    tokenRef.current += 1;
    setLabel(null);
    setStartedAt(null);
  }, []);

  const isGenerating = label !== null;

  useEffect(() => {
    if (!isGenerating) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isGenerating]);

  const value = useMemo(
    () => ({ isGenerating, label, startedAt, start, stop }),
    [isGenerating, label, startedAt, start, stop]
  );

  return (
    <GenerationLockContext.Provider value={value}>
      {children}
    </GenerationLockContext.Provider>
  );
}
