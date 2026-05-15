import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Paperclip, Send, Loader2, RefreshCw, Square, Monitor, Smartphone, Download, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useNavigate } from 'react-router-dom';
import Markdown from 'react-markdown';
import { toast } from 'sonner';
import { auth, db } from '../lib/firebase/client';
import { doc, getDoc } from 'firebase/firestore';

type AspectRatio = '1:1' | '16:9' | '9:16';

export default function ChatPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const { userData, setUserData } = useAuthStore();
  const { messages, setMessages, addMessage } = useChatStore();
  const [isLoading, setIsLoading] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [currentStatus, setCurrentStatus] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Manage Object URLs for preview images to prevent memory leaks
  const imagePreviews = useMemo(() => {
    const urls = images.map(img => URL.createObjectURL(img));
    return urls;
  }, [images]);

  useEffect(() => {
    return () => {
      imagePreviews.forEach(url => URL.revokeObjectURL(url));
    };
  }, [imagePreviews]);

  useEffect(() => {
    // Reset state for new flyer
    setMessages([]);
    setIsFinished(false);
  }, [setMessages]);

  useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleReset = () => {
    setMessages([]);
    setMessage('');
    setImages([]);
    setIsFinished(false);
    setIsLoading(false);
  };

  const handleSend = async () => {
    if (!message.trim() && images.length === 0) return;
    if (isLoading || isFinished) return;

    // Preventive Quota Check
    if (userData && userData.image_count >= (userData.max_images || 300)) {
        toast.error(`Você atingiu o limite de ${userData.max_images || 300} imagens.`);
        return;
    }

    setIsLoading(true);
    setCurrentStatus('Iniciando...');
    
    const currentMessage = message;
    const currentImages = [...images];
    
    // Add user message to local state
    const userMsgId = Date.now().toString();
    const tempUserMsg = {
        id: userMsgId,
        chatId: 'ephemeral',
        userId: auth.currentUser?.uid || 'anon',
        role: 'user' as const,
        content: currentMessage,
        imageUrls: [...imagePreviews], // Use the memoized previews
        generatedImageUrls: [],
        createdAt: Date.now()
    };
    addMessage(tempUserMsg);

    setMessage('');
    setImages([]);

    try {
        const messagesPayload: any[] = [];
        
        // Helper to resize image and convert to base64 with cleanup
        const processImage = (file: File): Promise<string> => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = (event) => {
                    const img = new Image();
                    img.src = event.target?.result as string;
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        const MAX_WIDTH = 800;
                        const MAX_HEIGHT = 800;
                        let width = img.width;
                        let height = img.height;

                        if (width > height) {
                            if (width > MAX_WIDTH) {
                                height *= MAX_WIDTH / width;
                                width = MAX_WIDTH;
                            }
                        } else {
                            if (height > MAX_HEIGHT) {
                                width *= MAX_HEIGHT / height;
                                height = MAX_HEIGHT;
                            }
                        }

                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx?.drawImage(img, 0, 0, width, height);
                        const result = canvas.toDataURL('image/jpeg', 0.6);
                        
                        // ✅ Cleanup canvas and image
                        canvas.width = 0;
                        canvas.height = 0;
                        img.src = '';
                        
                        resolve(result);
                    };
                    img.onerror = reject;
                };
                reader.onerror = reject;
            });
        };

        // Build minimal payload (history is handled by server now or stateless context)
        const contentArr: any[] = [{ type: "text", text: currentMessage }];
        if (currentImages.length > 0) {
            const base64Results = await Promise.all(currentImages.map(file => processImage(file).catch(() => null)));
            for (const base64 of base64Results) {
                if (base64) contentArr.push({ type: "image_url", image_url: { url: base64, detail: "auto" } });
            }
        }
        messagesPayload.push({ role: "user", content: contentArr });

        const token = await auth.currentUser?.getIdToken();
        const response = await fetch('/api/chat/send', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                messages: messagesPayload, 
                aspect_ratio: aspectRatio 
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('AI API error:', errorText);
            
            if (response.status === 413) {
                toast.error("O pedido é muito grande. Tente enviar menos fotos ou fotos menores.");
            } else {
                try {
                    const errorData = JSON.parse(errorText);
                    toast.error(`Falha no Processamento: ${errorData.error || errorData.message || 'Erro desconhecido'}`);
                } catch (e) {
                    toast.error(`Erro inesperado do servidor: ${response.status}`);
                }
            }
            setIsLoading(false);
            return;
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        const assistantMsgId = (Date.now() + 1).toString();
        
        let assistantContent = '';
        let assistantImageUrls: string[] = [];

        if (reader) {
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataText = line.substring(6).trim();
                        if (!dataText) continue;
                        try {
                            const data = JSON.parse(dataText);
                            if (data.type === 'error') {
                                toast.error(`Erro: ${data.message || 'Erro inesperado'}`);
                                setIsLoading(false);
                                return;
                            }
                            if (data.type === 'status') {
                                const statusMap: Record<string, string> = {
                                    'analyzing_images': '🔍 Analisando produtos...',
                                    'planning_design': '📋 Planejando o design...',
                                    'generating_image': '🎨 Gerando imagem HD (2K)...'
                                };
                                setCurrentStatus(statusMap[data.content] || data.content);
                            }
                            if (data.type === 'text') {
                                assistantContent += data.content;
                            }
                            if (data.type === 'image') {
                                assistantImageUrls = [data.url];
                            }
                            if (data.type === 'done') {
                                addMessage({
                                    id: assistantMsgId,
                                    userId: auth.currentUser?.uid || 'anon',
                                    role: 'assistant',
                                    content: data.fullText || assistantContent,
                                    imageUrls: [],
                                    generatedImageUrls: data.imageUrl ? [data.imageUrl] : assistantImageUrls,
                                    createdAt: Date.now()
                                });

                                // Sync profile data
                                if (auth.currentUser) {
                                    const profDoc = await getDoc(doc(db, 'profiles', auth.currentUser.uid));
                                    if (profDoc.exists()) {
                                        setUserData({ ...userData!, ...profDoc.data() });
                                    }
                                }
                                
                                setIsFinished(true);
                                toast.success("Encarte gerado com sucesso!");
                            }
                        } catch (e) { }
                    }
                }
            }
        }
    } catch (e) {
        console.error(e);
        toast.error("Ocorreu um erro ao processar sua solicitação.");
    } finally {
        setIsLoading(false);
    }
  };

  const handleDownload = async (url: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `encarte-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      window.open(url, '_blank');
    }
  };

  return (
    <div className="flex flex-col h-full items-center relative w-full pt-4 md:pt-0">
      {/* Aspect Ratio Selector */}
      <div className="w-full max-w-4xl px-4 md:px-8 mb-2 flex justify-center">
         <div className="bg-white/80 backdrop-blur-sm border border-slate-200 p-1 rounded-xl flex shadow-sm gap-1">
            <button 
              onClick={() => setAspectRatio('9:16')}
              disabled={isLoading || isFinished}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${aspectRatio === '9:16' ? 'bg-[var(--color-primary)] text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}
            >
               <Smartphone size={14} />
               9:16 (Story)
            </button>
            <button 
              onClick={() => setAspectRatio('1:1')}
              disabled={isLoading || isFinished}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${aspectRatio === '1:1' ? 'bg-[var(--color-primary)] text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}
            >
               <Square size={14} />
               1:1 (Post)
            </button>
            <button 
              onClick={() => setAspectRatio('16:9')}
              disabled={isLoading || isFinished}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${aspectRatio === '16:9' ? 'bg-[var(--color-primary)] text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}
            >
               <Monitor size={14} />
               16:9 (Banner)
            </button>
         </div>
      </div>

      <div className="flex-1 w-full max-w-4xl mx-auto overflow-y-auto p-4 md:p-8 space-y-6">
        {messages.length === 0 ? (
          <div className="mt-10 md:mt-20 text-center">
            <div className="w-16 h-16 bg-[#EDE5FF] rounded-2xl flex items-center justify-center mx-auto mb-6">
              <span className="text-3xl">🎨</span>
            </div>
            <h2 className="text-2xl font-semibold mb-4 text-[#1A1A2E]">EncartIA</h2>
            <div className="bg-white p-6 rounded-2xl shadow-sm space-y-4 max-w-md mx-auto text-left">
              <p className="text-[#1A1A2E] font-medium text-center">Escolha o formato acima e descreva seu encarte. <br/><span className="text-xs text-slate-500">(Você pode enviar até 10 fotos de produtos)</span></p>
              <div>
                <p className="text-sm font-semibold text-[#6B7280] uppercase tracking-wider mb-2">Sugestões:</p>
                <ul className="text-sm text-[#1A1A2E] space-y-1 list-disc pl-4 opacity-80">
                  <li>"Crie um encarte de oferta de carnes para o fim de semana"</li>
                  <li>"Promoção de hortifruti com fundo verde claro"</li>
                  <li>"Encarte de eletrônicos estilo minimalista"</li>
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col space-y-6 pb-20">
            {messages.map((msg: any) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl p-4 shadow-sm ${msg.role === 'user' ? 'bg-[var(--color-primary)] text-white rounded-tr-none' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'}`}>
                  {msg.role === 'assistant' && (
                     <p className="mb-2 font-medium text-[var(--color-primary)] text-sm">Assistente EncartIA</p>
                  )}
                  {msg.imageUrls?.length > 0 && (
                      <div className="flex gap-2 flex-wrap mb-3">
                          {msg.imageUrls.map((url: string, i: number) => (
                              <div key={i} className="w-16 h-16 bg-white/20 rounded-lg border border-white/20 flex items-center justify-center overflow-hidden">
                                 <img src={url} alt="upload" className="w-full h-full object-cover" />
                              </div>
                          ))}
                      </div>
                  )}
                  <div className="markdown-body text-sm leading-relaxed prose prose-sm max-w-none">
                    <Markdown>{typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}</Markdown>
                  </div>
                  {msg.generatedImageUrls?.length > 0 && (
                      <div className="mt-4 bg-indigo-50 border border-indigo-100 p-4 rounded-2xl shadow-sm inline-block w-full max-w-sm">
                          <div className="flex items-center gap-3 mb-4">
                             <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-md">
                                <CheckCircle2 size={20} className="fill-white text-indigo-600" />
                             </div>
                             <div>
                                <p className="font-bold text-indigo-900 text-sm">Encarte Pronto!</p>
                                <p className="text-xs text-indigo-700">Versão final em alta definição (2K)</p>
                             </div>
                          </div>
                          
                          <div className="mb-4 rounded-xl overflow-hidden border border-indigo-200 shadow-sm bg-white">
                              <img 
                                src={msg.generatedImageUrls[0]} 
                                alt="Encarte gerado" 
                                className="w-full h-auto cursor-zoom-in"
                                onClick={() => window.open(msg.generatedImageUrls[0], '_blank')}
                                loading="lazy"
                              />
                          </div>
                          
                          <div className="flex flex-col gap-2">
                             <Button 
                                onClick={() => handleDownload(msg.generatedImageUrls[0])}
                                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-6 rounded-xl text-sm font-bold transition-all text-center shadow-md flex items-center justify-center gap-2"
                             >
                                <Download size={18} />
                                Baixar em Alta Definição (2K)
                             </Button>
                          </div>
                      </div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
                <div className="flex justify-start">
                    <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-sm flex items-center gap-3">
                        <Loader2 className="w-5 h-5 animate-spin text-[var(--color-primary)]" />
                        <span className="text-sm text-slate-600 font-medium">{currentStatus || 'Iniciando...'}</span>
                    </div>
                </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="w-full shrink-0 p-4 md:p-6 bg-white border-t border-slate-200 mt-auto relative z-10 shadow-[0_-4px_20px_rgba(0,0,0,0.02)]">
        <div className="max-w-4xl mx-auto relative flex flex-col gap-2">
          {isFinished && (
            <div className="flex justify-center mb-2">
                <Button 
                  onClick={handleReset}
                  className="bg-[#F3F4F6] text-[#374151] hover:bg-[#E5E7EB] border border-[#D1D5DB] flex items-center gap-2 font-bold py-6 px-8 rounded-2xl"
                >
                    <RefreshCw size={20} />
                    Novo Encarte
                </Button>
            </div>
          )}

          {!isFinished && (
            <>
              {images.length > 0 && (
                <div className="flex gap-2 p-2 overflow-x-auto border-b border-[#E5E7EB] mb-1">
                  {imagePreviews.map((url, i) => (
                    <div key={i} className="relative w-16 h-16 flex-shrink-0 group rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                      <img src={url} alt="upload" className="w-full h-full object-cover" />
                      <button 
                        onClick={() => setImages(images.filter((_, idx) => idx !== i))}
                        className="absolute top-1 right-1 bg-white/80 backdrop-blur text-red-500 hover:bg-red-500 hover:text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-all shadow-sm"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              
              <div className="relative flex items-center w-full">
                <div className="absolute left-4 z-10 flex items-center">
                  <label className="cursor-pointer text-slate-400 hover:text-[var(--color-primary)] p-1 transition-colors">
                    <input 
                      type="file" 
                      className="hidden" 
                      accept="image/*" 
                      multiple 
                      onChange={(e) => {
                        if (e.target.files) {
                          const newImages = Array.from(e.target.files).slice(0, 10 - images.length);
                          setImages([...images, ...newImages]);
                        }
                        e.target.value = '';
                      }} 
                    />
                    <Paperclip className="w-6 h-6" />
                  </label>
                </div>
                
                <Textarea
                  value={message}
                  disabled={isLoading || isFinished}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Descreva o encarte que deseja criar..."
                  className="w-full pl-14 pr-16 py-4 bg-slate-100 border-none rounded-2xl focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] transition-all text-slate-800 min-h-[56px] max-h-32 text-sm shadow-none resize-none disabled:opacity-50"
                  rows={1}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />
                
                <button 
                  onClick={handleSend}
                  disabled={((!message.trim() && images.length === 0) || isLoading || isFinished)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 bg-[var(--color-primary)] text-white p-2.5 rounded-xl hover:bg-[var(--color-primary-hover)] transition-colors shadow-sm disabled:opacity-50 min-w-[44px] flex items-center justify-center"
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5 flex-shrink-0" />
                  )}
                </button>
              </div>
            </>
          )}
        </div>
        <p className="text-center text-[10px] text-slate-400 mt-3 uppercase tracking-widest font-bold">Impulsionado por Genspark GPT-5.5 & GPT-IMAGE-2</p>
      </div>
    </div>
  );
}

