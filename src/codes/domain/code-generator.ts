import { randomBytes, randomInt } from 'node:crypto';

/** Bytes de entropía del token opaco que va dentro del QR (≥ 32 → 256 bits). */
const TOKEN_BYTES = 32;

/**
 * Alfabeto base32 legible para el código corto, **sin caracteres ambiguos**
 * (sin `0/O`, `1/I/L`). Sirve para tecleo manual cuando falla la cámara (CLAUDE.md §6).
 */
const SHORT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SHORT_CODE_GROUP = 4;

/**
 * Genera el **token opaco** del código de retiro: aleatorio de alta entropía en base64url.
 * No es un JWT; el estado vive en DB porque el código es de un solo uso e invalidable.
 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Genera el **código corto** legible con formato `XXXX-XXXX` (ej. `A7K9-P2MX`).
 * Usa `randomInt` para una distribución uniforme sobre el alfabeto no ambiguo.
 */
export function generateShortCode(): string {
  const left = randomGroup();
  const right = randomGroup();
  return `${left}-${right}`;
}

/**
 * Normaliza un código corto tecleado por el usuario: mayúsculas y guion en su lugar.
 * Acepta con o sin guion (`a7k9p2mx` o `A7K9-P2MX`) y devuelve `XXXX-XXXX`.
 */
export function normalizeShortCode(input: string): string {
  const clean = input.trim().toUpperCase().replace(/-/g, '');
  if (clean.length !== SHORT_CODE_GROUP * 2) {
    return input.trim().toUpperCase();
  }
  return `${clean.slice(0, SHORT_CODE_GROUP)}-${clean.slice(SHORT_CODE_GROUP)}`;
}

/** ¿El texto tiene forma de código corto (`XXXX-XXXX` con el alfabeto válido)? */
export function looksLikeShortCode(input: string): boolean {
  return /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(normalizeShortCode(input));
}

function randomGroup(): string {
  let group = '';
  for (let i = 0; i < SHORT_CODE_GROUP; i++) {
    group += SHORT_CODE_ALPHABET[randomInt(SHORT_CODE_ALPHABET.length)];
  }
  return group;
}
