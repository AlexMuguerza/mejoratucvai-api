import { extractText } from "unpdf"

export interface ParsedPDF {
  text: string
  pages: number
  words: number
  chars: number
}

export async function parsePDF(buffer: ArrayBuffer): Promise<ParsedPDF> {
  // 1. Extraer texto con unpdf
  const { text: pages } = await extractText(new Uint8Array(buffer), { mergePages: false })

  // 2. Unir páginas con separador
  const text = pages.map((p: string, i: number) => `--- Página ${i + 1} ---\n\n${p}`).join("\n\n")

  // 3. Si text.trim().length < 100 → throw error
  if (text.trim().length < 100) {
    throw new Error("PDF sin texto extraíble")
  }

  // 4. Truncar a 40_000 chars si es necesario
  const MAX_CHARS = 40_000
  const truncatedText = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text

  // 5. Retornar stats
  return {
    text: truncatedText,
    pages: pages.length,
    words: truncatedText.split(/\s+/).filter(Boolean).length,
    chars: truncatedText.length,
  }
}
