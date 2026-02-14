import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

/* ============================= */
/* CONFIGURACIÓN BÁSICA */
/* ============================= */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const memoryFolder = path.join(__dirname, "memory");

if (!fs.existsSync(memoryFolder)) {
  fs.mkdirSync(memoryFolder);
}

/* ============================= */
/* CONFIGURACIÓN DE MODELO */
/* ============================= */

const MAX_HISTORY_MESSAGES = 12; // Limita consumo de tokens

/* ============================= */
/* RUTA PRINCIPAL */
/* ============================= */

app.post("/chat", async (req, res) => {
  try {
    const { userId, mensaje } = req.body;

    if (!userId || !mensaje) {
      return res.status(400).json({ error: "Faltan datos" });
    }

    const userFilePath = path.join(memoryFolder, `${userId}.json`);

    let historial = [];

if (fs.existsSync(userFilePath)) {
  const fileData = fs.readFileSync(userFilePath, "utf8");
  const parsed = JSON.parse(fileData);

  // Si es arreglo → perfecto
  if (Array.isArray(parsed)) {
    historial = parsed;
  } 
  // Si es formato antiguo → convertirlo
  else if (parsed.historial && Array.isArray(parsed.historial)) {
    historial = parsed.historial;
  } 
  // Si está corrupto → reiniciar
  else {
    historial = [];
   }
  }

    historial.push({ role: "user", content: mensaje });

    const historialLimitado = historial.slice(-MAX_HISTORY_MESSAGES);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Eres NOA, un espacio seguro donde acompañas emocionalmente con empatía, claridad y contención. No das diagnósticos médicos ni sustituyes terapia profesional. Escuchas con respeto y haces preguntas que ayuden a reflexionar.",
        },
        ...historialLimitado,
      ],
      temperature: 0.7,
    });

    const respuesta = completion.choices[0].message.content;

    historial.push({ role: "assistant", content: respuesta });

    fs.writeFileSync(userFilePath, JSON.stringify(historial, null, 2));

    res.json({ respuesta });
  } catch (error) {
    console.error("ERROR SERVIDOR:", error);
    res.status(500).json({ error: "Error en servidor" });
  }
});

/* ============================= */
/* PANEL DE MÉTRICAS */
/* ============================= */

app.get("/admin/metrics", (req, res) => {
  try {
    const files = fs.readdirSync(memoryFolder);

    let totalUsuarios = files.length;
    let totalMensajesGlobal = 0;

    let usuarios = [];

    files.forEach(file => {
      const filePath = path.join(memoryFolder, file);
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

      const userId = file.replace(".json", "");

      let totalMensajes = 0;

      if (Array.isArray(data)) {
        totalMensajes = data.length;
      }

      totalMensajesGlobal += totalMensajes;

      usuarios.push({
        userId,
        totalMensajes
      });
    });

    res.json({
      totalUsuarios,
      totalMensajesGlobal,
      usuarios
    });

  } catch (error) {
    console.error("Error métricas:", error);
    res.status(500).json({ error: "Error obteniendo métricas" });
  }
});

/* ============================= */
/* HEALTH CHECK */
/* ============================= */

app.get("/", (req, res) => {
  res.send("NOA backend funcionando correctamente");
});

/* ============================= */
/* PUERTO DINÁMICO PARA RENDER */
/* ============================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor NOA corriendo en puerto ${PORT}`);
});
