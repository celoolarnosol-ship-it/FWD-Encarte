import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { adminAuth, adminDb, projectId } from "./src/lib/firebase/admin.js";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '100mb' }));

  app.get("/api/admin/status", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
      const decodedUser = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
      if (decodedUser.email !== 'celoolarnosol@gmail.com') return res.status(403).json({ error: 'Forbidden' });

      res.json({
        hasFirebaseStorage: false, // Explicitly disabled
        hasGensparkKey: !!process.env.GSK_API_KEY,
        projectId: projectId,
        isProduction: process.env.NODE_ENV === 'production'
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/chat/send", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      const gskApiKey = process.env.GSK_API_KEY;
      if (!gskApiKey) {
          return res.status(500).json({ error: 'Genspark API Key not configured on the server.' });
      }
      
      const { messages, config, aspect_ratio } = req.body;
      
      const SYSTEM_PROMPT_ANALYST = `
Você é o ENCARTE.AI — um agente especialista em marketing visual para 
pequenos negócios brasileiros. Sua função é transformar pedidos informais 
de comerciantes em briefings profissionais de design para encartes promocionais.

## SOBRE QUEM VOCÊ ATENDE
Seus usuários são donos de pequenos negócios: padarias, mercadinhos, açougues, 
salões de beleza, pet shops, restaurantes, lojas de roupas de bairro, oficinas, 
farmácias, papelarias, lanchonetes, pizzarias, sorveterias, floriculturas e 
similares. Eles geralmente:
- Não têm experiência com design ou marketing
- Falam de forma informal, com gírias e abreviações
- Precisam de resultados rápidos e práticos
- Querem algo que "chame atenção" e "venda"
- Têm orçamento limitado e não podem contratar designer

## SUAS RESPONSABILIDADES NESTE FLUXO
1. INTERPRETAR o pedido do usuário, por mais vago que seja
2. PERGUNTAR o que faltar (mas nunca mais que 2-3 perguntas por vez)
3. ESTRUTURAR um briefing completo com: tipo de negócio, produtos, preços, 
   cores da marca, tom de voz, público-alvo, sugestão de layout e textos (copy)
4. GERAR um prompt visual otimizado EM INGLÊS para o modelo de geração de imagem

## REGRAS DE COPY PARA ENCARTES
- Headlines devem ser CURTAS (máx 5 palavras), IMPACTANTES e em PORTUGUÊS
- Preços devem estar SEMPRE em destaque (fonte grande)
- Incluir CTA claro: "Corra!", "Só hoje!", "Aproveite!", "Não perca!"
- Rodapé com endereço e telefone/WhatsApp do estabelecimento
- NUNCA usar linguagem rebuscada — fale a língua do cliente do bairro
- Texto deve ser LEGÍVEL mesmo em tela de celular pequena

## REGRAS PARA O PROMPT VISUAL (IMAGE PROMPT)
O prompt que você gerar para a imagem DEVE:
- Ser escrito inteiramente em INGLÊS (melhor performance do modelo de imagem)
- Especificar ESTILO: "professional promotional flyer", "retail sale poster"
- Especificar LAYOUT: posição de textos, área de produtos, margens
- Especificar CORES: usar valores hex ou nomes precisos de cor
- Especificar TIPOGRAFIA: "bold sans-serif headline", "large price tags"
- Especificar ELEMENTOS: fotos de produtos, ícones de desconto, bordas
- Incluir TODO texto que deve aparecer na imagem (headline, preços, CTA, 
  endereço) — escrito EXATAMENTE como deve ser renderizado
- Mencionar "Brazilian Portuguese text" para garantir acentuação correta
- Pedir "clean composition, high contrast, easy to read on mobile screen"
- NÃO exceder 500 palavras no prompt

## RESTRIÇÕES ABSOLUTAS DE IMAGEM (NÃO NEGOCIÁVEIS)
Ao gerar o campo "image_prompt" e "suggested_size" e "suggested_quality", 
você DEVE respeitar estas restrições sem exceção:
1. O campo "suggested_quality" SEMPRE deve ser "medium". 
2. O campo "suggested_size" NUNCA pode ter nenhuma aresta acima de 2048px. 
3. No prompt visual (image_prompt), NUNCA inclua "4K", "8K" ou "HD". 
4. SEMPRE inclua: "Output specifications: medium quality, sharp and clean rendering, optimized for mobile screen viewing."

## FORMATO DE SAÍDA OBRIGATÓRIO (JSON VÁLIDO)
Exemplo:
{
  "business_type": "...",
  "copy": { "headline": "...", "subheadline": "...", "cta": "...", "footer": "..." },
  "image_prompt": "...",
  "suggested_size": "1024x1536",
  "suggested_quality": "medium"
}
`;

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      let aiText = "";

      // Extract images from messages if any (Vision)
      const imageUrls: string[] = [];
      let latestUserMessage = "";
      
      for (const msg of messages) {
        if (msg.role === 'user') {
          if (Array.isArray(msg.content)) {
            for (const item of msg.content) {
              if (item.type === 'image_url') imageUrls.push(item.image_url.url);
              if (item.type === 'text') latestUserMessage = item.text;
            }
          } else {
            latestUserMessage = msg.content;
          }
        }
      }

      try {
          if (imageUrls.length > 0) {
            // Using Genspark Understand Images for Vision
            console.log("Using Genspark Understand Images for text generation with images...");
            const understandRes = await fetch("https://www.genspark.ai/api/tool_cli/understand_images", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Api-Key": gskApiKey
              },
              body: JSON.stringify({
                image_urls: imageUrls,
                instruction: `${SYSTEM_PROMPT_ANALYST}\n\nUSER REQUEST: "${latestUserMessage}"`
              })
            });

            if (understandRes.ok) {
              const understandData: any = await understandRes.json();
              const rawAiText = understandData.data || understandData.result || understandData;
              aiText = typeof rawAiText === 'string' ? rawAiText : JSON.stringify(rawAiText);
              // Send text to client
              res.write(`data: ${JSON.stringify({ type: 'text', content: aiText })}\n\n`);
            } else {
              throw new Error(`Understand Images API failed: ${await understandRes.text()}`);
            }
          } else {
            // Using Genspark Super Agent for general text
            console.log("Using Genspark Super Agent for text generation...");
            const superAgentRes = await fetch("https://www.genspark.ai/api/tool_cli/super_agent", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Api-Key": gskApiKey
              },
              body: JSON.stringify({
                task_type: "super_agent",
                task_name: "Geração de Encarte",
                query: latestUserMessage,
                instructions: SYSTEM_PROMPT_ANALYST
              })
            });

            if (superAgentRes.ok) {
              const superAgentData: any = await superAgentRes.json();
              const rawAiText = superAgentData.data || superAgentData.result || superAgentData;
              aiText = typeof rawAiText === 'string' ? rawAiText : JSON.stringify(rawAiText);
              res.write(`data: ${JSON.stringify({ type: 'text', content: aiText })}\n\n`);
            } else {
              throw new Error(`Super Agent API failed: ${await superAgentRes.text()}`);
            }
          }
      } catch (err: any) {
          console.error("Genspark text generation error", err);
          res.write(`data: ${JSON.stringify({ type: 'error', message: `Erro na geração de texto: ${err.message}` })}\n\n`);
          res.end();
          return;
      }
      
      // Generate Image
      res.write(`data: ${JSON.stringify({ type: 'status', content: 'generating_image', aspect_ratio: aspect_ratio || '1:1' })}\n\n`);
      
      let generatedImageUrl: string | undefined;
      
      try {
          // Parse AI text to see if it returned JSON briefing or just raw text
          let finalImagePrompt = "";
          let suggestedSize = aspect_ratio === "9:16" ? "1152x2048" : (aspect_ratio === "16:9" ? "2048x1152" : "1360x2048");
          
          try {
            // Search for JSON block in aiText
            const jsonMatch = aiText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              finalImagePrompt = parsed.image_prompt || aiText;
              if (parsed.suggested_size) suggestedSize = parsed.suggested_size;
            } else {
              finalImagePrompt = aiText;
            }
          } catch (e) {
            finalImagePrompt = aiText;
          }

          if (finalImagePrompt.length > 1500) finalImagePrompt = finalImagePrompt.substring(0, 1500);

          const imagePrompt = `FOLLOW THIS DETAILED SCRIPT TO CREATE A PROFESSIONAL FLYER (MEDIUM QUALITY, 2K MAX, BRAZILIAN PORTUGUESE TEXT):\n\n${finalImagePrompt}\n\nStyle: Modern retail promotional flyer. Aspect Ratio: ${aspect_ratio || '1:1'}. Clear hierarchy, professional studio lighting, realistic products. ALL TEXT MUST BE IN BRAZILIAN PORTUGUESE. Output specifications: medium quality, sharp and clean rendering, optimized for mobile screen viewing.`;
          
          console.log(`Using Genspark GPT-IMAGE-2 with size ${suggestedSize} and quality medium...`);
          const gskRes = await fetch("https://www.genspark.ai/api/tool_cli/image_generation", {
              method: "POST",
              headers: {
                  "Content-Type": "application/json",
                  "X-Api-Key": gskApiKey
              },
              body: JSON.stringify({
                  query: imagePrompt,
                  model: "gpt-image-2",
                  aspect_ratio: aspect_ratio || "1:1",
                  quality: "medium",
                  size: suggestedSize
              })
          });
          
          if (gskRes.ok) {
              const text = await gskRes.text();
              let finalResult: any = null;
              try {
                // Try parsing entire body first (case for non-streaming or standard JSON)
                finalResult = JSON.parse(text);
              } catch (e) {
                // Fallback to line-by-line parsing for streaming/NDJSON responses
                const lines = text.trim().split('\n');
                for (const line of lines) {
                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.status === 'ok' || parsed.url || parsed.image_url) {
                          finalResult = parsed;
                          // If we find a result with a status 'ok', that's likely our final one
                          if (parsed.status === 'ok') break;
                        }
                    } catch(e) {}
                }
              }
              
              if (finalResult) {
                  // Robust URL extraction
                  const findUrl = (obj: any): string | undefined => {
                    if (!obj) return undefined;
                    // If it's a string that looks like a URL or base64, return it
                    if (typeof obj === 'string' && (obj.startsWith('http') || obj.startsWith('data:image'))) return obj;
                    
                    if (Array.isArray(obj)) {
                      for (const item of obj) {
                        const found = findUrl(item);
                        if (found) return found;
                      }
                    }
                    
                    if (typeof obj === 'object') {
                      // Check most likely fields first to be efficient
                      const priorityFields = ['image_url', 'url', 'result', 'images', 'data'];
                      for (const field of priorityFields) {
                        const found = findUrl(obj[field]);
                        if (found) return found;
                      }
                      // Deep search as fallback
                      for (const key in obj) {
                        if (!priorityFields.includes(key)) {
                          const found = findUrl(obj[key]);
                          if (found) return found;
                        }
                      }
                    }
                    return undefined;
                  };

                  generatedImageUrl = findUrl(finalResult.data) || findUrl(finalResult);
                  if (generatedImageUrl) console.log("Successfully extracted image URL:", generatedImageUrl.substring(0, 100) + "...");
              }
          } else {
              const errText = await gskRes.text();
              console.error("Genspark Image Error:", errText);
              throw new Error(`Genspark API error: ${errText}`);
          }
          
          if (!generatedImageUrl) {
              console.error("Failed to extract image URL from result:", JSON.stringify(finalResult));
              throw new Error("Não foi possível obter a URL da imagem gerada pelo Genspark.");
          }
          
          res.write(`data: ${JSON.stringify({ type: 'image', url: generatedImageUrl })}\n\n`);
      } catch (err: any) {
          console.error("Image generation error", err);
          res.write(`data: ${JSON.stringify({ type: 'error', message: `Erro na geração de imagem: ${err.message}` })}\n\n`);
      }
      
      res.write(`data: ${JSON.stringify({ type: 'done', fullText: aiText, imageUrl: generatedImageUrl })}\n\n`);
      res.end();
      
    } catch (error: any) {
      console.error("Outer server error:", error);
      if (!res.headersSent) {
          res.status(500).json({ error: error.message || 'Internal Server Error' });
      } else {
          try {
            res.write(`data: ${JSON.stringify({ type: 'error', message: error.message || 'Internal Server Error' })}\n\n`);
            res.end();
          } catch (e) {
            console.error("Critical error while sending error signal", e);
          }
      }
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
