import type { FieldReport } from '../adapters/types';
import type { ExtractedPosting } from '../posting/extract';
import type { FormAnswer, SavePostingResult } from '../posting/save';
import type { FileKind } from '../profile/schema';
import type { LogResult } from '../tracking/queue';
import type { LogEntry } from '../tracking/row';

export type { ExtractedPosting, FormAnswer, SavePostingResult, LogResult };

export interface LogApplicationResponse {
  log: LogResult;
  /** Present when "also save posting" was ticked and the log succeeded. */
  save?: SavePostingResult;
}

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
  | { type: 'save-posting'; tabId?: number }
  /** Sent only after the user confirms the log card. Nothing is ever logged automatically. */
  | { type: 'log-application'; entry: LogEntry; force?: boolean; alsoSavePosting?: boolean; tabId?: number }
  | { type: 'queue-retry'; id?: string; force?: boolean }
  | { type: 'queue-mark-synced'; id: string }
  | { type: 'queue-discard'; id: string };

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
