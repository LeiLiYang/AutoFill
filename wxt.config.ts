import { defineConfig } from 'wxt';

// Public key pins the extension ID so the Google OAuth client keeps working for the
// unpacked extension. Generate yours per README ("Pinned extension ID") and put it in .env.local.
const key = process.env.WXT_EXTENSION_KEY;
const clientId = process.env.WXT_OAUTH_CLIENT_ID ?? 'REPLACE_WITH_OAUTH_CLIENT_ID.apps.googleusercontent.com';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: ({ mode }) => ({
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
    ],
    host_permissions: [
      '*://*.greenhouse.io/*',
      '*://jobs.lever.co/*',
      '*://jobs.ashbyhq.com/*',
      '*://*.myworkdayjobs.com/*',
      '*://www.linkedin.com/*',
      'https://sheets.googleapis.com/*',
      'https://api.anthropic.com/*',
      // Test build only: Playwright serves fixtures from localhost.
      ...(mode === 'test' ? ['http://localhost/*', 'http://127.0.0.1/*'] : []),
    ],
    oauth2: {
      client_id: clientId,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    },
    commands: {
      'fill-page': {
        suggested_key: { default: 'Alt+Shift+F' },
        description: 'Autofill the current job application',
      },
    },
    // No content_scripts on purpose: nothing runs on any page until the user triggers it.
  }),
});
