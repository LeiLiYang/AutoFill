import type { FieldReport } from '../adapters/types';
import type { ExtractedPosting } from '../posting/extract';
import type { FormAnswer, SavePostingResult } from '../posting/save';
import type { FileKind } from '../profile/schema';

export type { ExtractedPosting, FormAnswer, SavePostingResult };

export interface CapturedAnswer {
  question: string;
  answer: string;
}

export interface FrameReport {
  /** Set by the background worker from the message sender. */
  frameId?: number;
  frameUrl: string;
  isTop: boolean;
  adapter: string;
  reports: FieldReport[];
}

/** Background → content script. */
export type ToContent =
  | { type: 'run-fill'; overwrite: boolean }
  | { type: 'panel-update'; frames: FrameReport[]; filling: boolean }
  | { type: 'scroll-to'; fieldId: string }
  | { type: 'collect-answers' }
  | { type: 'collect-form-answers' }
  | { type: 'extract-posting' };

/** Content script / popup → background. */
export type ToBackground =
  | { type: 'trigger-fill'; tabId: number; overwrite?: boolean }
  | { type: 'frame-report'; report: FrameReport }
  | { type: 'get-file'; kind: FileKind }
  | { type: 'focus-field'; frameId: number; fieldId: string }
  | { type: 'save-answers' }
  /** From the panel (sender.tab) or the popup (tabId). */
  | { type: 'save-posting'; tabId?: number };

/** Background ↔ offscreen document (blob URLs for large downloads). */
export type ToOffscreen =
  | { target: 'offscreen'; type: 'make-blob-url'; base64: string; mime: string }
  | { target: 'offscreen'; type: 'revoke-blob-url'; url: string };

export interface FileMessage {
  name: string;
  mime: string;
  base64: string;
}

export const reportsKey = (tabId: number) => `reports:${tabId}`;
