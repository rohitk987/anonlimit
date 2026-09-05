// Browser-safe primitives for the simulation. These are not anonymous-credential proofs.
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function fromHex(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})+$/.test(value)) throw new Error("PRESENTATION_REJECTED");
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
}

export async function sha256Hex(value: string): Promise<string> {
  return hex(
    new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value)))
  );
}

export async function hmacSha256Hex(key: string, value: string): Promise<string> {
  const imported = await globalThis.crypto.subtle.importKey(
    "raw",
    fromHex(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return hex(
    new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", imported, encoder.encode(value)))
  );
}

export async function verifyMac(key: string, value: string, signature: string): Promise<boolean> {
  const imported = await globalThis.crypto.subtle.importKey(
    "raw",
    fromHex(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  return globalThis.crypto.subtle.verify(
    "HMAC",
    imported,
    fromHex(signature),
    encoder.encode(value)
  );
}

export function encodeBytes(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function decodeBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("PRESENTATION_REJECTED");
  const bytes = Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) =>
    char.charCodeAt(0)
  );
  if (encodeBytes(bytes) !== value) throw new Error("PRESENTATION_REJECTED");
  return bytes;
}

export function encodeOpaque(value: unknown): string {
  return encodeBytes(encoder.encode(JSON.stringify(value)));
}

export function decodeOpaque(value: string, maxLength: number): unknown {
  if (typeof value !== "string" || value.length > maxLength)
    throw new Error("PRESENTATION_REJECTED");
  return JSON.parse(decoder.decode(decodeBytes(value))) as unknown;
}

export function secureRandomBytes(length: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}
