import React from 'react';
import { Outlet, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function AdminLayout() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b h-14 flex items-center justify-between px-6 sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <Link 
            to="/chat" 
            className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-[var(--color-primary)] transition-colors"
          >
            <ArrowLeft size={16} />
            Voltar para o App
          </Link>
          <div className="h-4 w-px bg-slate-200" />
          <h1 className="font-semibold text-base text-slate-800">Painel Administrativo</h1>
        </div>
      </header>
      <main className="flex-1 p-6 max-w-6xl w-full mx-auto">
        <Outlet />
      </main>
    </div>
  );
}
