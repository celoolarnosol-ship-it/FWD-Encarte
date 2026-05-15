import { create } from 'zustand';

export interface Message {
  id: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrls: string[];
  generatedImageUrls: string[];
  createdAt: number;
}

interface ChatState {
  messages: Message[];
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  updateMessage: (id, updates) => set((state) => ({
    messages: state.messages.map(m => m.id === id ? { ...m, ...updates } : m)
  }))
}));
