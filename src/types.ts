export type Market = "PE" | "MX" | "CO" | "AR"

export interface SectionAnalysis {
  score: number
  feedback: string
}

export interface CVAnalysis {
  score: number
  summary: string
  sections: Record<string, SectionAnalysis>
  top_issues: string[]
  strengths: string[]
  market_fit: string
  ats_score: number
  ats_tips: string[]
}

export interface AnalysisMeta {
  pages: number
  words: number
  chars: number
  model_used: string
  processing_ms: number
}

export interface AnalysisResponse {
  analysis: CVAnalysis
  meta: AnalysisMeta
}
