import { create } from 'zustand';
import { User as FirebaseUser } from 'firebase/auth';

interface UserData {
  email: string;
  displayName: string;
  photoURL: string;
  role: 'user' | 'admin';
  imageCount: number;
  maxImages: number;
  maxChats: number;
  isActive: boolean;
}

interface AuthState {
  user: FirebaseUser | null;
  userData: UserData | null;
  loading: boolean;
  setUser: (user: FirebaseUser | null) => void;
  setUserData: (data: UserData | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  userData: null,
  loading: true,
  setUser: (user) => set({ user }),
  setUserData: (userData) => set({ userData }),
  setLoading: (loading) => set({ loading })
}));
