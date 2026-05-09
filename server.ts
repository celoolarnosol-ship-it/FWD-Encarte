import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import multer from "multer";
import { adminAuth, adminDb, projectId } from "./src/lib/firebase/admin.js";
import { StorageService } from "./src/services/storageService.js";
import OpenAI from "openai";
import crypto from "crypto";

const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get("/api/admin/status", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
      const decodedUser = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
      if (decodedUser.email !== 'celoolarnosol@gmail.com') return res.status(403).json({ error: 'Forbidden' });

      const status = await StorageService.checkStatus();

      res.json({
        hasFirebaseStorage: status.connected,
        storageType: status.type,
        bucketName: status.bucket,
        hasOpenAIKey: !!process.env.OPENAI_API_KEY,
        projectId: projectId,
        isProduction: process.env.NODE_ENV === 'production'
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // User File Management
  app.post("/api/chat/upload", upload.array('files'), async (req, res) => {
      try {
          const authHeader = req.headers.authorization;
          if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
          const decodedUser = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
          const uid = decodedUser.uid;

          const files = req.files as Express.Multer.File[];
          if (!files || files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

          const chatId = req.query.chatId as string;
          if (!chatId) return res.status(400).json({ error: 'Missing chatId' });

          const urls = [];
          
          for (const file of files) {
              const fileName = `products/${uid}/${chatId}/${Date.now()}_${file.originalname}`;
              const publicUrl = await StorageService.uploadFile(file, fileName);
              urls.push(publicUrl);
          }
          res.json({ urls });
      } catch (e: any) {
          console.error("Upload error:", e);
          res.status(500).json({ error: e.message });
      }
  });

  // Admin File Management (Knowledge Base)
  app.get("/api/admin/files", async (req, res) => {
      try {
          const authHeader = req.headers.authorization;
          if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
          const decodedUser = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
          if (decodedUser.email !== 'celoolarnosol@gmail.com') return res.status(403).json({ error: 'Forbidden' });

          const files = await StorageService.listFiles('knowledge-base/');
          res.json({ files });
      } catch (e: any) {
          console.error(`GET files error:`, e);
          res.status(500).json({ error: e.message });
      }
  });

  app.post("/api/admin/files", upload.array('files'), async (req, res) => {
      try {
          const authHeader = req.headers.authorization;
          if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
          const decodedUser = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
          if (decodedUser.email !== 'celoolarnosol@gmail.com') return res.status(403).json({ error: 'Forbidden' });

          const files = req.files as Express.Multer.File[];
          if (!files || files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

          for (const file of files) {
              await StorageService.uploadFile(file, `knowledge-base/${file.originalname}`);
          }
          res.json({ status: 'ok' });
      } catch (e: any) {
          console.error("Admin storage upload error:", e);
          res.status(500).json({ error: e.message });
      }
  });

  app.delete("/api/admin/files", async (req, res) => {
      try {
          const authHeader = req.headers.authorization;
          if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
          const decodedUser = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
          if (decodedUser.email !== 'celoolarnosol@gmail.com') return res.status(403).json({ error: 'Forbidden' });

          const fullPath = req.body.fullPath;
          if (!fullPath) return res.status(400).json({ error: 'Missing path' });

          await StorageService.deleteFile(fullPath);
          res.json({ status: 'ok' });
      } catch (e: any) {
          res.status(500).json({ error: e.message });
      }
  });

  app.post("/api/chat/send", express.json(), async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      const apiKeyStr = process.env.OPENAI_API_KEY;
      if (!apiKeyStr) {
          return res.status(500).json({ error: 'OpenAI API Key not configured on the server.' });
      }
      
      const { messages, config } = req.body;
      const openai = new OpenAI({ apiKey: apiKeyStr });
      
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      let aiText = "";
      const isReasoningModel = config?.model === "gpt-5.5";

      // Helper to extract text from multi-modal content
      const getMessageText = (content: any) => {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
          return content
            .map(item => item.type === 'text' ? item.text : (item.type === 'image_url' ? '[Imagem enviada pelo usuário]' : ''))
            .join(' ');
        }
        return '';
      };

      try {
          if (isReasoningModel) {
            // Using responses.create for reasoning models as per OpenAI recommendation
            // We use a try-catch specifically for this as it might not be supported in all SDK versions
            try {
              const response = await (openai as any).responses.create({
                model: "gpt-5.5",
                input: messages.map((m: any) => `${m.role}: ${getMessageText(m.content)}`).join('\n'),
                reasoning: {
                  effort: "high"
                }
              });
              aiText = response.output_text || "";
              
              // Send text in manageable chunks to avoid buffer issues or truncation
              const CHUNK_SIZE = 4000;
              for (let i = 0; i < aiText.length; i += CHUNK_SIZE) {
                const content = aiText.substring(i, i + CHUNK_SIZE);
                res.write(`data: ${JSON.stringify({ type: 'text', content })}\n\n`);
              }
            } catch (reasoningErr: any) {
              console.error("Reasoning API failed, falling back to chat completions", reasoningErr);
              // Fallback to chat completions if responses.create fails
              const stream = await openai.chat.completions.create({
                model: "gpt-4o",
                messages,
                max_tokens: config?.maxTokens || 2000,
                temperature: config?.temperature || 0.7,
                stream: true,
              });
              
              for await (const chunk of stream) {
                  const content = chunk.choices[0]?.delta?.content || '';
                  aiText += content;
                  if (content) {
                      res.write(`data: ${JSON.stringify({ type: 'text', content })}\n\n`);
                  }
              }
            }
          } else {
            const stream = await openai.chat.completions.create({
              model: config?.model || "gpt-4o",
              messages,
              max_tokens: config?.maxTokens || 2000,
              temperature: config?.temperature || 0.7,
              stream: true,
            });
            
            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || '';
                aiText += content;
                if (content) {
                    res.write(`data: ${JSON.stringify({ type: 'text', content })}\n\n`);
                }
            }
          }
      } catch (err: any) {
          console.error("OpenAI text generation error", err);
          res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
          res.end();
          return;
      }
      
      // Generate Image
      res.write(`data: ${JSON.stringify({ type: 'status', content: 'generating_image' })}\n\n`);
      
      let generatedImageUrl;
      try {
          try {
            const imageResponse = await openai.images.generate({
              model: config?.imageModel || "gpt-image-2",
              prompt: `FOLLOW THIS DETAILED SCRIPT TO CREATE A PROFESSIONAL FLYER:\n\n${aiText.substring(0, 1500)}\n\nStyle: Modern retail promotional flyer. Formato: Story vertical 9:16. EXTREMELY IMPORTANT: Follow the color palette and icons mentioned in the script. Clear hierarchy, professional studio lighting, realistic products. ALL TEXT MUST BE IN BRAZILIAN PORTUGUESE.`,
              n: 1,
              size: "1024x1024",
              quality: "standard"
            });
            generatedImageUrl = imageResponse.data[0].url;
          } catch (imgErr: any) {
            console.error("Image model generation failed, falling back to dall-e-3", imgErr);
            const fallbackResponse = await openai.images.generate({
              model: "dall-e-3",
              prompt: `FOLLOW THIS DETAILED SCRIPT TO CREATE A PROFESSIONAL FLYER:\n\n${aiText.substring(0, 1500)}\n\nStyle: Modern retail promotional flyer. Formato: Story vertical 9:16. EXTREMELY IMPORTANT: Follow the color palette and icons mentioned in the script. Clear hierarchy, professional studio lighting, realistic products. ALL TEXT MUST BE IN BRAZILIAN PORTUGUESE.`,
              n: 1,
              size: "1024x1024",
              quality: "standard"
            });
            generatedImageUrl = fallbackResponse.data[0].url;
          }
          res.write(`data: ${JSON.stringify({ type: 'image', url: generatedImageUrl })}\n\n`);
      } catch (err: any) {
          console.error("OpenAI image generation error", err);
          res.write(`data: ${JSON.stringify({ type: 'error', message: 'Erro na geração de imagem' })}\n\n`);
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
