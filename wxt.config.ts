import { loadEnv } from 'vite';
import { defineConfig } from 'wxt';

// The public key pins the extension ID (cihdjaikbfmejnlkcmncpggnjledlpoc) so the Google OAuth
// client keeps working for the unpacked extension. A public key is not a secret: every packed
// extension ships it in its manifest. The matching private key lives in the gitignored private/
// folder (see scripts/gen-extension-key.mjs). Override with WXT_EXTENSION_KEY to use your own.
const PINNED_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAt+OB0FyRiJvgqfZCAJXhLmO2vTa8i7gYG2yZxPCY4/J1uBCipBYSEh+0Bvzhi7LBQGgplNqS2mlrUkpmQ+stqCDK7CQ4bzxqQ92tUaoVP1eJZ6b9qwNJHu5fVt/yFnJeHz6UVwgGpUgWEOyLofSHsXhA68C9Am4i6y9bphoDavzZY59HOIjzyl6M5Fga/LNtWoHTY67ydVrj7wrlj5ERdSO9Tux+GjB5r32CMlCRIpqpAPgZkjm5P/7oUeAhddSGCelmug/RpsvY9BZX2Ocv91NRVOMRNB+3Qu8b5MNc+NifDHqje+16rwfVsNVogyqCWS4hPgOlUy7HCN/hNVj29QIDAQAB';
// WXT does not put .env files into process.env while it evaluates this config, so read them
// explicitly (.env, .env.local, .env.<mode>); a real environment variable still wins.
const env = {
  ...loadEnv(process.env.NODE_ENV === 'test' ? 'test' : 'production', process.cwd(), 'WXT_'),
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('WXT_'))),
} as Record<string, string | undefined>;
const key = env.WXT_EXTENSION_KEY || PINNED_PUBLIC_KEY;
const clientId = env.WXT_OAUTH_CLIENT_ID?.trim() || 'REPLACE_WITH_OAUTH_CLIENT_ID.apps.googleusercontent.com';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: () => ({
    name: 'Job Application Autofill',
    description: 'Fills job application forms from your local profile. Never submits anything.',
    ...(key ? { key } : {}),
    permissions: [
      'storage',
      'unlimitedStorage',
      'activeTab',
      'scripting',
      'identity',
      'downloads',
      'pageCapture',
      'alarms',
      'offscreen',
      'contextMenus',
    ],
    // Every site: application forms are often embedded in an iframe from another domain (an ATS the
    // company's careers page loads), and a frame can only be filled with access to its origin. This
    // also covers the Google Sheets and LLM API calls. It does not change when the extension runs.
    host_permissions: ['<all_urls>'],
    oauth2: {
      client_id: clientId,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    },
    commands: {
      'fill-page': {
        suggested_key: { default: 'Alt+Shift+F' },
        description: 'Autofill the current job application',
      },
      'log-posting': {
        suggested_key: { default: 'Alt+Shift+L' },
        description: 'Log this job posting to your sheet (no autofill)',
      },
    },
    // No content_scripts on purpose: nothing runs on any page until the user triggers it.
  }),
});
