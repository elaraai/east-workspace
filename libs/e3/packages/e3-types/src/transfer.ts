/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Dataset transfer types for the staged upload protocol.
 *
 * Used by both the API server and client for large dataset uploads
 * that exceed inline body size limits.
 *
 * Two protocol versions share these types. A client names the version it speaks
 * with `?protocol=N` on the init and commit requests (a request without it is
 * version 1), and a server answers only in the forms that version understands —
 * every case version 2 adds sorts after the version-1 cases, so the tags a
 * version-1 client decodes keep their numbers.
 */

import { VariantType, StructType, StringType, IntegerType, NullType, DictType, type ValueTypeOf } from '@elaraai/east';

/**
 * The dataset transfer protocol version this build speaks.
 *
 * @remarks
 * Version 2 lets the server plan an upload as parts — each sent to its own URL
 * with the request headers the server names, so an object store can bind a
 * checksum to a single PUT or take a multipart upload larger than one PUT
 * allows — and lets a commit answer `processing` while the server verifies the
 * bytes, for the client to poll.
 */
export const TRANSFER_PROTOCOL_VERSION = 2;

/**
 * How many parts an upload of `size` bytes has when planned with `partBytes`.
 *
 * @param size - The upload's size in bytes
 * @param partBytes - The size of every part but the last
 * @returns The part count — at least 1
 */
export function transferPartCount(size: number | bigint, partBytes: number | bigint): number {
  const total = BigInt(size);
  const each = BigInt(partBytes);
  return total <= each ? 1 : Number((total + each - 1n) / each);
}

/**
 * The byte range part `part` of an upload covers.
 *
 * @param size - The upload's size in bytes
 * @param partBytes - The size of every part but the last
 * @param part - The part's number, from 1
 * @returns The half-open range `[start, end)`, or `null` when the upload has no
 *   such part
 */
export function transferPartRange(
  size: number | bigint,
  partBytes: number | bigint,
  part: number
): { start: number; end: number } | null {
  if (!Number.isInteger(part) || part < 1 || part > transferPartCount(size, partBytes)) return null;
  const start = BigInt(part - 1) * BigInt(partBytes);
  const end = start + BigInt(partBytes) < BigInt(size) ? start + BigInt(partBytes) : BigInt(size);
  return { start: Number(start), end: Number(end) };
}

/**
 * Transfer upload init request.
 *
 * Workspace and dataset path are now encoded in the URL.
 *
 * @property hash - SHA-256 hex hash of the data (computed by client)
 * @property size - Size of the data in bytes
 */
export const TransferUploadRequestType = StructType({
  hash: StringType,
  size: IntegerType,
});
export type TransferUploadRequest = ValueTypeOf<typeof TransferUploadRequestType>;

/**
 * Transfer upload init response.
 *
 * - `completed`: Object already exists (dedup), dataset ref updated
 * - `upload`: Staging slot created; the client PUTs every byte to `uploadUrl`,
 *   then commits
 * - `upload_parts` (protocol 2): the client sends the bytes as parts of
 *   `partBytes` bytes each (the last part holds the remainder, and an upload no
 *   larger than `partBytes` is one part). Part `n` (1-based) is the byte range
 *   `[(n - 1) * partBytes, min(size, n * partBytes))`; its URL and required
 *   headers come from `GET …/upload/<id>/parts/<n>`. Parts may be sent in any
 *   order and concurrently, and re-sending a part replaces it. The client
 *   commits once every part is sent.
 */
export const TransferUploadResponseType = VariantType({
  completed: NullType,
  upload: StructType({
    id: StringType,
    uploadUrl: StringType,
  }),
  upload_parts: StructType({
    id: StringType,
    partBytes: IntegerType,
  }),
});
export type TransferUploadResponse = ValueTypeOf<typeof TransferUploadResponseType>;

/**
 * Where and how to send one part of a protocol-2 upload.
 *
 * @property url - The URL the client PUTs the part's bytes to, without an
 *   `Authorization` header (it may be a presigned object-store URL)
 * @property headers - Request headers the PUT must carry exactly as given — a
 *   presigned URL can sign them, e.g. the checksum an object store verifies the
 *   bytes against
 */
export const TransferPartResponseType = StructType({
  url: StringType,
  headers: DictType(StringType, StringType),
});
export type TransferPartResponse = ValueTypeOf<typeof TransferPartResponseType>;

/**
 * Transfer done response — the commit's answer, and the poll's.
 *
 * - `completed`: Hash verified, object stored, dataset ref updated
 * - `error`: Hash mismatch or other failure
 * - `processing` (protocol 2): the server is still verifying the bytes; poll
 *   `GET …/upload/<id>` until it answers `completed` or `error`
 */
export const TransferDoneResponseType = VariantType({
  completed: NullType,
  error: StructType({
    message: StringType,
  }),
  processing: NullType,
});
export type TransferDoneResponse = ValueTypeOf<typeof TransferDoneResponseType>;
