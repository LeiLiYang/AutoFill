/** Minimal key/value interface so stores can be tested without a browser. */
export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export const chromeLocalStore: KeyValueStore = {
  async get(key) {
    const res = await chrome.storage.local.get(key);
    return res[key];
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
};

export function memoryStore(): KeyValueStore {
  const data = new Map<string, unknown>();
  return {
    async get(key) {
      return data.get(key);
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
    },
  };
}
