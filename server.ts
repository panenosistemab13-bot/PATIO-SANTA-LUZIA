import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase payload size for base64 images
app.use(express.json({ limit: '20mb' }));

// Gemini SDK Setup
const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// API Routes
app.post("/api/import-image", async (req, res) => {
  try {
    const { imageBase64 } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: "No image data provided" });
    }

    // Extract the base64 data (remove data:image/...;base64, if present)
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Data,
            },
          },
          {
            text: `Analyze this spreadsheet image. Extract vehicles that are destined for 'SANTA LUZIA' and DO NOT have a 'Termo' signed (usually a column or checkbox). 
            Return a JSON array of objects with the following keys:
            - cavalo: the license plate of the truck head
            - carreta: the license plate of the trailer
            - destino: the destination (should be SANTA LUZIA or variations)
            
            IMPORTANT: Return ONLY the JSON array, no other text or explanation.`,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              cavalo: { type: Type.STRING },
              carreta: { type: Type.STRING },
              destino: { type: Type.STRING },
            },
            required: ["cavalo", "carreta", "destino"],
          },
        },
      },
    });

    const resultText = response.text;
    console.log("Gemini Response:", resultText);
    
    let vehicles = [];
    try {
      vehicles = JSON.parse(resultText || "[]");
    } catch (e) {
      console.error("Failed to parse Gemini response as JSON:", e);
      // Fallback: try to extract JSON from text if it's wrapped in markdown
      const jsonMatch = resultText?.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
         vehicles = JSON.parse(jsonMatch[0]);
      }
    }

    res.json({ vehicles });
  } catch (error) {
    console.error("Gemini Error:", error);
    res.status(500).json({ error: "Failed to process image", message: error instanceof Error ? error.message : String(error) });
  }
});

// Vite middleware for development
async function startServer() {
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
