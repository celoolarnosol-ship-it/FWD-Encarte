import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { adminAuth, adminDb, defaultDb, projectId, databaseId } from "./src/lib/firebase/admin.js";
import { AI_CONFIG as DEFAULT_AI_CONFIG } from "./src/constants/aiConfig.js";

async function getAIConfig() {
  const fetchFromDb = async (db: any, dbName: string) => {
    try {
      console.log(`Attempting to fetch AI config from Firestore (${dbName})...`);
      const docSnap = await db.collection('config').doc('settings').get();
      if (docSnap.exists) {
        const data = docSnap.data();
        console.log(`AI config fetched successfully from ${dbName}.`);
        return {
          mainPrompt: data?.main_prompt || DEFAULT_AI_CONFIG.mainPrompt,
          techPrompts: data?.technical_instructions || DEFAULT_AI_CONFIG.technicalPrompts
        };
      }
      return null;
    } catch (e: any) {
      console.error(`Error fetching from ${dbName}:`, e.message);
      return null;
    }
  };

  // Try the specific database first
  const result = await fetchFromDb(adminDb, databaseId || 'default');
  if (result) return result;

  // Try the default database if different
  if (databaseId && databaseId !== '(default)') {
    const defaultResult = await fetchFromDb(defaultDb, '(default)');
    if (defaultResult) return defaultResult;
  }

  return {
    mainPrompt: DEFAULT_AI_CONFIG.mainPrompt,
    techPrompts: DEFAULT_AI_CONFIG.technicalPrompts
  };
}

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
      
      const aiSettings = await getAIConfig();
      const SYSTEM_PROMPT_ANALYST = `${aiSettings.mainPrompt}\n\nTECHNICAL SKILLS & REFERENCES:\n${aiSettings.techPrompts.join('\n')}\n\n## ENFORCEMENT: USE USER DATA AND IMAGES\nYou MUST extract and use every product, price, and business detail provided in the images or text. THE GENERATED IMAGE PROMPT MUST BE A DIRECT REFLECTION OF THE USER'S PRODUCTS.`;
      
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
                instruction: `STRICT TASK: Extract ALL business info, product names, brands, and prices from the attached images.
THEN, create a professional design briefing following these SYSTEM RULES:
${SYSTEM_PROMPT_ANALYST}

USER REQUEST: "${latestUserMessage}"
IMPORTANT: Your output MUST be ONLY the JSON specified. The "image_prompt" field MUST describe the products from the images in high detail so they can be recreated accurately.`
              })
            });

             if (understandRes.ok) {
              const understandData: any = await understandRes.json();
              const rawAiText = understandData.data || understandData.result || understandData;
              aiText = typeof rawAiText === 'string' ? rawAiText : JSON.stringify(rawAiText);
              
              // Clean up aiText for the chat UI - try to extract a friendly summary
              let chatFriendlyText = "Analisei suas imagens e estou criando seu encarte...";
              try {
                const parsed = typeof rawAiText === 'string' ? JSON.parse(rawAiText) : rawAiText;
                if (parsed.copy && parsed.copy.headline) {
                   chatFriendlyText = `Criando encarte: "${parsed.copy.headline}" para seu negócio de ${parsed.business_type || 'comércio'}.`;
                } else if (parsed.image_prompt) {
                   chatFriendlyText = "Estou processando o design com base nas referências enviadas...";
                }
              } catch (e) {
                // If it's not JSON or parsing fails, use the first 200 chars if it's a string
                if (typeof rawAiText === 'string' && rawAiText.length > 5 && !rawAiText.startsWith('{')) {
                   chatFriendlyText = rawAiText.substring(0, 300);
                }
              }

              // Send text to client
              res.write(`data: ${JSON.stringify({ type: 'text', content: chatFriendlyText })}\n\n`);
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

              // Clean up for chat
              let chatFriendlyText = aiText;
              try {
                if (aiText.startsWith('{')) {
                  const parsed = JSON.parse(aiText);
                  chatFriendlyText = `Preparando o encarte "${parsed.copy?.headline || 'Promocional'}"...`;
                }
              } catch(e){}

              res.write(`data: ${JSON.stringify({ type: 'text', content: chatFriendlyText })}\n\n`);
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

          const imagePrompt = `CREATE A HIGH-DEFINITION 2K PROFESSIONAL FLYER. 
STRICTLY FOLLOW THIS DESIGN SCRIPT:
${finalImagePrompt}

TECHNICAL SPECIFICATIONS:
- Resolution: High Definition (2048x2048 or equivalent)
- Style: Modern retail promotional flyer, vibrant colors, professional studio lighting.
- REFERENCE PRODUCTS: If images were provided, recreate the EXACT products, brands, and items shown in the references.
- Visual Language: Brazilian Portuguese text for all headings and price tags. Use "R$" for currency.
- Resolution: 2K, sharp details, commercial grade.`;

          const generationBody: any = {
              query: imagePrompt,
              model: "gpt-image-2",
              aspect_ratio: aspect_ratio || "1:1",
              quality: "high",
              size: suggestedSize
          };

          // Try to pass reference images if the tool supports it (hidden/beta feature in some image models)
          if (imageUrls.length > 0) {
              generationBody.image_urls = imageUrls;
          }
          
          console.log(`Using Genspark GPT-IMAGE-2 with size ${suggestedSize} and quality high-res...`);
          const gskRes = await fetch("https://www.genspark.ai/api/tool_cli/image_generation", {
              method: "POST",
              headers: {
                  "Content-Type": "application/json",
                  "X-Api-Key": gskApiKey
              },
              body: JSON.stringify(generationBody)
          });
          
          let finalResult: any = null;
          if (gskRes.ok) {
              const text = await gskRes.text();
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
