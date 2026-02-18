import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LLM_MESSAGE_ROLE } from "@/types/llm";

export type OllieToolCall = {
  id: string;
  name: string;
  display_name: string;
  completed?: boolean;
};

export type OllieMessage = {
  id: string;
  role: LLM_MESSAGE_ROLE.user | LLM_MESSAGE_ROLE.assistant;
  content: string;
  isLoading?: boolean;
  isError?: boolean;
  toolCalls?: OllieToolCall[];
};

export type OlliePanelMode = "compact" | "wide";

export type OllieTableState = {
  filters?: string;
  sorting?: string;
  groups?: string;
  page?: number;
  size?: number;
  search?: string;
};

export type OllieStore = {
  isOpen: boolean;
  mode: OlliePanelMode;
  messages: OllieMessage[];
  isStreaming: boolean;
  inputValue: string;
  tableState: OllieTableState | null;

  togglePanel: () => void;
  setIsOpen: (isOpen: boolean) => void;
  setMode: (mode: OlliePanelMode) => void;
  addMessage: (message: OllieMessage) => void;
  updateLastMessage: (updates: Partial<OllieMessage>) => void;
  updateMessage: (messageId: string, updates: Partial<OllieMessage>) => void;
  clearMessages: () => void;
  setInputValue: (value: string) => void;
  setIsStreaming: (isStreaming: boolean) => void;
  setTableState: (tableState: OllieTableState | null) => void;
};

const useOllieStore = create<OllieStore>()(
  persist(
    (set) => ({
      isOpen: false,
      mode: "compact",
      messages: [],
      isStreaming: false,
      inputValue: "",
      tableState: null,

      togglePanel: () => {
        set((state) => ({ isOpen: !state.isOpen }));
      },

      setIsOpen: (isOpen) => {
        set({ isOpen });
      },

      setMode: (mode) => {
        set({ mode });
      },

      addMessage: (message) => {
        set((state) => ({
          messages: [...state.messages, message],
        }));
      },

      updateLastMessage: (updates) => {
        set((state) => {
          if (state.messages.length === 0) return state;
          const messages = [...state.messages];
          const lastIndex = messages.length - 1;
          messages[lastIndex] = { ...messages[lastIndex], ...updates };
          return { messages };
        });
      },

      updateMessage: (messageId, updates) => {
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === messageId ? { ...m, ...updates } : m,
          ),
        }));
      },

      clearMessages: () => {
        set({ messages: [] });
      },

      setInputValue: (value) => {
        set({ inputValue: value });
      },

      setIsStreaming: (isStreaming) => {
        set({ isStreaming });
      },

      setTableState: (tableState) => {
        set({ tableState });
      },
    }),
    {
      name: "OLLIE_STATE",
      partialize: (state) => ({
        mode: state.mode,
      }),
    },
  ),
);

export default useOllieStore;
