/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { chmod, unlink } from 'node:fs/promises';
import { request, Server, type IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createAdaptorServer } from '@hono/node-server';
import { decodeBeast2For, encodeBeast2For, printFor, type EastType, type ValueTypeOf } from '@elaraai/east';
import { BEAST2_CONTENT_TYPE, ErrorType, ResponseType } from '@elaraai/e3-types';
import type { Hono } from 'hono';

/** Reports a control/data transport error without losing its machine-readable cause. */
export class RackHubError extends Error {
  /** @param code - HTTP, protocol or system error code @param message - Actionable explanation */
  constructor(readonly code: string, message: string) { super(message); this.name = 'RackHubError'; }
}

/** Options shared by typed requests and streamed object transfers. */
export interface SocketRequestOptions {
  /** Private session credential. */
  bearer?: string;
  /** Whole-request deadline, including response streaming; defaults to 30 seconds. */
  timeoutMs?: number;
  /** Cancels connection, upload and response. */
  signal?: AbortSignal;
  /** Raw object bytes; never encoded in a BEAST2 envelope. */
  rawBody?: Uint8Array | Readable;
  /** Additional HTTP headers for streamed objects. */
  headers?: Record<string, string>;
}

/**
 * Starts an HTTP listener on a private Unix socket or Windows named pipe.
 * The caller must hold ownership before removing any stale socket.
 * @param app - Local HTTP application
 * @param path - Socket or pipe
 * @returns The listening server
 * @example
 * const server = await serveOnSocket(app, socketPath);
 */
export async function serveOnSocket(app: Hono, path: string): Promise<Server> {
  const server = createAdaptorServer({ fetch: app.fetch });
  if (!(server instanceof Server)) throw new Error('Local rack transport requires HTTP/1');
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(path, () => { server.off('error', reject); resolve(); });
    });
    if (process.platform !== 'win32') await chmod(path, 0o600);
    return server;
  } catch (err) {
    server.close();
    throw err;
  }
}

/**
 * Closes a listener, allowing up to five seconds for active requests.
 * @param server - Owned listener
 * @param socket - Owned socket to remove after closing
 * @returns Completion of shutdown
 */
export async function closeSocketServer(server: Server, socket?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => server.closeAllConnections(), 5000);
    timer.unref();
    server.close((error) => { clearTimeout(timer); if (error) reject(error); else resolve(); });
  });
  if (socket !== undefined && process.platform !== 'win32') {
    await unlink(socket).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; });
  }
}

/**
 * Streams a local HTTP response with an absolute, abortable deadline.
 * @param socketPath - Unix socket or Windows pipe
 * @param method - HTTP verb
 * @param path - Request path
 * @param options - Credentials, input stream and deadline
 * @returns The raw response; callers consume or destroy it
 * @throws {RackHubError} On timeout or connection failure
 */
export function socketStream(socketPath: string, method: string, path: string, options: SocketRequestOptions = {}): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const headers = { ...options.headers, ...(options.bearer === undefined ? {} : { authorization: `Bearer ${options.bearer}` }) };
    const req = request({ socketPath, method, path, headers });
    const fail = (err: Error) => { req.destroy(err); if (options.rawBody instanceof Readable) options.rawBody.destroy(err); };
    const timer = setTimeout(() => fail(new RackHubError('timeout', `Rack request ${method} ${path} timed out`)), options.timeoutMs ?? 30_000);
    timer.unref();
    const abort = () => fail(new RackHubError('aborted', `Rack request ${method} ${path} was aborted`));
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); };
    req.once('error', (err: NodeJS.ErrnoException) => { cleanup(); reject(err instanceof RackHubError ? err : new RackHubError(err.code ?? 'transport', err.message)); });
    req.once('response', (response) => {
      response.once('close', cleanup);
      response.once('error', () => {}); // a destroyed response remains observable by its consumer
      resolve(response);
    });
    // Observe source errors before an already-aborted signal can destroy it.
    // Without the pipeline, destroy(error) emits an unhandled stream error.
    if (options.rawBody instanceof Readable) void pipeline(options.rawBody, req).catch(fail);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) { abort(); return; }
    if (!(options.rawBody instanceof Readable)) req.end(options.rawBody);
  });
}

/**
 * Sends a BEAST2 control message and decodes its standard response envelope.
 * @param socketPath - Unix socket or Windows pipe
 * @param method - HTTP verb
 * @param path - Control route
 * @param options - Request/response schemas, value and transport settings
 * @returns The decoded success value
 * @throws {RackHubError} On an error envelope, HTTP error or deadline
 * @example
 * const hello = await socketRequest(socket, 'POST', '/v1/hello', { responseType: HubHelloType });
 */
export async function socketRequest<Req extends EastType, Res extends EastType>(
  socketPath: string, method: string, path: string,
  options: SocketRequestOptions & { requestType?: Req; body?: ValueTypeOf<Req>; responseType: Res },
): Promise<ValueTypeOf<Res>> {
  const rawBody = options.requestType === undefined ? options.rawBody : encodeBeast2For(options.requestType)(options.body!);
  const response = await socketStream(socketPath, method, path, { ...options, rawBody,
    headers: { ...options.headers, 'content-type': BEAST2_CONTENT_TYPE } });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > 16 * 1024 * 1024) { response.destroy(); throw new RackHubError('too_large', 'Rack control response exceeds 16 MiB'); }
    chunks.push(bytes);
  }
  if ((response.statusCode ?? 500) >= 300) throw new RackHubError(`http_${response.statusCode}`, `Rack request ${path}: HTTP ${response.statusCode}`);
  const envelope = decodeBeast2For(ResponseType(options.responseType))(Buffer.concat(chunks));
  if (envelope.type === 'error') throw new RackHubError(envelope.value.type, printFor(ErrorType)(envelope.value));
  return envelope.value;
}
