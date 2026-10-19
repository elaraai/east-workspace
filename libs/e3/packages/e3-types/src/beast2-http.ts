/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The BEAST2 envelopes of e3's HTTP APIs over the standard `Request` and
 * `Response`, which every host has: a Hono route, a Lambda handler, a page's
 * worker. A request's body is BEAST2 and says so in its `Content-Type`; an
 * answer is the {@link ResponseType} envelope, `success` or `error`, with the
 * same content type.
 */

import { decodeBeast2For, encodeBeast2For, variant, type EastType, type ValueTypeOf } from '@elaraai/east';
import { ErrorType, ResponseType } from './api.js';
import { BEAST2_CONTENT_TYPE } from './constants.js';

/**
 * Decodes a request's BEAST2 body as a value of a type.
 *
 * @param request - The request, whose `Content-Type` must be BEAST2's
 * @param type - The type of the body's value
 * @returns The decoded value
 *
 * @throws {Error} When the content type is another, or the body does not decode
 *
 * @example
 * ```ts
 * const body = await decodeBeast2Request(c.req.raw, WorkspaceCreateRequestType);
 * ```
 */
export async function decodeBeast2Request<T extends EastType>(request: Request, type: T): Promise<ValueTypeOf<T>> {
  const contentType = request.headers.get('content-type');
  if (contentType !== BEAST2_CONTENT_TYPE) {
    throw new Error(`Expected Content-Type: ${BEAST2_CONTENT_TYPE}, got ${contentType ?? 'none'}`);
  }
  return decodeBeast2For(type)(new Uint8Array(await request.arrayBuffer()));
}

/** What an answer carries beside its envelope. */
export interface Beast2AnswerOptions {
  /** The HTTP status: 200 unless given */
  status?: number;
  /** Headers beside the body's, such as the `ETag` a conditional route names its answer by */
  headers?: Record<string, string>;
}

/**
 * Answers a success envelope: the value, under `success`, as BEAST2.
 *
 * @param type - The type of the answer's value
 * @param value - The answer's value
 * @param options - The status and the headers beside the body's
 * @returns The response
 *
 * @example
 * ```ts
 * return beast2Success(WorkspaceInfoType, info, { headers: { ETag: tag } });
 * ```
 */
export function beast2Success<T extends EastType>(type: T, value: ValueTypeOf<T>, options: Beast2AnswerOptions = {}): Response {
  const responseType = ResponseType(type);
  return answer(encodeBeast2For(responseType)(variant('success', value) as ValueTypeOf<typeof responseType>), options);
}

/**
 * Answers an error envelope: the error, under `error`, as BEAST2, with
 * status 200 unless given: the envelope says what went wrong.
 *
 * @param type - The type the answer's value would have had
 * @param error - What went wrong
 * @param options - The status and the headers beside the body's
 * @returns The response
 *
 * @example
 * ```ts
 * return beast2Error(WorkspaceInfoType, variant('workspace_not_found', { workspace }));
 * ```
 */
export function beast2Error<T extends EastType>(type: T, error: ValueTypeOf<typeof ErrorType>, options: Beast2AnswerOptions = {}): Response {
  const responseType = ResponseType(type);
  return answer(encodeBeast2For(responseType)(variant('error', error) as ValueTypeOf<typeof responseType>), options);
}

function answer(body: Uint8Array, options: Beast2AnswerOptions): Response {
  return new Response(body, {
    status: options.status ?? 200,
    headers: { 'Content-Type': BEAST2_CONTENT_TYPE, 'Content-Length': String(body.byteLength), ...options.headers },
  });
}
