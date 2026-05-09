import { create } from 'zustand';
import { User as FirebaseUser } from 'firebase/auth';

interface UserData {
  id: string;
  email: string;
  display_name: string;
  photo_url: string;
  role: 'user' | 'admin';
  image_count: number;
  max_images: number;
  max_chats: number;
  is_active: boolean;
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
