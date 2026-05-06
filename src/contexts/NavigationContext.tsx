import { createContext, useContext } from 'react';

export type AppSection = 'dashboard' | 'lead_gen' | 'smm';

interface NavigationContextValue {
  navigate: (page: string) => void;
  activePage: string;
  activeSection: AppSection;
  setSection: (section: AppSection) => void;
}

export const NavigationContext = createContext<NavigationContextValue>({
  navigate: () => {},
  activePage: 'dashboard',
  activeSection: 'dashboard',
  setSection: () => {},
});

export function useNavigation() {
  return useContext(NavigationContext);
}
