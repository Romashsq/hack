// No 0/O/1/I/L to keep codes readable when typed from a projector.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function randomCode(len = 6): string {
  let s = "";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export function cleanName(raw: unknown): string {
  return String(raw ?? "").replace(/[\[\]\n\r]/g, "").trim().slice(0, 30);
}
