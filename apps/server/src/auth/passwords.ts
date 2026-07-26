import { hash, verify } from '@node-rs/argon2';

// OWASP-recommended Argon2id parameters (m=19456 KiB, t=2, p=1).
const ARGON2_OPTS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTS);
}

export async function verifyPassword(pwHash: string, password: string): Promise<boolean> {
  try {
    return await verify(pwHash, password);
  } catch {
    return false;
  }
}
