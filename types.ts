
export interface TranscriptionEntry {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface KnowledgeFile {
  id: string;
  name: string;
  content: string; // Extracted text content
  size: number;
}

export enum SessionStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  ACTIVE = 'ACTIVE',
  ERROR = 'ERROR'
}
