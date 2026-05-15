import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import rateLimit from "express-rate-limit";
import cors from "cors";
import { adminAuth, adminDb, defaultDb, projectId, databaseId } from "./src/lib/firebase/admin.js";
import { s3Client, R2_BUCKET_NAME, R2_PUBLIC_DOMAIN } from "./src/lib/cloudflare/r2.js";
import { AI_CONFIG as DEFAULT_AI_CONFIG } from "./src/constants/aiConfig.js";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'celoolarnosol@gmail.com').toLowerCase();

let cachedConfig: any = null;
let lastCacheUpdate = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

async function getAIConfig() {
  if (cachedConfig && Date.now() - lastCacheUpdate < CACHE_TTL) {
    return cachedConfig;
  }

  const fetchFromDb = async (db: any, dbName: string) => {
    try {
      console.log(`Attempting to fetch AI config from Firestore (${dbName})...`);
      const docSnap = await db.collection('adminConfig').doc('settings').get();
      if (docSnap.exists) {
        const data = docSnap.data();
        console.log(`AI config fetched successfully from ${dbName}.`);
        return {
          mainPrompt: data?.main_prompt || DEFAULT_AI_CONFIG.mainPrompt,
          visionPrompt: data?.vision_prompt || DEFAULT_AI_CONFIG.visionPrompt,
          planningPrompt: data?.planning_prompt || DEFAULT_AI_CONFIG.planningPrompt,
          imageRules: data?.image_rules || DEFAULT_AI_CONFIG.imageRules,
          technicalPrompts: data?.technical_instructions || DEFAULT_AI_CONFIG.technicalPrompts || []
        };
      }
      return null;
    } catch (e: any) {
      console.error(`Error fetching from ${dbName}:`, e.message);
      return null;
    }
  };

  const result = await fetchFromDb(adminDb, databaseId || 'default') || 
                 (databaseId && databaseId !== '(default)' ? await fetchFromDb(defaultDb, '(default)') : null) ||
                 {
                    mainPrompt: DEFAULT_AI_CONFIG.mainPrompt,
                    visionPrompt: DEFAULT_AI_CONFIG.visionPrompt,
                    planningPrompt: DEFAULT_AI_CONFIG.planningPrompt,
                    imageRules: DEFAULT_AI_CONFIG.imageRules,
                    technicalPrompts: DEFAULT_AI_CONFIG.technicalPrompts || []
                 };

  cachedConfig = result;
  lastCacheUpdate = Date.now();
  return result;
}

function extractJSON(text: string): any {
  try { return JSON.parse(text); } catch {}
  
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch {}
  }
  
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch {}
  }
  return null;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 60000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}

async function uploadBase64ToR2(base64Data: string, filename: string): Promise<string> {
  if (!s3Client || !R2_BUCKET_NAME) {
    throw new Error("R2 storage not configured");
  }

  // Remove header from base64
  const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Clean, 'base64');

  await s3Client.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: `refs/${filename}`,
    Body: buffer,
    ContentType: 'image/jpeg',
  }));

  return `${R2_PUBLIC_DOMAIN}/refs/${filename}`;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.set('trust proxy', 1);
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Limite de requisições excedido. Tente novamente em 1 minuto.' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    keyGenerator: (req) => {
      return req.ip || 'unknown';
    }
  });

  app.get('/api/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      timestamp: Date.now(),
      hasGenspark: !!process.env.GSK_API_KEY,
      projectId: projectId 
    });
  });

  app.get("/api/admin/status", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
      const decodedUser = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
      if (decodedUser.email?.toLowerCase() !== ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });

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

  app.post("/api/chat/send", apiLimiter, async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const idToken = authHeader.split('Bearer ')[1];
      const decodedUser = await adminAuth.verifyIdToken(idToken);
      const userEmail = decodedUser.email?.toLowerCase();

      // Implement Whitelist Check if not Admin
      if (userEmail !== ADMIN_EMAIL) {
        const whitelistSnap = await adminDb.collection('adminConfig').doc('whitelist').get();
        const whitelist = whitelistSnap.exists ? (whitelistSnap.data()?.emails || []) : [];
        if (!whitelist.some((email: string) => email.toLowerCase() === userEmail)) {
          return res.status(403).json({ error: 'Você não tem permissão para usar este aplicativo.' });
        }
      }

      // Quota Check with Fallback
      let profileSnap;
      try {
        profileSnap = await adminDb.collection('profiles').doc(decodedUser.uid).get();
      } catch (e: any) {
        // Fallback on NOT_FOUND (5) OR PERMISSION_DENIED (7) for the named database
        const isNamedDbIssue = e.code === 5 || e.code === 7 || e.message.includes('NOT_FOUND') || e.message.includes('PERMISSION_DENIED');
        
        if (isNamedDbIssue && databaseId && databaseId !== '(default)') {
          console.warn(`Issue with database "${databaseId}" (Code ${e.code}). Falling back to (default) for quota check.`);
          try {
            profileSnap = await defaultDb.collection('profiles').doc(decodedUser.uid).get();
          } catch (fallbackErr: any) {
             console.error("Fallback to (default) also failed:", fallbackErr.message);
             throw e; // Throw original error if fallback also fails or isn't appropriate
          }
        } else {
          throw e;
        }
      }
      
      const profileData = profileSnap.exists ? profileSnap.data() : null;
      const imageCount = profileData?.image_count || 0;
      const maxImages = profileData?.max_images || 300;

      if (imageCount >= maxImages) {
        return res.status(429).json({ error: `Limite de imagens atingido (${maxImages}).` });
      }
      
      // Auto-create profile if it doesn't exist
      if (!profileSnap.exists) {
        const targetDb = profileSnap.ref.firestore === adminDb ? adminDb : defaultDb;
        await targetDb.collection('profiles').doc(decodedUser.uid).set({
          email: userEmail,
          image_count: 0,
          max_images: 300,
          role: userEmail === ADMIN_EMAIL ? 'admin' : 'user',
          created_at: new Date().toISOString()
        });
      }
      
      const gskApiKey = process.env.GSK_API_KEY;
      if (!gskApiKey) {
          return res.status(500).json({ error: 'Genspark API Key not configured on the server.' });
      }
      
      const { messages, aspect_ratio } = req.body;
      
      const aiSettings: any = await getAIConfig();
      const layoutInstructions = fs.existsSync('./instrucoes_encarte.txt') 
        ? fs.readFileSync('./instrucoes_encarte.txt', 'utf-8') 
        : "";

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      let aiText = "";
      let generatedImageUrl: string | undefined;

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

      // =====================================================
      // ESTÁGIO 1: VISÃO — Extrair dados concretos das imagens
      // =====================================================
      let extractedProductData = "";

      try {
          if (imageUrls.length > 0) {
            console.log(`[PIPELINE] Estágio 1: Iniciando Análise Visual com ${imageUrls.length} imagens.`);
          res.write(`data: ${JSON.stringify({ type: 'status', content: 'analyzing_images' })}\n\n`);

            console.log("Stage 1: Vision - Analyzing images...");
            const visionRes = await fetchWithTimeout("https://www.genspark.ai/api/tool_cli/understand_images", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Api-Key": gskApiKey
              },
              body: JSON.stringify({
                image_urls: imageUrls,
                instruction: aiSettings.visionPrompt
              })
            }, 45000); // 45s para visão

            if (visionRes.ok) {
              const visionData: any = await visionRes.json();
              extractedProductData = visionData.data || visionData.result || "";
              if (typeof extractedProductData !== 'string') {
                extractedProductData = JSON.stringify(extractedProductData);
              }
            } else {
              console.error("Vision extraction failed:", await visionRes.text());
              extractedProductData = "(Não foi possível analisar as imagens)";
            }
          }

          // =====================================================
          // ESTÁGIO 2: PLANEJAMENTO — Gerar briefing estruturado
          // =====================================================
          res.write(`data: ${JSON.stringify({ type: 'status', content: 'planning_design' })}\n\n`);

          const planningPrompt = `${aiSettings.planningPrompt}

DADOS EXTRAÍDOS DAS IMAGENS:
${extractedProductData}

PEDIDO DO USUÁRIO:
"${latestUserMessage}"

FORMATO SELECIONADO: ${aspect_ratio || '9:16'}

REGRAS DE LAYOUT E ESTRUTURA:
${layoutInstructions}

REGRAS TÉCNICAS:
${aiSettings.imageRules}

Retorne APENAS o JSON solicitado.`;

          const planningRes = await fetchWithTimeout("https://www.genspark.ai/api/tool_cli/super_agent", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Api-Key": gskApiKey
            },
            body: JSON.stringify({
              task_type: "super_agent",
              task_name: "Briefing de Encarte",
              query: planningPrompt,
              instructions: "Retorne APENAS JSON válido. Sem explicações, sem markdown."
            })
          }, 60000);

          let briefingJson: any = null;
          if (planningRes.ok) {
            const planData: any = await planningRes.json();
            const rawText = planData.data || planData.result || "";
            aiText = typeof rawText === 'string' ? rawText : JSON.stringify(rawText);

            briefingJson = extractJSON(aiText);
          }

          // Send friendly text update
          if (briefingJson) {
            const headline = briefingJson.promotion_title || briefingJson.copy?.headline || "Encarte";
            const products = briefingJson.products || [];
            const summary = `Gerando encarte para **${headline}**.\n\nProdutos identificados:\n${products.map((p: any) => `• ${p.name}${p.price_to ? ` - ${p.price_to}` : ''}`).join('\n')}`;
            res.write(`data: ${JSON.stringify({ type: 'text', content: summary })}\n\n`);
          } else if (aiText) {
            res.write(`data: ${JSON.stringify({ type: 'text', content: "Preparando o design do seu encarte..." })}\n\n`);
          }

          // =====================================================
          // ESTÁGIO 3: GERAÇÃO VISUAL — Imagem com referências
          // =====================================================
          console.log(`[PIPELINE] Estágio 3: Gerando imagem final em Alta Definição.`);
          res.write(`data: ${JSON.stringify({ type: 'status', content: 'generating_image', aspect_ratio: aspect_ratio || '9:16' })}\n\n`);

          // Upload reference images to get public URLs if needed
          const publicImageUrls: string[] = [];
          for (let i = 0; i < imageUrls.length; i++) {
            const url = imageUrls[i];
            if (url.startsWith('http')) {
              publicImageUrls.push(url);
            } else if (url.startsWith('data:image')) {
              try {
                const publicUrl = await uploadBase64ToR2(url, `${Date.now()}_${i}.jpg`);
                console.log(`Uploaded ref image ${i} to: ${publicUrl}`);
                publicImageUrls.push(publicUrl);
              } catch (e) {
                console.error("Failed to upload reference image:", e);
              }
            }
          }

          let finalImagePrompt = briefingJson?.image_prompt || aiText || latestUserMessage;
          if (finalImagePrompt.length > 1200) finalImagePrompt = finalImagePrompt.substring(0, 1200);

          const imagePrompt = `STRICT VISUAL REFERENCE TASK: Use the attached image_urls as the ONLY visual source for products and brands. 

CONTENT TO REPLICATE:
${finalImagePrompt}

${aiSettings.imageRules}
Color palette suggestions: ${briefingJson?.colors?.join(', ') || 'Vibrant retail colors'}

Note: The reference images are uploaded as public URLs for your direct reference. Match the packaging and logos exactly.`;

          const suggestedSize = aspect_ratio === "9:16" ? "1152x2048" : (aspect_ratio === "16:9" ? "2048x1152" : "1024x1024");

          console.log(`Stage 3: Generation - Prompting image generator with size ${suggestedSize}`);
          const generationBody: any = {
              query: imagePrompt,
              model: "gpt-image-2",
              aspect_ratio: aspect_ratio || "9:16",
              quality: "medium",
              size: suggestedSize
          };

          if (publicImageUrls.length > 0) {
              generationBody.image_urls = publicImageUrls;
          }

          const gskRes = await fetchWithTimeout("https://www.genspark.ai/api/tool_cli/image_generation", {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Api-Key": gskApiKey },
              body: JSON.stringify(generationBody)
          }, 90000);

          
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

          // SERVER-SIDE QUOTA INCREMENT
          try {
            const targetDb = profileSnap.ref.firestore === adminDb ? adminDb : defaultDb;
            await targetDb.collection('profiles').doc(decodedUser.uid).update({
              image_count: (await import('firebase-admin/firestore')).FieldValue.increment(1)
            });
          } catch (e: any) {
            console.warn("Failed to increment quota on primary DB, trying fallback if possible:", e.message);
            // If primary failed but we know we have a fallback, try defaultDb
            if (profileSnap.ref.firestore === adminDb) {
               try {
                  await defaultDb.collection('profiles').doc(decodedUser.uid).update({
                    image_count: (await import('firebase-admin/firestore')).FieldValue.increment(1)
                  });
               } catch (e2) { }
            }
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
          let errorMessage = error.message || 'Internal Server Error';
          const isFireStoreError = errorMessage.includes('PERMISSION_DENIED') || error.code === 7 || errorMessage.includes('NOT_FOUND') || error.code === 5;
          
          if (isFireStoreError) {
              errorMessage = `Erro no Firestore (Código ${error.code || '?'}). O ID do Banco usado no servidor foi "${databaseId}". Erro: ${errorMessage}. Se o erro for 'PERMISSION_DENIED', verifique se o ID do projeto "${projectId}" está correto em 'firebase-applet-config.json'. Se for 'NOT_FOUND', o banco com esse ID pode não existir.`;
          }
          res.status(500).json({ error: errorMessage });
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

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  });
}

startServer();
