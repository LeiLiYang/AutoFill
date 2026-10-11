import type { FieldReport } from '../adapters/types';
import type { ExtractedPosting } from '../posting/extract';
import type { FormAnswer, SavePostingResult } from '../posting/save';
import type { FileKind } from '../profile/schema';
import type { LogResult } from '../tracking/queue';
import type { LogEntry } from '../tracking/row';

export type { ExtractedPosting, FormAnswer, SavePostingResult, LogResult };

/** Outcome of "Save my answers to answer bank", with enough detail to explain an empty result. */
export interface SaveAnswersResult {
  /** New or changed entries written to the answer bank. */
  saved: number;
  /** Hand-written answers found on the page (some may already be in the bank unchanged). */
  found: number;
  /** Form fields looked at. */
  scanned: number;
  /** Frames that could not be read (closed, navigated away, or not injected). */
  unreachable: number;
}

export type TestSheetsResult = { ok: true; rows: number } | { ok: false; message: string };

/** The provider accepted the key; `models` are the ids it offers (empty if it has no listing). */
export type TestLlmResult = { ok: true; models: string[]; label: string } | { ok: false; message: string };

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
  | { type: 'panel-update'; frames: FrameReport[]; filling: boolean; notice?: string }
  | { type: 'scroll-to'; fieldId: string }
  | { type: 'collect-answers' }
  /** Show the log card for this posting without filling anything (the user may not be applying). */
  | { type: 'open-log' }
  | { type: 'collect-form-answers' }
  | { type: 'extract-posting' };

/** Content script / popup → background. */
export type ToBackground =
  | { type: 'trigger-fill'; tabId: number; overwrite?: boolean }
  /** Popup / shortcut: open the log card only, no autofill. */
  | { type: 'open-log'; tabId: number }
  | { type: 'frame-report'; report: FrameReport }
  | { type: 'get-file'; kind: FileKind }
  | { type: 'focus-field'; frameId: number; fieldId: string }
  | { type: 'save-answers' }
  /** From the panel (sender.tab) or the popup (tabId). */
  | { type: 'save-posting'; tabId?: number }
  /** Sent only after the user confirms the log card. Nothing is ever logged automatically. */
  | { type: 'log-application'; entry: LogEntry; force?: boolean; alsoSavePosting?: boolean; tabId?: number }
  /** Draft one free-text answer with the LLM (the only call that sends profile/posting text off-device). */
  | { type: 'generate-answer'; question: string; maxLength?: number; /** Ignore a stored draft and write a new one. */ fresh?: boolean }
  /** Remember this page's job description so a later form page (e.g. Workday /apply) can use it. */
  | { type: 'cache-posting'; posting: ExtractedPosting }
  /** Settings page: sign in and read the sheet, to check the Sheet ID, tab name and OAuth setup. */
  | { type: 'test-sheets' }
  /** Settings page: check the chosen LLM provider's key and list its models (no prompt is sent). */
  | { type: 'test-llm' }
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
