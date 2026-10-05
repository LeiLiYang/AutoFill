import { SheetsError, type SheetsDeps } from './sheets';

/**
 * OAuth through chrome.identity (Chrome's built-in Google sign-in). The extension ID is pinned with
 * a manifest `key`, so the Cloud "Chrome Extension" OAuth client keeps matching it.
 */
export async function getAuthToken(interactive: boolean): Promise<string> {
  const clientId = chrome.runtime.getManifest().oauth2?.client_id ?? '';
  if (!clientId || clientId.startsWith('REPLACE_WITH')) {
    // Not retryable: queuing the row would just fail again until the build is fixed.
    throw new SheetsError('config', 'Google OAuth client ID is not set in this build. Follow "Google Cloud setup" in the README, then rebuild.');
  }
  let result: unknown;
  try {
    result = await chrome.identity.getAuthToken({ interactive });
  } catch (e) {
    throw new SheetsError('auth', (e as Error).message || 'Google sign-in failed');
  }
  // Newer Chrome resolves { token, grantedScopes }; older resolves the token string.
  const token = typeof result === 'string' ? result : (result as { token?: string } | undefined)?.token;
  if (!token) throw new SheetsError('auth', 'Google sign-in is required');
  return token;
}

export const chromeSheetsDeps: SheetsDeps = {
  getToken: getAuthToken,
  invalidateToken: (token) => chrome.identity.removeCachedAuthToken({ token }),
  fetch: (input, init) => fetch(input, init),
};
