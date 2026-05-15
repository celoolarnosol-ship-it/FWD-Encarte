import React, { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { auth } from '../lib/firebase/client';
import { Button } from '@/components/ui/button';
import { Menu, Plus, Settings, LogOut } from 'lucide-react';

export default function ChatLayout() {
  const { userData } = useAuthStore();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async () => {
    await auth.signOut();
    navigate('/login');
  };

  const handleNewChat = () => {
    // Navigate home which resets the chat page state
    navigate('/chat');
    setSidebarOpen(false);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg-chat)]">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50
        w-64 bg-[var(--color-bg-sidebar)] text-[var(--color-text-inverse)]
        flex flex-col
        transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-[var(--color-primary)] rounded-lg flex items-center justify-center font-bold text-xl text-white">E</div>
          <span className="text-xl font-bold tracking-tight">EncartIA</span>
        </div>
        
        <div className="px-4 mb-6">
          <button 
            onClick={handleNewChat}
            className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3 px-4 rounded-xl flex items-center gap-2 transition-colors font-medium"
          >
            <Plus size={20} />
            Novo Encarte
          </button>
        </div>

        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          <div className="bg-white/5 p-4 rounded-xl text-xs text-slate-400 leading-relaxed italic">
            Cada geração é única e temporária. Para criar um novo encarte, clique no botão acima.
          </div>
        </nav>

        <div className="p-4 mt-auto border-t border-white/10 space-y-4">
          <div className="bg-white/5 rounded-xl p-3">
            <div className="flex justify-between text-xs mb-2">
              <span className="text-slate-400">Cota de Imagens</span>
              <span className="text-white font-bold">{userData?.image_count || 0}/{userData?.max_images || 300}</span>
            </div>
            <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
              <div 
                className="bg-[var(--color-primary)] h-full" 
                style={{ width: `${Math.min(((userData?.image_count || 0) / (userData?.max_images || 300)) * 100, 100)}%` }}
              ></div>
            </div>
          </div>
          <div className="flex items-center gap-3 px-2">
            {userData?.photo_url ? (
              <img src={userData.photo_url} alt="" className="w-10 h-10 rounded-full bg-white/10" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-[var(--color-primary)] flex items-center justify-center font-bold text-white shrink-0">
                {userData?.display_name?.charAt(0) || auth.currentUser?.email?.charAt(0).toUpperCase() || 'U'}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{userData?.display_name || auth.currentUser?.email?.split('@')[0]}</div>
              <div className="text-xs text-slate-400 capitalize">{userData?.role || 'Usuário'}</div>
            </div>
            <div className="flex gap-1 -mr-2">
              {userData?.role === 'admin' && (
                <button onClick={() => navigate('/admin')} title="Painel Admin" className="text-slate-400 hover:text-white hover:bg-white/10 shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors">
                  <Settings size={16} />
                </button>
              )}
              <button onClick={handleLogout} title="Sair" className="text-slate-400 hover:text-white hover:bg-white/10 shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors">
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 relative bg-[var(--color-bg-chat)]">
        <header className="h-16 bg-white border-b border-slate-200 px-4 md:px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
             <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-slate-500 hover:text-slate-700 transition-colors">
               <Menu className="w-6 h-6" />
             </button>
             <h2 className="font-bold text-slate-800 truncate max-w-[200px] md:max-w-md">
               EncartIA — Novo Encarte
             </h2>
          </div>
          {userData?.role === 'admin' && (
              <button onClick={() => navigate('/admin')} className="text-slate-400 hover:text-slate-600 font-medium hidden sm:flex items-center gap-2 text-sm transition-colors">
                <Settings className="w-5 h-5" />
                Painel Admin
              </button>
          )}
        </header>

        <div className="flex-1 overflow-hidden relative">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
