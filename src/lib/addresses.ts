// Address generation: cryptographically secure random local-parts.
import { randomBytes } from "crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Generate a random local-part like "k7qx2m9zv4pw" (12 chars, [a-z0-9]). */
export function generateLocalPart(length = 12): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  // Local-parts must not start with a digit-only ambiguity; ensure a letter first.
  if (/^[0-9]/.test(out)) {
    out = ALPHABET[randomBytes(1)[0] % 26] + out.slice(1);
  }
  return out;
}

export function normalizeAddress(localPart: string, domain: string): string {
  return `${localPart.trim().toLowerCase()}@${domain.trim().toLowerCase()}`;
}

export function isValidLocalPart(localPart: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(localPart);
}
