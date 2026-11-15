import argon2 from 'argon2';

// OWASP-recommended minimum for Argon2id, light enough for small cloud instances.
const options = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> => argon2.hash(password, options);

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: string | undefined;
/** Burns the same time as a real check so "no such user" is not distinguishable by speed. */
export async function dummyVerify(password: string): Promise<void> {
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(dummyHash, password);
}
