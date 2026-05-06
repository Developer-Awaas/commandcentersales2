import { createContext, useContext, useState } from 'react';

interface ChatbotContextValue {
  currentData: Record<string, unknown>;
  setCurrentData: (data: Record<string, unknown>) => void;
}

export const ChatbotContext = createContext<ChatbotContextValue>({
  currentData: {},
  setCurrentData: () => {},
});

export function ChatbotProvider({ children }: { children: React.ReactNode }) {
  const [currentData, setCurrentData] = useState<Record<string, unknown>>({});
  return (
    <ChatbotContext.Provider value={{ currentData, setCurrentData }}>
      {children}
    </ChatbotContext.Provider>
  );
}

export function useChatbot() {
  return useContext(ChatbotContext);
}
