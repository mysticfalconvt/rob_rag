export interface Source {
  fileName: string;
  filePath: string;
  chunk: string;
  score: number;
  source: string;
  relevanceScore?: number;
  isReferenced?: boolean;
}
