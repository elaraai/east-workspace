/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */
import type { MiddlewareHandler } from 'hono';

/**
 * Bound control messages before BEAST2 decoding, counting streamed bytes
 * even when Content-Length lies. Object transfers use separate routes.
 * @param maxBytes - Maximum encoded body size
 * @param timeoutMs - Maximum time to receive the body
 * @returns Middleware answering 413 on excess and 408 on timeout
 * @example
 * app.use('/api/rack/enroll', rackBodyLimit(64 * 1024));
 */
export function rackBodyLimit(maxBytes: number, timeoutMs = 15_000): MiddlewareHandler {
  return async (c, next) => {
    const body = c.req.raw.body;
    if (body === null) { await next(); return; }
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Rack body timeout')), timeoutMs);
    });
    try {
      for (;;) {
        const chunk = await Promise.race([reader.read(), timeout]);
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) return c.text('Rack request body too large', 413);
        chunks.push(chunk.value);
      }
      const data = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
      c.req.raw = new Request(c.req.raw, { body: data });
    } catch (error) {
      return c.text('Rack request body could not be received', error instanceof Error && error.message === 'Rack body timeout' ? 408 : 400);
    } finally {
      clearTimeout(timer);
      void reader.cancel().catch(() => { /* a disconnected peer needs no answer */ });
      reader.releaseLock();
    }
    await next();
  };
}
