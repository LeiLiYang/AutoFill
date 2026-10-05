import type { FieldReport } from '../adapters/types';
import type { FileKind } from '../profile/schema';

/** Background → content script (all frames of the tab). */
export type ToContent = { type: 'run-fill'; overwrite: boolean };

export interface FrameReport {
  frameUrl: string;
  isTop: boolean;
  adapter: string;
  reports: FieldReport[];
}

/** Content script / popup → background. */
export type ToBackground =
  | { type: 'trigger-fill'; tabId: number; overwrite?: boolean }
  | { type: 'frame-report'; report: FrameReport }
  | { type: 'get-file'; kind: FileKind };

export interface FileMessage {
  name: string;
  mime: string;
  base64: string;
}

export const reportsKey = (tabId: number) => `reports:${tabId}`;
