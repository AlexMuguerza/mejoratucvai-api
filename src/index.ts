import { parsePDF } from "./pdf-parser"
import { initAIClient, getAIClient } from "./ai-client"
import type { Market, AnalysisResponse, CVAnalysis } from "./types"

// ── Cargar .env ───────────────────────────────────────────────────────────────
// Bun carga .env automáticamente — no necesitas dotenv

const PDF_API_SECRET = process.env.PDF_API_SECRET ?? ""
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? ""
const ALLOWED_IP = process.env.ALLOWED_IP ?? ""
const MAX_MB = Number(process.env.MAX_PDF_SIZE_MB ?? "10")
const PORT = Number(process.env.PORT ?? "8000")

if (!PDF_API_SECRET) {
  console.error("❌ PDF_API_SECRET no definido")
  process.exit(1)
}
if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY no definido")
  process.exit(1)
}

initAIClient(GEMINI_API_KEY)

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

// Validar X-API-Secret con timing-safe compare
function validateSecret(request: Request): boolean {
  const secret = request.headers.get("X-API-Secret") ?? ""
  if (secret.length !== PDF_API_SECRET.length) return false
  return crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(PDF_API_SECRET))
}

function validateIP(request: Request): boolean {
  if (!ALLOWED_IP) return true
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    (request as any).socket?.remoteAddress ??
    ""
  return ip === ALLOWED_IP
}

// Contextos por mercado
const MARKET_CONTEXT: Record<Market, string> = {
  PE: "Perú — empresas valoran títulos locales (PUCP, ULima, UPC), CV máx 2 páginas, logros cuantificados muy valorados, LinkedIn es esperado.",
  MX: "México — formato más formal, certificaciones técnicas reconocidas, inglés es diferenciador clave.",
  CO: "Colombia — presentación impecable, inglés clave para cargos medios-altos, logros con métricas.",
  AR: "Argentina — tono más directo, side projects y proyectos propios bien valorados, menos corporativo.",
}

function buildPrompts(cvText: string, market: Market, role: string) {
  const system = `Eres un experto senior en reclutamiento y optimización de CVs para el mercado latinoamericano.
Contexto del mercado objetivo: ${MARKET_CONTEXT[market]}

Objetivo de evaluación:
- Sé exigente, directo y honesto. No suavices críticas.
- Prioriza empleabilidad real y filtro ATS por encima de estilo superficial.
- Si falta evidencia en el CV, penaliza. No asumas ni inventes información.

Rúbrica estricta de scoring (0-100):
- Base inicial: 55 (no 70).
- Resta puntos por: logros sin métricas, bullets genéricos, desorden, falta de keywords del rol, mala legibilidad ATS, errores de redacción.
- Suma puntos solo por evidencia concreta (impacto cuantificado, resultados, claridad, relevancia al rol, consistencia).
- No des score > 85 salvo que el CV sea claramente sobresaliente con evidencia sólida en varias secciones.
- No des score > 75 si faltan métricas de impacto en experiencia laboral.

Profundidad del feedback:
- Detecta debilidades críticas primero y ordénalas por impacto en contratación.
- Cada feedback debe ser accionable y específico (qué cambiar y cómo).
- Evita consejos vagos como "mejorar redacción" sin ejemplo concreto.
- Evalúa adecuación al mercado ${market} y al rol objetivo cuando exista.

RESPONDE ÚNICAMENTE CON JSON VÁLIDO. Sin markdown. Sin bloques de código. Sin texto fuera del JSON.
Estructura exacta:
{
  "score": <entero 0-100>,
  "summary": "<2-3 oraciones evaluando el CV globalmente>",
  "sections": {
    "<nombre_seccion>": {
      "score": <entero 0-100>,
      "feedback": "<qué está bien y qué mejorar, incluyendo acciones concretas>"
    }
  },
  "top_issues": ["<problema 1>", "<problema 2>", "<problema 3>"],
  "strengths": ["<fortaleza 1>", "<fortaleza 2>"],
  "market_fit": "<evaluación específica para el mercado ${market}>",
  "ats_score": <entero 0-100>,
  "ats_tips": ["<tip 1>", "<tip 2>"]
}

Reglas adicionales obligatorias:
- "top_issues" debe incluir exactamente 3 problemas, severos y priorizados.
- "strengths" debe incluir exactamente 2 fortalezas reales, no genéricas.
- "ats_tips" debe incluir exactamente 2 mejoras concretas orientadas a pasar filtros automáticos.
- Si el candidato parece junior, mantén exigencia alta pero adapta recomendaciones para elevar su perfil.`

  const roleText = role ? ` para el puesto de ${role}` : ""
  const user = `Analiza este CV${roleText}. Mercado objetivo: ${market}.
Haz una evaluación estricta enfocada en aumentar la probabilidad real de entrevistas.

TEXTO DEL CV:
---
${cvText}
---`

  return { system, user }
}

// ── Router ────────────────────────────────────────────────────────────────────

async function handleHealth(): Promise<Response> {
  return json({
    status: "ok",
    service: "mejoratucvai-api",
    ai_status: getAIClient().getStatus(),
  })
}

async function handleAnalyze(request: Request): Promise<Response> {
  const start = Date.now()

  // Seguridad
  //if (!validateIP(request)) return json({ error: "Forbidden" }, 403)
  if (!validateSecret(request)) return json({ error: "Unauthorized, Solo puede acceder al api desde el front" }, 401)

  // Parsear FormData
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return json({ error: "FormData inválido" }, 400)
  }

  const file = formData.get("file") as File | null
  const market = (formData.get("market") as Market) || "PE"
  const role = (formData.get("role") as string) || ""
  const userApiKey = (formData.get("user_api_key") as string | null)?.trim() || null

  // Validar archivo
  if (!file) return json({ error: "Se requiere un archivo PDF" }, 400)
  if (!file.name.endsWith(".pdf") && file.type !== "application/pdf") {
    return json({ error: "Solo se aceptan archivos PDF" }, 400)
  }
  const buffer = await file.arrayBuffer()
  if (buffer.byteLength > MAX_MB * 1024 * 1024) {
    return json({ error: `El PDF no puede superar ${MAX_MB}MB` }, 413)
  }

  // Parsear PDF
  let parsed
  try {
    parsed = await parsePDF(buffer)
  } catch (e: any) {
    return json({ error: e.message ?? "Error procesando el PDF" }, 422)
  }

  // Llamar a Gemini
  const { system, user } = buildPrompts(parsed.text, market, role)
  let geminiText: string
  let modelUsed: string
  try {
    const result = await getAIClient().generate(
      user,
      system,
      2048,
      userApiKey ?? undefined
    )
    geminiText = result.text
    modelUsed = result.modelUsed
  } catch (e: any) {
    return json({ error: e.message ?? "Error llamando a la IA" }, 503)
  }

  // Parsear JSON de Gemini
  // Limpiar posibles bloques ```json ... ``` antes de parsear
  let analysis: CVAnalysis
  try {
    const clean = geminiText
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim()
    analysis = JSON.parse(clean)
  } catch {
    return json({ error: "Respuesta de IA inválida — intenta de nuevo" }, 500)
  }

  const response: AnalysisResponse = {
    analysis,
    meta: {
      pages: parsed.pages,
      words: parsed.words,
      chars: parsed.chars,
      model_used: modelUsed,
      processing_ms: Date.now() - start,
    },
  }

  console.log('Modelo usado:', modelUsed, 'Procesamiento en ms:', response.meta.processing_ms)

  return json(response)
}

// ── Bun.serve ─────────────────────────────────────────────────────────────────

Bun.serve({
  port: PORT,
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method

    if (url.pathname === "/health" && method === "GET") {
      return handleHealth()
    }

    if (url.pathname === "/analyze" && method === "POST") {
      return handleAnalyze(request)
    }

    return json({ error: "Not found" }, 404)
  },
  error(error: Error): Response {
    console.error("Server error:", error)
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  },
})

console.log(`✅ mejoratucvai-api corriendo en http://localhost:${PORT}`)
