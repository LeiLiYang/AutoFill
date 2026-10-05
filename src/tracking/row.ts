import { z } from 'zod';
import { CATEGORIES, CHANNELS, LOCATIONS } from '../config/tracking';
import { isValidSheetDate } from './date';

/** What the user confirms in the log card. Allowed values come from config/tracking.ts. */
export const LogEntrySchema = z.object({
  company: z.string().trim().min(1, 'Company is required'),
  category: z.enum(CATEGORIES, { errorMap: () => ({ message: `Category must be one of ${CATEGORIES.join(', ')}` }) }),
  location: z.enum(LOCATIONS, { errorMap: () => ({ message: `Pick a location: ${LOCATIONS.join(', ')}` }) }),
  date: z.string().refine(isValidSheetDate, 'Date must be a real date written YYYY/MM/DD'),
  channel: z.enum(CHANNELS, { errorMap: () => ({ message: `Channel must be one of ${CHANNELS.join(', ')}` }) }),
  url: z
    .string()
    .trim()
    .refine((u) => {
      try {
        return /^https?:$/.test(new URL(u).protocol);
      } catch {
        return false;
      }
    }, 'URL must be a valid http(s) link'),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

export function validateEntry(entry: unknown): { ok: true; entry: LogEntry } | { ok: false; errors: string[] } {
  const r = LogEntrySchema.safeParse(entry);
  return r.success ? { ok: true, entry: r.data } : { ok: false, errors: r.error.issues.map((i) => i.message) };
}

/**
 * Rows are written with valueInputOption=USER_ENTERED, so Sheets would evaluate a value that starts
 * with = + - or @ as a formula. A leading apostrophe makes Sheets store it as plain text.
 */
export function escapeForSheets(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

/** The row as written to the sheet, columns A–H. Status (C) and Comments (G) are always empty. */
export function buildRow(e: LogEntry): string[] {
  return [
    escapeForSheets(e.company), // A Company
    e.category, //                 B Category
    '', //                         C Status
    e.location, //                 D Location
    e.date, //                     E Date (USER_ENTERED parses YYYY/MM/DD as a date)
    e.channel, //                  F Channel
    '', //                         G Comments
    escapeForSheets(e.url), //     H URL
  ];
}
