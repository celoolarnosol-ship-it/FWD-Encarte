import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { adminAuth, adminDb, defaultDb, projectId, databaseId } from "./src/lib/firebase/admin.js";
import { s3Client, R2_BUCKET_NAME, R2_PUBLIC_DOMAIN } from "./src/lib/cloudflare/r2.js";
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
    technicalPrompts: DEFAULT_AI_CONFIG.technicalPrompts || []
  };
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
            res.write(`data: ${JSON.stringify({ type: 'status', content: 'analyzing_images' })}\n\n`);

            console.log("Stage 1: Vision - Analyzing images...");
            const visionRes = await fetch("https://www.genspark.ai/api/tool_cli/understand_images", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Api-Key": gskApiKey
              },
              body: JSON.stringify({
                image_urls: imageUrls,
                instruction: DEFAULT_AI_CONFIG.visionPrompt
              })
            });

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

          const planningPrompt = `${DEFAULT_AI_CONFIG.planningPrompt}

DADOS EXTRAÍDOS DAS IMAGENS:
${extractedProductData}

PEDIDO DO USUÁRIO:
"${latestUserMessage}"

FORMATO SELECIONADO: ${aspect_ratio || '9:16'}

REGRAS DE LAYOUT E ESTRUTURA:
${layoutInstructions}

REGRAS TÉCNICAS:
${DEFAULT_AI_CONFIG.imageRules}

Retorne APENAS o JSON solicitado.`;

          const planningRes = await fetch("https://www.genspark.ai/api/tool_cli/super_agent", {
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
          });

          let briefingJson: any = null;
          if (planningRes.ok) {
            const planData: any = await planningRes.json();
            const rawText = planData.data || planData.result || "";
            aiText = typeof rawText === 'string' ? rawText : JSON.stringify(rawText);

            try {
              const jsonMatch = aiText.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                briefingJson = JSON.parse(jsonMatch[0]);
              }
            } catch (e) {
              console.error("Failed to parse briefing JSON:", e);
            }
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

${DEFAULT_AI_CONFIG.imageRules}
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

          const gskRes = await fetch("https://www.genspark.ai/api/tool_cli/image_generation", {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Api-Key": gskApiKey },
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
