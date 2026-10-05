import { z } from 'zod';
import { getFile, putFile, deleteFile } from './files';
import {
  FileKindSchema,
  ProfileSchema,
  SettingsSchema,
  type FileKind,
} from './schema';
import { loadProfile, loadSettings, saveProfile, saveSettings } from './store';
import type { KeyValueStore } from './storage';
import { chromeLocalStore } from './storage';

const ExportedFileSchema = z.object({
  name: z.string(),
  mime: z.string(),
  base64: z.string(),
});

const BackupSchema = z.object({
  format: z.literal('job-autofill-backup'),
  version: z.literal(1),
  exportedAt: z.string(),
  profile: ProfileSchema,
  // The API key is intentionally excluded from backups.
  settings: SettingsSchema.omit({ anthropicApiKey: true }),
  files: z.record(FileKindSchema, ExportedFileSchema).default({}),
});
export type Backup = z.infer<typeof BackupSchema>;

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const KINDS: FileKind[] = ['resume', 'coverLetter'];

export async function exportBackup(kv: KeyValueStore = chromeLocalStore): Promise<Backup> {
  const { anthropicApiKey: _omit, ...settings } = await loadSettings(kv);
  const files: Backup['files'] = {};
  for (const kind of KINDS) {
    const f = await getFile(kind);
    if (f) {
      files[kind] = {
        name: f.name,
        mime: f.mime,
        base64: bytesToBase64(new Uint8Array(f.data)),
      };
    }
  }
  return {
    format: 'job-autofill-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: await loadProfile(kv),
    settings,
    files,
  };
}

/** Validates first, so a bad file never partially overwrites existing data. */
export async function importBackup(json: unknown, kv: KeyValueStore = chromeLocalStore) {
  const backup = BackupSchema.parse(json);
  const current = await loadSettings(kv);
  await saveProfile(backup.profile, kv);
  await saveSettings({ ...current, ...backup.settings }, kv);
  for (const kind of KINDS) {
    const f = backup.files[kind];
    if (f) {
      await putFile({
        kind,
        name: f.name,
        mime: f.mime,
        data: base64ToBytes(f.base64).buffer as ArrayBuffer,
      });
    } else {
      await deleteFile(kind);
    }
  }
}
