export interface NormalizedMessage {
  id: string;
  timestamp: Date;
  sender: string;
  text: string;
  isFromMe: boolean;
  hadAttachments: boolean;
  attachments?: NormalizedAttachment[];
  metadata?: Record<string, string | number | boolean | null>;
}

export interface NormalizedAttachment {
  name?: string;
  path?: string;
  mimeType?: string;
  kind?: "image" | "video" | "audio" | "document" | "other";
}

export interface NormalizedConversation {
  source: string;
  conversationId: string;
  title: string;
  participants: string[];
  messages: NormalizedMessage[];
}

export interface ExportAdapter {
  source: string;
  loadConversations(options: Record<string, unknown>): Promise<NormalizedConversation[]>;
}
