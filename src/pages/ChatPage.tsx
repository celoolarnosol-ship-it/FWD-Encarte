import React, { useState, useEffect, useRef } from 'react';
import { Paperclip, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useParams, useNavigate } from 'react-router-dom';
import Markdown from 'react-markdown';
import { toast } from 'sonner';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase/client';
import { doc, collection, query, where, orderBy, onSnapshot, addDoc, getDoc, updateDoc, serverTimestamp, getDocs } from 'firebase/firestore';
import { AI_CONFIG } from '../constants/aiConfig';

export default function ChatPage() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const { userData, setUserData } = useAuthStore();
  const { messages, activeChatId, setActiveChatId, setMessages } = useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
     setActiveChatId(chatId || null);
     if (chatId) {
         const q = query(
           collection(db, `chats/${chatId}/messages`),
           orderBy('created_at', 'asc')
         );

         const unsubscribe = onSnapshot(q, (snapshot) => {
           const messageList = snapshot.docs.map(doc => ({
             id: doc.id,
             ...doc.data()
           })) as any[];
           setMessages(messageList);
         }, (error) => {
           handleFirestoreError(error, OperationType.LIST, `chats/${chatId}/messages`);
         });

         return () => unsubscribe();
     } else {
         setMessages([]);
     }
  }, [chatId, setActiveChatId, setMessages]);

  useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!message.trim() && images.length === 0) return;
    
    let currentChatId = chatId;
    
    if (!currentChatId) {
        try {
            const newChat = await addDoc(collection(db, 'chats'), {
                user_id: auth.currentUser?.uid,
                title: message.substring(0, 30) + (message.length > 30 ? '...' : ''),
                message_count: 0,
                is_archived: false,
                updated_at: serverTimestamp()
            });
            currentChatId = newChat.id;
            navigate(`/chat/${currentChatId}`);
        } catch (err) {
            handleFirestoreError(err, OperationType.CREATE, 'chats');
        }
    }

    const currentMessage = message;
    const currentImages = [...images];
    
    setMessage('');
    setImages([]);

    try {
        // Upload images using server proxy
        let uploadedImageUrls: string[] = [];
        if (currentImages.length > 0) {
            const formData = new FormData();
            currentImages.forEach(img => formData.append('files', img));
            
            const uploadRes = await fetch(`/api/chat/upload?chatId=${currentChatId}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${await auth.currentUser?.getIdToken()}` },
                body: formData
            });
            
            if (uploadRes.ok) {
                const uploadData = await uploadRes.json();
                uploadedImageUrls = uploadData.urls;
            } else {
                const err = await uploadRes.json();
                toast.error("Erro no upload de imagens: " + err.error);
            }
        }

        // Save user message to Firestore
        try {
            await addDoc(collection(db, `chats/${currentChatId}/messages`), {
                chat_id: currentChatId,
                user_id: auth.currentUser?.uid,
                role: 'user',
                content: currentMessage,
                image_urls: uploadedImageUrls,
                generated_image_urls: [],
                created_at: serverTimestamp()
            });
        } catch (err) {
            handleFirestoreError(err, OperationType.CREATE, `chats/${currentChatId}/messages`);
        }

        // Use static AI_CONFIG from constants
        let systemPrompt = AI_CONFIG.mainPrompt;
        if (AI_CONFIG.technicalPrompts.length > 0) {
            systemPrompt += `\n\nORIENTAÇÕES TÉCNICAS:\n${AI_CONFIG.technicalPrompts.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
        }
        const configData = AI_CONFIG;

        // Load history for AI
        const historySnap = await getDocs(query(collection(db, `chats/${currentChatId}/messages`), orderBy('created_at', 'asc')));
        const history = historySnap.docs.map(d => d.data());

        const messagesPayload: any[] = [ { role: "system", content: systemPrompt } ];
        for (const msg of history) {
            if (msg.role === 'user') {
                const contentArr: any[] = [{ type: "text", text: msg.content }];
                (msg.image_urls || []).forEach((url: string) => contentArr.push({ type: "image_url", image_url: { url, detail: "high" } }));
                messagesPayload.push({ role: "user", content: contentArr });
            } else if (msg.role === 'assistant') {
                messagesPayload.push({ role: "assistant", content: msg.content });
            }
        }

        const token = await auth.currentUser?.getIdToken();
        const response = await fetch('/api/chat/send', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ messages: messagesPayload, config: configData })
        });

        if (!response.ok) {
            const error = await response.json();
            alert('Erro: ' + error.error);
            return;
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (reader) {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataText = line.substring(6).trim();
                        if (!dataText) continue;
                        try {
                            const data = JSON.parse(dataText);
                            if (data.type === 'done') {
                                // Save AI assistant message
                                await addDoc(collection(db, `chats/${currentChatId}/messages`), {
                                    chat_id: currentChatId,
                                    user_id: auth.currentUser?.uid,
                                    role: 'assistant',
                                    content: data.fullText,
                                    image_urls: [],
                                    generated_image_urls: data.imageUrl ? [data.imageUrl] : [],
                                    created_at: serverTimestamp()
                                });

                                // Increment usage
                                const newImageCount = (userData?.image_count || 0) + 1;
                                await updateDoc(doc(db, 'profiles', auth.currentUser!.uid), {
                                    image_count: newImageCount
                                });
                                
                                await updateDoc(doc(db, 'chats', currentChatId), { 
                                    updated_at: serverTimestamp(),
                                    message_count: history.length + 2
                                });

                                setUserData({ ...userData!, image_count: newImageCount });
                            }
                        } catch (e) { console.error('Parse error', e); }
                    }
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
  };

  return (
    <div className="flex flex-col h-full items-center relative w-full">
      <div className="flex-1 w-full max-w-4xl mx-auto overflow-y-auto p-4 md:p-8 space-y-6">
        {!chatId && messages.length === 0 ? (
          <div className="mt-20 text-center">
            <div className="w-16 h-16 bg-[#EDE5FF] rounded-2xl flex items-center justify-center mx-auto mb-6">
              <span className="text-3xl">🎨</span>
            </div>
            <h2 className="text-2xl font-semibold mb-4 text-[#1A1A2E]">EncartIA</h2>
            <div className="bg-white p-6 rounded-2xl shadow-sm space-y-4 max-w-md mx-auto text-left">
              <p className="text-[#1A1A2E] font-medium">Olá! Eu posso criar encartes promocionais para você.</p>
              <div>
                <p className="text-sm font-semibold text-[#6B7280] uppercase tracking-wider mb-2">Como começar:</p>
                <ul className="text-sm text-[#1A1A2E] space-y-1 list-disc pl-4">
                  <li>Descreva o encarte que precisa</li>
                  <li>Envie fotos dos produtos</li>
                  <li>Informe preços e promoções</li>
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
                  {msg.image_urls?.length > 0 && (
                      <div className="flex gap-2 flex-wrap mb-3">
                          {msg.image_urls.map((url: string, i: number) => (
                              <div key={i} className="w-16 h-16 bg-white/20 rounded-lg border border-white/20 flex items-center justify-center overflow-hidden">
                                 <img src={url} alt="upload" className="w-full h-full object-cover" />
                              </div>
                          ))}
                      </div>
                  )}
                  <div className="markdown-body text-sm leading-relaxed prose prose-sm max-w-none">
                    <Markdown>{msg.content}</Markdown>
                  </div>
                  {msg.generated_image_urls?.length > 0 && (
                      <div className="mt-4 bg-slate-50 border border-slate-100 p-2 rounded-2xl shadow-lg inline-block relative group">
                          {msg.generated_image_urls.map((url: string, i: number) => (
                              <img key={i} src={url} alt="encarte gerado" className="max-w-full md:max-w-md rounded-xl shadow-sm" />
                          ))}
                          <div className="mt-3 flex justify-end items-center px-2 pb-1">
                             <a href={msg.generated_image_urls[0]} target="_blank" rel="noopener noreferrer" className="bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm inline-flex">Download High-Res</a>
                          </div>
                      </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="w-full shrink-0 p-4 md:p-6 bg-white border-t border-slate-200 mt-auto relative z-10 shadow-[0_-4px_20px_rgba(0,0,0,0.02)]">
        <div className="max-w-4xl mx-auto relative flex flex-col gap-2">
          {images.length > 0 && (
            <div className="flex gap-2 p-2 overflow-x-auto border-b border-[#E5E7EB] mb-1">
              {images.map((img, i) => (
                <div key={i} className="relative w-16 h-16 flex-shrink-0 group rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                  <img src={URL.createObjectURL(img)} alt="upload" className="w-full h-full object-cover" />
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
                      const newImages = Array.from(e.target.files).slice(0, 4 - images.length);
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
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Peça um ajuste ou descreva um novo encarte..."
              className="w-full pl-14 pr-16 py-4 bg-slate-100 border-none rounded-2xl focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] transition-all text-slate-800 min-h-[56px] max-h-32 text-sm shadow-none resize-none"
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
              disabled={(!message.trim() && images.length === 0) || userData?.image_count! >= userData?.max_images!}
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-[var(--color-primary)] text-white p-2.5 rounded-xl hover:bg-[var(--color-primary-hover)] transition-colors shadow-sm disabled:opacity-50"
            >
              <Send className="w-5 h-5 flex-shrink-0" />
            </button>
          </div>
        </div>
        <p className="text-center text-[10px] text-slate-400 mt-3 uppercase tracking-widest font-bold">Impulsionado por GPT-4o Vision & DALL-E 3</p>
      </div>
    </div>
  );
}
