import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './lib/firebase/client';
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
          const userDocRef = doc(db, 'users', firebaseUser.uid);
          const userDoc = await getDoc(userDocRef);
          
          let data: any;
          const isAdmin = firebaseUser.email === 'celoolarnosol@gmail.com';
          
          if (!userDoc.exists()) {
             data = {
                 email: firebaseUser.email,
                 displayName: firebaseUser.displayName || '',
                 photoURL: firebaseUser.photoURL || '',
                 role: isAdmin ? 'admin' : 'user',
                 imageCount: 0,
                 maxImages: 300,
                 createdAt: Date.now(),
                 lastLoginAt: Date.now()
             };
             await setDoc(userDocRef, data);
          } else {
             data = userDoc.data();
             const updates: any = { lastLoginAt: Date.now() };
             if (isAdmin && data.role !== 'admin') {
                 updates.role = 'admin';
                 data.role = 'admin';
             }
             if (Object.keys(updates).length > 0) {
                 await updateDoc(userDocRef, updates);
             }
          }
          setUserData(data);
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
    return <div className="min-h-screen flex items-center justify-center bg-[#1A1A2E] text-white">Carregando...</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={user && userData?.isActive !== false ? <Navigate to="/chat" /> : <LoginPage />} />
        
        {/* Protected Chat Routes */}
        <Route path="/" element={user && userData?.isActive !== false ? <Navigate to="/chat" /> : <Navigate to="/login" />} />
        <Route path="/chat" element={user && userData?.isActive !== false ? <ChatLayout /> : <Navigate to="/login" />}>
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
