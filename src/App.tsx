import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase/client';
import { useAuthStore } from './stores/authStore';

// Pages
import LoginPage from './pages/Login';
import ChatLayout from './pages/ChatLayout';
import ChatPage from './pages/ChatPage';
import AdminLayout from './pages/AdminLayout';
import AdminDashboard from './pages/AdminDashboard';
import { Toaster } from '@/components/ui/sonner';

export default function App() {
  const { user, userData, loading, setUser, setUserData, setLoading } = useAuthStore();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const adminEmail = 'celoolarnosol@gmail.com';
          const isAdmin = firebaseUser.email?.toLowerCase() === adminEmail.toLowerCase();
          
          // Whitelist check
          if (!isAdmin) {
              const whitelistSnap = await getDoc(doc(db, 'config', 'whitelist'));
              const authorizedEmails = whitelistSnap.exists() ? (whitelistSnap.data().emails || []) : [];
              if (!authorizedEmails.map((e: string) => e.toLowerCase()).includes(firebaseUser.email?.toLowerCase())) {
                  await auth.signOut();
                  toast.error('Seu acesso foi revogado ou não está autorizado.');
                  setUserData(null);
                  setLoading(false);
                  return;
              }
          }

          // Initial profile data
          const initialData = {
            id: firebaseUser.uid,
            email: firebaseUser.email || '',
            display_name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Usuário',
            photo_url: firebaseUser.photoURL || '',
            role: isAdmin ? 'admin' : 'user',
            image_count: 0,
            max_images: 300,
            max_chats: 5,
            is_active: true,
            created_at: serverTimestamp()
          };

          // Try to fetch profile from Firestore
          const profileRef = doc(db, 'profiles', firebaseUser.uid);
          let profileSnap;
          try {
            profileSnap = await getDoc(profileRef);
          } catch (err) {
            handleFirestoreError(err, OperationType.GET, `profiles/${firebaseUser.uid}`);
          }
          
          if (!profileSnap?.exists()) {
            // Create profile if it doesn't exist
            try {
              await setDoc(profileRef, initialData);
              setUserData(initialData as any);
            } catch (err) {
              handleFirestoreError(err, OperationType.CREATE, `profiles/${firebaseUser.uid}`);
            }
          } else {
            const profileData = profileSnap.data();
            // Update role if admin email matches but role in DB is different
            if (isAdmin && profileData.role !== 'admin') {
              try {
                await updateDoc(profileRef, { role: 'admin' });
                setUserData({ ...profileData, role: 'admin' } as any);
              } catch (err) {
                handleFirestoreError(err, OperationType.UPDATE, `profiles/${firebaseUser.uid}`);
              }
            } else {
              setUserData(profileData as any);
            }
          }
        } catch (e) {
          console.error('Auth sync error:', e);
        }
      } else {
        setUserData(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [setUser, setUserData, setLoading]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F0F1A] text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-400 animate-pulse">Iniciando sistema...</p>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={user && userData?.is_active !== false ? <Navigate to="/chat" /> : <LoginPage />} />
        
        {/* Protected Chat Routes */}
        <Route path="/" element={user && userData?.is_active !== false ? <Navigate to="/chat" /> : <Navigate to="/login" />} />
        <Route path="/chat" element={user && userData?.is_active !== false ? <ChatLayout /> : <Navigate to="/login" />}>
          <Route index element={<ChatPage />} />
          <Route path=":chatId" element={<ChatPage />} />
        </Route>

        {/* Protected Admin Routes */}
        <Route path="/admin" element={user && userData?.role === 'admin' ? <AdminLayout /> : <Navigate to="/chat" />}>
          <Route index element={<AdminDashboard />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}
