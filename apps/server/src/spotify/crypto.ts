import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/** AES-256-GCM with a key derived from SERVER_SECRET; used for refresh tokens. */
export function encryptSecret(serverSecret: string, plaintext: string): string {
  const key = scryptSync(serverSecret, 'baes-spotify', 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}

export function decryptSecret(serverSecret: string, stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('malformed encrypted secret');
  const key = scryptSync(serverSecret, 'baes-spotify', 32);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
