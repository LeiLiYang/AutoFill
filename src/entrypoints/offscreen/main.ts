import type { ToOffscreen } from '../../messaging/protocol';
import { base64ToBytes } from '../../util/base64';

// Offscreen documents can create blob URLs; the service worker cannot.
chrome.runtime.onMessage.addListener((msg: ToOffscreen, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;
  if (msg.type === 'make-blob-url') {
    const blob = new Blob([base64ToBytes(msg.base64) as BlobPart], { type: msg.mime });
    sendResponse({ url: URL.createObjectURL(blob) });
  } else if (msg.type === 'revoke-blob-url') {
    URL.revokeObjectURL(msg.url);
    sendResponse({ ok: true });
  }
});
