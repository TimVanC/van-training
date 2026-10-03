import type { SplitDraft } from '../lib/splitDraft.js';

/** A file the user attached, already reduced to something the coach can read. */
export type ChatAttachment =
  | { kind: 'image'; name: string; mediaType: string; data: string }
  | { kind: 'pdf'; name: string; data: string }
  | { kind: 'text'; name: string; text: string };

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatAttachment[];
}

export interface OnboardingChatRequest {
  messages: ChatTurn[];
  /** The draft currently on screen, including any edits the user made by hand. */
  draft?: SplitDraft | null;
}

export interface OnboardingChatResponse {
  reply: string;
  split: SplitDraft | null;
}
