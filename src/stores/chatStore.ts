import { create } from 'zustand';

export interface Chat {
  id: string;
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  isArchived: boolean;
}

export interface Message {
  id: string;
  chatId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrls: string[];
  generatedImageUrls: string[];
  createdAt: number;
  status?: 'sending' | 'loading' | 'success' | 'error';
}

interface ChatState {
  chats: Chat[];
  activeChatId: string | null;
  messages: Message[];
  setChats: (chats: Chat[]) => void;
  setActiveChatId: (id: string | null) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  chats: [],
  activeChatId: null,
  messages: [],
  setChats: (chats) => set({ chats }),
  setActiveChatId: (activeChatId) => set({ activeChatId }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  updateMessage: (id, updates) => set((state) => ({
    messages: state.messages.map(m => m.id === id ? { ...m, ...updates } : m)
  }))
}));
