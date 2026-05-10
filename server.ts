import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { adminAuth, adminDb, projectId } from "./src/lib/firebase/admin.js";
import OpenAI from "openai";

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

      res.json({
        hasFirebaseStorage: false, // Explicitly disabled
        hasOpenAIKey: !!process.env.OPENAI_API_KEY,
        projectId: projectId,
        isProduction: process.env.NODE_ENV === 'production'
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/chat/send", express.json({ limit: '100mb' }), async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      
      const apiKeyStr = process.env.OPENAI_API_KEY;
      if (!apiKeyStr) {
          return res.status(500).json({ error: 'OpenAI API Key not configured on the server.' });
      }
      
      const { messages, config, aspect_ratio } = req.body;
      const openai = new OpenAI({ apiKey: apiKeyStr });
      
      // Map aspect ratio to DALL-E 3 sizes
      let imageSize: "1024x1024" | "1024x1792" | "1792x1024" = "1024x1024";
      if (aspect_ratio === "9:16") imageSize = "1024x1792";
      else if (aspect_ratio === "16:9") imageSize = "1792x1024";
 
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      let aiText = "";
 
      try {
          const stream = await openai.chat.completions.create({
            model: config?.model || "gpt-4o",
            messages,
            max_tokens: config?.maxTokens || 2000,
            temperature: (config?.model || "").startsWith("o1") ? undefined : (config?.temperature || 0.7),
            stream: true,
          });
          
          for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content || '';
              aiText += content;
              if (content) res.write(`data: ${JSON.stringify({ type: 'text', content })}\n\n`);
          }
      } catch (err: any) {
          console.error("OpenAI text generation error", err);
          res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
          res.end();
          return;
      }
      
      // Generate Image
      res.write(`data: ${JSON.stringify({ type: 'status', content: 'generating_image', aspect_ratio: aspect_ratio || '1:1' })}\n\n`);
      
      let generatedImageUrl;
      try {
          const imagePrompt = `FOLLOW THIS DETAILED SCRIPT TO CREATE A PROFESSIONAL FLYER:\n\n${aiText.substring(0, 1500)}\n\nStyle: Modern retail promotional flyer. Aspect Ratio: ${aspect_ratio || '1:1'}. EXTREMELY IMPORTANT: Follow the color palette and icons mentioned in the script. Clear hierarchy, professional studio lighting, realistic products. ALL TEXT MUST BE IN BRAZILIAN PORTUGUESE.`;
          
          try {
            const imageResponse = await openai.images.generate({
              model: config?.imageModel || "dall-e-3",
              prompt: imagePrompt,
              n: 1,
              size: imageSize,
              quality: "hd"
            });
            generatedImageUrl = imageResponse.data[0].url;
          } catch (imgErr: any) {
            console.error("Image generation failed:", imgErr);
            const fallbackResponse = await openai.images.generate({
              model: "dall-e-3",
              prompt: imagePrompt,
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
