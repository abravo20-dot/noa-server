import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MAX_MENSAJES = 20;
const MAX_RECUERDOS = 10;
const LIMITE_DIARIO = 25;
const MEMORY_FOLDER = "./memory";

const BETA_USERS = [
  "user_14984dbf-c750-4c5f-a1d4-7aefff874f02"
];

if (!fs.existsSync(MEMORY_FOLDER)) {
  fs.mkdirSync(MEMORY_FOLDER);
}

function hoy() {
  return new Date().toISOString().split("T")[0];
}

function ahora() {
  return new Date().toISOString();
}

function obtenerRutaMemoria(userId) {
  return path.join(MEMORY_FOLDER, `${userId}.json`);
}

function cargarMemoria(userId) {
  const ruta = obtenerRutaMemoria(userId);

  let memoriaBase = {
    recuerdos: [],
    uso: { fecha: hoy(), mensajes: 0 },
    metricas: {
      totalMensajes: 0,
      totalSesiones: 0,
      diasActivos: [],
      ultimaSesion: null
    }
  };

  if (fs.existsSync(ruta)) {
    const data = JSON.parse(fs.readFileSync(ruta));
    memoriaBase = {
      recuerdos: data.recuerdos || [],
      uso: data.uso || memoriaBase.uso,
      metricas: data.metricas || memoriaBase.metricas
    };
  }

  return memoriaBase;
}

function guardarMemoria(userId, memoria) {
  const ruta = obtenerRutaMemoria(userId);
  fs.writeFileSync(ruta, JSON.stringify(memoria, null, 2));
}

function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function esSignificativo(texto) {
  const textoNormalizado = normalizar(texto);

  const claves = [
    "fallecio",
    "murio",
    "divorcio",
    "ansiedad",
    "depresion",
    "ruptura",
    "me separe",
    "diagnosticaron",
    "enfermedad",
    "mi hijo",
    "mi hija",
    "mi mama",
    "mi papa"
  ];

  return claves.some(p => textoNormalizado.includes(p));
}

async function resumirRecuerdo(texto) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "Resume el evento en una frase breve y objetiva."
      },
      { role: "user", content: texto }
    ],
    temperature: 0.3,
    max_tokens: 60
  });

  return completion.choices[0].message.content.trim();
}

// ============================
// CHAT
// ============================

app.post("/chat", async (req, res) => {

  try {

    let { userId, historial } = req.body;

    if (!userId) return res.status(400).json({ error: "Falta userId" });

    if (!BETA_USERS.includes(userId)) {
      return res.json({
        respuesta: "NOA está actualmente en beta privada. Solicita acceso para participar."
      });
    }

    if (!Array.isArray(historial)) {
      return res.status(400).json({ error: "Historial inválido" });
    }

    if (historial.length > MAX_MENSAJES) {
      historial = historial.slice(-MAX_MENSAJES);
    }

    const memoria = cargarMemoria(userId);

    // MÉTRICAS
    memoria.metricas.totalMensajes++;
    memoria.metricas.ultimaSesion = ahora();

    if (!memoria.metricas.diasActivos.includes(hoy())) {
      memoria.metricas.diasActivos.push(hoy());
      memoria.metricas.totalSesiones++;
    }

    // CONTROL DIARIO
    if (memoria.uso.fecha !== hoy()) {
      memoria.uso = { fecha: hoy(), mensajes: 0 };
    }

    if (memoria.uso.mensajes >= LIMITE_DIARIO) {
      return res.json({
        respuesta: "Has alcanzado el límite diario de mensajes en la versión beta."
      });
    }

    memoria.uso.mensajes++;

    // MEMORIA SIGNIFICATIVA
    const ultimoMensaje = historial[historial.length - 1];

    if (ultimoMensaje && ultimoMensaje.role === "user") {
      if (esSignificativo(ultimoMensaje.content)) {
        const resumen = await resumirRecuerdo(ultimoMensaje.content);

        memoria.recuerdos.push({
          texto: resumen,
          fecha: ahora()
        });

        if (memoria.recuerdos.length > MAX_RECUERDOS) {
          memoria.recuerdos.shift();
        }
      }
    }

    guardarMemoria(userId, memoria);

    let memoriaTexto = "";

    if (memoria.recuerdos.length > 0) {
      memoriaTexto = "Memoria relevante del usuario:\n";
      memoria.recuerdos.forEach(r => {
        memoriaTexto += `- ${r.texto}\n`;
      });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Eres NOA, acompañante emocional." },
        { role: "system", content: memoriaTexto },
        ...historial
      ],
      temperature: 0.7,
      max_tokens: 350
    });

    res.json({
      respuesta: completion.choices[0].message.content
    });

  } catch (error) {
    console.error("ERROR SERVIDOR:", error);
    res.status(500).json({ error: "Error en la IA" });
  }
});

// ============================
// PANEL INTERNO DE MÉTRICAS
// ============================

app.get("/admin/metrics", (req, res) => {

  const archivos = fs.readdirSync(MEMORY_FOLDER);

  let totalUsuarios = archivos.length;
  let totalMensajesGlobal = 0;
  let totalSesionesGlobal = 0;

  let usuarios = [];

  archivos.forEach(file => {

    const data = JSON.parse(
      fs.readFileSync(path.join(MEMORY_FOLDER, file))
    );

    const userId = file.replace(".json", "");

    totalMensajesGlobal += data.metricas?.totalMensajes || 0;
    totalSesionesGlobal += data.metricas?.totalSesiones || 0;

    usuarios.push({
      userId,
      totalMensajes: data.metricas?.totalMensajes || 0,
      totalSesiones: data.metricas?.totalSesiones || 0,
      diasActivos: data.metricas?.diasActivos || [],
      recuerdosGuardados: data.recuerdos?.length || 0
    });
  });

  res.json({
    totalUsuarios,
    totalMensajesGlobal,
    totalSesionesGlobal,
    usuarios
  });

});

app.listen(3000, () => {
  console.log("Servidor NOA corriendo en http://localhost:3000");
});
