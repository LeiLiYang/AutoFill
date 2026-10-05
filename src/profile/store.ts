import {
  ProfileSchema,
  SettingsSchema,
  type Profile,
  type Settings,
} from './schema';
import { chromeLocalStore, type KeyValueStore } from './storage';

const PROFILE_KEY = 'profile';
const SETTINGS_KEY = 'settings';

export async function loadProfile(kv: KeyValueStore = chromeLocalStore): Promise<Profile> {
  const raw = await kv.get(PROFILE_KEY);
  const parsed = ProfileSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : ProfileSchema.parse({});
}

export async function saveProfile(profile: Profile, kv: KeyValueStore = chromeLocalStore) {
  await kv.set(PROFILE_KEY, ProfileSchema.parse(profile));
}

export async function loadSettings(kv: KeyValueStore = chromeLocalStore): Promise<Settings> {
  const raw = await kv.get(SETTINGS_KEY);
  const parsed = SettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : SettingsSchema.parse({});
}

export async function saveSettings(settings: Settings, kv: KeyValueStore = chromeLocalStore) {
  await kv.set(SETTINGS_KEY, SettingsSchema.parse(settings));
}
