export type KnowledgeRating = "right" | "wrong";
export interface KnowledgeQuestion { id: string; prompt: string; referenceAnswer: string }
export interface KnowledgeResponse { answer: string; rating: KnowledgeRating | null }
export interface KnowledgeResult { strong: number[]; needsReview: number[]; percent: number; complete: boolean }
