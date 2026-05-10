import React, { useState, useEffect } from 'react';
import { auth, db } from '../lib/firebase/client';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Loader2, Save, Plus, Trash2 } from 'lucide-react';
import { AI_CONFIG as STATIC_AI_CONFIG } from '../constants/aiConfig';

export default function AdminDashboard() {
  const [serverStatus, setServerStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [mainPrompt, setMainPrompt] = useState(STATIC_AI_CONFIG.mainPrompt);
  const [techInst, setTechInst] = useState<string[]>(STATIC_AI_CONFIG.technicalPrompts);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [authorizedUsers, setAuthorizedUsers] = useState<string[]>([]);
  
  useEffect(() => {
     loadServerStatus();
     loadConfig();
     loadAuthorizedUsers();
  }, []);

  const loadAuthorizedUsers = async () => {
    try {
        const docSnap = await getDoc(doc(db, 'config', 'whitelist'));
        if (docSnap.exists()) {
            setAuthorizedUsers(docSnap.data().emails || []);
        }
    } catch (e) {
        console.error("Erro ao carregar whitelist");
    }
  };

  const handleAddUser = async () => {
    if (!newUserEmail || !newUserEmail.includes('@')) {
        toast.error("Insira um email válido.");
        return;
    }
    
    if (authorizedUsers.includes(newUserEmail.toLowerCase())) {
        toast.error("Este usuário já está autorizado.");
        return;
    }

    const newList = [...authorizedUsers, newUserEmail.toLowerCase()];
    try {
        await setDoc(doc(db, 'config', 'whitelist'), {
            emails: newList,
            updated_at: serverTimestamp()
        });
        setAuthorizedUsers(newList);
        setNewUserEmail('');
        toast.success("Usuário autorizado com sucesso!");
    } catch (e) {
        toast.error("Erro ao autorizar usuário.");
    }
  };

  const handleRemoveUser = async (email: string) => {
    const newList = authorizedUsers.filter(e => e !== email);
    try {
        await setDoc(doc(db, 'config', 'whitelist'), {
            emails: newList,
            updated_at: serverTimestamp()
        });
        setAuthorizedUsers(newList);
        toast.success("Autorização removida.");
    } catch (e) {
        toast.error("Erro ao remover autorização.");
    }
  };

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

  const loadConfig = async () => {
    setLoading(true);
    try {
        const docSnap = await getDoc(doc(db, 'config', 'settings'));
        if (docSnap.exists()) {
            const data = docSnap.data();
            setMainPrompt(data.main_prompt || STATIC_AI_CONFIG.mainPrompt);
            setTechInst(data.technical_instructions || STATIC_AI_CONFIG.technicalPrompts);
        }
    } catch (e) {
        toast.error("Erro ao carregar configurações do Firebase.");
    } finally {
        setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
        await setDoc(doc(db, 'config', 'settings'), {
            main_prompt: mainPrompt,
            technical_instructions: techInst,
            updated_at: serverTimestamp()
        });
        toast.success("Configurações salvas com sucesso!");
    } catch (e) {
        toast.error("Erro ao salvar configurações.");
    } finally {
        setSaving(false);
    }
  };

  const addTechInst = () => {
    setTechInst([...techInst, ""]);
  };

  const updateTechInst = (index: number, value: string) => {
    const newList = [...techInst];
    newList[index] = value;
    setTechInst(newList);
  };

  const removeTechInst = (index: number) => {
    setTechInst(techInst.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      {/* Authorized Users Section */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
            👤 Usuários Autorizados
        </h2>
        <div className="flex gap-3 mb-6">
            <div className="relative flex-1">
                <input 
                    type="email"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    placeholder="Email do novo colaborador..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 h-12 text-sm focus:ring-2 focus:ring-[var(--color-primary)] outline-none transition-all"
                />
            </div>
            <Button 
                onClick={handleAddUser}
                className="bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white px-6 h-12 rounded-xl gap-2 font-bold whitespace-nowrap"
            >
                <Plus size={18} /> Autorizar Acesso
            </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {authorizedUsers.map(email => (
                <div key={email} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 group">
                    <span className="text-sm font-medium text-slate-600 truncate mr-2">{email}</span>
                    {email !== 'celoolarnosol@gmail.com' && (
                        <button 
                            onClick={() => handleRemoveUser(email)}
                            className="text-slate-400 hover:text-red-500 transition-colors p-1"
                        >
                            <Trash2 size={16} />
                        </button>
                    )}
                </div>
            ))}
            {authorizedUsers.length === 0 && (
                <p className="col-span-full text-center text-slate-400 py-4 italic text-sm">Nenhum usuário adicional autorizado.</p>
            )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-slate-800">Status do Sistema</h2>
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
              <span className="bg-blue-50 text-blue-700 text-[10px] px-2 py-1 rounded-md font-bold flex items-center gap-1 border border-blue-100">
                  ✅ Firebase DB OK
              </span>
              <span className="bg-slate-50 text-slate-500 text-[10px] px-2 py-1 rounded-md font-bold flex items-center gap-1 border border-slate-100 italic">
                  ℹ️ Storage Opcional
              </span>
            </div>
          )}
        </div>
        
        <p className="text-slate-500 text-sm mb-4">
          Gerencie as instruções principais da IA que orientam a criação do roteiro e do encarte.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border p-6 space-y-8">
        <div>
          <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            Prompt Principal (Brain)
          </h3>
          <Textarea 
            value={mainPrompt}
            onChange={(e) => setMainPrompt(e.target.value)}
            className="min-h-[300px] font-mono text-sm leading-relaxed"
            placeholder="Insira o prompt principal aqui..."
          />
        </div>

        <div>
           <div className="flex items-center justify-between mb-4">
             <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
               Instruções Técnicas Secundárias
             </h3>
             <Button onClick={addTechInst} variant="outline" size="sm" className="gap-2">
                <Plus size={14} /> Adicionar
             </Button>
           </div>
           
           <div className="space-y-3">
             {techInst.map((item, index) => (
                <div key={index} className="flex gap-2">
                  <Textarea 
                    value={item}
                    onChange={(e) => updateTechInst(index, e.target.value)}
                    className="min-h-[80px] text-sm"
                    placeholder={`Instrução #${index + 1}`}
                  />
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => removeTechInst(index)}
                    className="text-slate-400 hover:text-red-500 shrink-0"
                  >
                    <Trash2 size={18} />
                  </Button>
                </div>
             ))}
             {techInst.length === 0 && (
               <p className="text-center text-slate-400 py-4 border-2 border-dashed rounded-xl text-sm italic">
                  Nenhuma instrução técnica secundária definida.
               </p>
             )}
           </div>
        </div>

        <div className="pt-4 border-t flex justify-end">
           <Button 
             onClick={handleSave} 
             disabled={saving || loading}
             className="bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white px-8 h-12 rounded-xl gap-2 font-bold"
           >
             {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
             Salvar Configurações
           </Button>
        </div>
      </div>
    </div>
  );
}

