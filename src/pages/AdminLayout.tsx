import React from 'react';
import { Outlet } from 'react-router-dom';

export default function AdminLayout() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b h-14 flex items-center px-6 sticky top-0 z-10">
        <h1 className="font-semibold text-lg text-slate-800">Painel Administrativo</h1>
      </header>
      <main className="flex-1 p-6 max-w-6xl w-full mx-auto">
        <Outlet />
      </main>
    </div>
  );
}
