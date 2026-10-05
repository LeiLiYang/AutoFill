import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { EEO_DECLINE, defaultProfile, defaultSettings } from '../../../src/profile/schema';
import { memoryStore } from '../../../src/profile/storage';
import { loadProfile, loadSettings, saveProfile, saveSettings } from '../../../src/profile/store';
import { getFile, putFile } from '../../../src/profile/files';
import { exportBackup, importBackup } from '../../../src/profile/importExport';

let kv = memoryStore();
beforeEach(() => {
  kv = memoryStore();
});

describe('schema', () => {
  it('defaults EEO answers to decline', () => {
    const p = defaultProfile();
    expect(Object.values(p.eeo)).toEqual(Array(5).fill(EEO_DECLINE));
  });

  it('defaults the model name and is configurable', () => {
    expect(defaultSettings().model).toBe('claude-opus-5-5');
  });
});

describe('store', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await loadProfile(kv)).toEqual(defaultProfile());
  });

  it('round-trips a profile', async () => {
    const p = defaultProfile();
    p.contact.firstName = 'Ada';
    p.experience.push({ ...p.experience[0]!, company: 'X' } as never);
    await saveProfile(p, kv);
    expect((await loadProfile(kv)).contact.firstName).toBe('Ada');
  });

  it('falls back to defaults on corrupt stored data', async () => {
    await kv.set('profile', { contact: 42 });
    expect(await loadProfile(kv)).toEqual(defaultProfile());
  });
});

describe('backup', () => {
  it('round-trips profile and resume, and never exports the API key', async () => {
    const p = defaultProfile();
    p.contact.email = 'ada@example.com';
    await saveProfile(p, kv);
    await saveSettings({ ...defaultSettings(), anthropicApiKey: 'sk-secret', sheetId: 'abc' }, kv);
    const bytes = new Uint8Array([37, 80, 68, 70, 0, 255, 128]);
    await putFile({
      kind: 'resume',
      name: 'cv.pdf',
      mime: 'application/pdf',
      data: bytes.buffer as ArrayBuffer,
    });

    const backup = await exportBackup(kv);
    const text = JSON.stringify(backup);
    expect(text).not.toContain('sk-secret');
    expect(backup.settings.sheetId).toBe('abc');

    const kv2 = memoryStore();
    await saveSettings({ ...defaultSettings(), anthropicApiKey: 'keep-me' }, kv2);
    await importBackup(JSON.parse(text), kv2);
    expect((await loadProfile(kv2)).contact.email).toBe('ada@example.com');
    const s = await loadSettings(kv2);
    expect(s.sheetId).toBe('abc');
    expect(s.anthropicApiKey).toBe('keep-me');
    const f = await getFile('resume');
    expect(f?.name).toBe('cv.pdf');
    expect(new Uint8Array(f!.data)).toEqual(bytes);
  });

  it('rejects invalid backups without touching existing data', async () => {
    const p = defaultProfile();
    p.contact.firstName = 'Keep';
    await saveProfile(p, kv);
    await expect(importBackup({ format: 'nope' }, kv)).rejects.toThrow();
    expect((await loadProfile(kv)).contact.firstName).toBe('Keep');
  });
});
