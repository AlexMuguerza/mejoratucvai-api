import { GoogleGenerativeAI } from "@google/generative-ai"

interface ModelSlot {
  name: string
  rpmLimit: number
  rpdLimit: number
  requestsThisMinute: number
  requestsToday: number
  lastMinuteReset: number
  lastDayReset: number
  last429At: number
  consecutive429s: number
}

export class GeminiRoundRobin {
  private models: ModelSlot[]
  private genai: GoogleGenerativeAI

  constructor(apiKey: string) {
    this.genai = new GoogleGenerativeAI(apiKey)
    this.models = [
      {
        name: "gemini-2.5-flash-lite",
        rpmLimit: 10,
        rpdLimit: 20,
        requestsThisMinute: 0,
        requestsToday: 0,
        lastMinuteReset: Date.now(),
        lastDayReset: Date.now(),
        last429At: 0,
        consecutive429s: 0,
      },
      {
        name: "gemini-2.5-flash",
        rpmLimit: 5,
        rpdLimit: 20,
        requestsThisMinute: 0,
        requestsToday: 0,
        lastMinuteReset: Date.now(),
        lastDayReset: Date.now(),
        last429At: 0,
        consecutive429s: 0,
      },
      {
        name: "gemini-2.5-pro",
        rpmLimit: 5,
        rpdLimit: 20,
        requestsThisMinute: 0,
        requestsToday: 0,
        lastMinuteReset: Date.now(),
        lastDayReset: Date.now(),
        last429At: 0,
        consecutive429s: 0,
      },
    ]
  }

  private resetCountersIfNeeded(slot: ModelSlot): void {
    const now = Date.now()
    // Reset por minuto
    if (now - slot.lastMinuteReset > 60_000) {
      slot.requestsThisMinute = 0
      slot.lastMinuteReset = now
    }
    // Reset por día
    if (now - slot.lastDayReset > 86_400_000) {
      slot.requestsToday = 0
      slot.lastDayReset = now
    }
  }

  private isAvailable(slot: ModelSlot): boolean {
    this.resetCountersIfNeeded(slot)

    // Verificar límites
    if (slot.requestsThisMinute >= slot.rpmLimit) {
      return false
    }
    if (slot.requestsToday >= slot.rpdLimit) {
      return false
    }

    // Verificar backoff por 429
    if (slot.last429At > 0) {
      const backoffMs = Math.min(10_000 * 2 ** slot.consecutive429s, 300_000)
      if (Date.now() - slot.last429At < backoffMs) {
        return false
      }
    }

    return true
  }

  async generate(
    prompt: string,
    system: string,
    maxTokens: number
  ): Promise<{ text: string; modelUsed: string }> {
    const MAX_CYCLES = 3

    for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
      for (const slot of this.models) {
        if (!this.isAvailable(slot)) {
          continue
        }

        try {
          const model = this.genai.getGenerativeModel({
            model: slot.name,
            systemInstruction: system,
          })

          const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
          })

          slot.requestsThisMinute++
          slot.requestsToday++
          slot.consecutive429s = 0
          slot.last429At = 0

          return { text: result.response.text(), modelUsed: slot.name }
        } catch (e: any) {
          const errorMessage = e.message?.toLowerCase() ?? ""
          if (errorMessage.includes("429") || errorMessage.includes("quota")) {
            slot.last429At = Date.now()
            slot.consecutive429s++
            continue
          }
          throw e
        }
      }

      // Si no encontramos modelo disponible, esperar y reintentar
      if (cycle < MAX_CYCLES - 1) {
        await Bun.sleep(10_000)
      }
    }

    throw new Error(
      "Todos los modelos Gemini agotados. Intenta en unos minutos."
    )
  }

  getStatus(): Record<string, object> {
    const status: Record<string, object> = {}

    for (const slot of this.models) {
      status[slot.name] = {
        requestsThisMinute: slot.requestsThisMinute,
        rpmLimit: slot.rpmLimit,
        requestsToday: slot.requestsToday,
        rpdLimit: slot.rpdLimit,
        available: this.isAvailable(slot),
      }
    }

    return status
  }
}

let _client: GeminiRoundRobin | null = null

export function initAIClient(apiKey: string): void {
  _client = new GeminiRoundRobin(apiKey)
}

export function getAIClient(): GeminiRoundRobin {
  if (!_client) {
    throw new Error("AI client no inicializado")
  }
  return _client
}
