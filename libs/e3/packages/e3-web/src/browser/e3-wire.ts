/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A request, and its response, as they cross between Node and a test page
 * running e3: what Node's forwarding fetch (`e3-forward.ts`) sends the page
 * (`e3.page.ts`), which answers it with its `e3.fetch`. A call to a page takes
 * and answers only what serializes, so a body crosses as base64 text.
 *
 * @packageDocumentation
 */

/** A request, as it crosses to the page. */
export interface WireRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: ReadonlyArray<readonly [string, string]>;
  /** Its body, as base64, or `null` for none */
  readonly body: string | null;
}

/** A response, as it crosses back. */
export interface WireResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: ReadonlyArray<readonly [string, string]>;
  /** Its body, as base64: empty for none */
  readonly body: string;
}

/** How many bytes are turned to characters at a time. */
const CHUNK = 0x8000;

/**
 * Bytes as base64 text.
 *
 * @param bytes - The bytes
 * @returns Their base64
 */
export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.length; at += CHUNK) text += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  return btoa(text);
}

/**
 * Base64 text as bytes.
 *
 * @param text - The base64
 * @returns The bytes
 */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
  return bytes;
}
