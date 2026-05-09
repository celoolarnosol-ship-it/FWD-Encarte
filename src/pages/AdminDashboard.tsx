import React, { useState, useEffect } from 'react';
import { auth } from '../lib/firebase/client';

export default function AdminDashboard() {
  const [serverStatus, setServerStatus] = useState<any>(null);
  
  useEffect(() => {
     loadServerStatus();
  }, []);

  const loadServerStatus = async () => {
    try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('/api/admin/status', {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            setServerStatus(data);
        }
    } catch(e) {}
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-slate-800">Painel de Gerenciamento</h2>
        {serverStatus && (
          <div className="flex gap-2">
            {!serverStatus.hasOpenAIKey && (
              <span className="bg-red-100 text-red-700 text-[10px] px-2 py-1 rounded-md font-bold flex items-center gap-1 border border-red-200">
                ⚠️ OPENAI KEY AUSENTE
              </span>
            )}
            {serverStatus.hasOpenAIKey && (
              <span className="bg-emerald-50 text-emerald-700 text-[10px] px-2 py-1 rounded-md font-bold flex items-center gap-1 border border-emerald-100">
                ✅ OpenAI Ativa
              </span>
            )}

            {!serverStatus.hasFirebaseStorage ? (
              <div className="flex gap-2">
                {serverStatus.storageType === 'R2' ? (
                  <span className="bg-amber-100 text-amber-700 text-[10px] px-2 py-1 rounded-md font-bold flex items-center gap-1 border border-amber-200">
                    ⚠️ R2 FALHOU
                  </span>
                ) : (
                  <a 
                    href={`https://console.firebase.google.com/project/${serverStatus.projectId}/storage`}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-amber-100 text-amber-700 text-[10px] px-2 py-1 rounded-md font-bold border border-amber-200 hover:bg-amber-200 transition-colors"
                  >
                    ⚠️ STORAGE DESATIVADO
                  </a>
                )}
              </div>
            ) : (
                <span className="bg-emerald-50 text-emerald-700 text-[10px] px-2 py-1 rounded-md font-bold flex items-center gap-1 border border-emerald-100">
                    ✅ {serverStatus.storageType || 'Storage'} OK
                </span>
            )}
          </div>
        )}
      </div>

      <div className="bg-slate-50 border border-slate-100 p-8 rounded-2xl text-center">
        <div className="bg-white w-16 h-16 rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-4 text-[var(--color-primary)]">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        </div>
        <h3 className="text-lg font-bold text-slate-800 mb-2">Configurações Estáticas Ativas</h3>
        <p className="text-slate-500 text-sm max-w-md mx-auto">
          As instruções da IA e o banco de dados de conhecimento estão agora integrados diretamente ao núcleo do aplicativo para garantir consistência e performance.
        </p>
      </div>
    </div>
  );
}
