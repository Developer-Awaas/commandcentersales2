import { createContext, useContext } from 'react';

export type AppSection = 'dashboard' | 'lead_gen' | 'smm';

interface NavigationContextValue {
  navigate: (page: string) => void;
  activePage: string;
  activeSection: AppSection;
  setSection: (section: AppSection) => void;
  generatingPage: string | null;
  setGeneratingPage: (page: string | null) => void;
  generationProgress: number | null;
  setGenerationProgress: (progress: number | null) => void;
}

export const NavigationContext = createContext<NavigationContextValue>({
  navigate: () => {},
  activePage: 'dashboard',
  activeSection: 'dashboard',
  setSection: () => {},
  generatingPage: null,
  setGeneratingPage: () => {},
  generationProgress: null,
  setGenerationProgress: () => {},
});

export function useNavigation() {
  return useContext(NavigationContext);
}
