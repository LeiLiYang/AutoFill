import { SheetsError, type SheetsDeps } from './sheets';

/**
 * OAuth through chrome.identity (Chrome's built-in Google sign-in). The extension ID is pinned with
 * a manifest `key`, so the Cloud "Chrome Extension" OAuth client keeps matching it.
 */
export async function getAuthToken(interactive: boolean): Promise<string> {
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
