// Generates the key that pins this extension's ID, so the Google OAuth client keeps matching it.
//   node scripts/gen-extension-key.mjs
// Writes the PRIVATE key to private/extension-key.pem (gitignored) and prints the PUBLIC key
// (safe to commit: every packed extension ships it in its manifest) and the resulting ID.
import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pemPath = resolve(root, 'private', 'extension-key.pem');

if (existsSync(pemPath) && !process.argv.includes('--force')) {
  console.error(`${pemPath} already exists. Re-generating changes the extension ID and breaks the OAuth client.\nPass --force to overwrite.`);
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const der = publicKey.export({ type: 'spki', format: 'der' });
const id = [...createHash('sha256').update(der).digest().subarray(0, 16)]
  .map((b) => 'abcdefghijklmnop'[b >> 4] + 'abcdefghijklmnop'[b & 15])
  .join('');

mkdirSync(dirname(pemPath), { recursive: true });
writeFileSync(pemPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));

console.log(`Extension ID: ${id}`);
console.log(`Public key (manifest "key"):\n${der.toString('base64')}`);
console.log(`\nPrivate key saved to ${pemPath} (gitignored: never commit it).`);
