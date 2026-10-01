/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The unit protocol: the messages the e3 worker and a unit worker speak.
 *
 * The e3 worker starts each unit worker with `start`, handing it the port of
 * the services it serves units, and the worker answers `ready` once it serves
 * units, naming the Web Lock it holds while it lives, which the pool waits on
 * to learn it has stopped on its own. A unit is sent with `run`: the unit,
 * encoded, and every file it
 * names, their buffers transferred rather than copied. The worker answers a
 * run with what the unit's console writes, as it writes it (`log`), and then
 * `done` — the unit's result, encoded, and every file it wrote — or `broken`,
 * when it could not run the unit at all.
 *
 * A dedicated Web Worker speaks it through its global scope's `postMessage`,
 * and the in-process host through a `MessageChannel` (`in-process.ts`), so a
 * test in Node sends the messages a browser does, through the same
 * structured clone and the same transfers.
 *
 * @packageDocumentation
 */

/** A file a unit names, by its path, and its bytes. */
export type UnitFile = readonly [path: string, bytes: Uint8Array];

/** A message the e3 worker sends a unit worker. */
export type HostMessage =
  /** The first message a unit worker is sent: the port of the services its
   *  host serves units, or `null` for none. */
  | { readonly kind: 'start'; readonly port: MessagePort | null }
  /** Runs a unit: the `UnitType` value's beast2 bytes, and the files it names,
   *  relative to the unit. */
  | { readonly kind: 'run'; readonly id: number; readonly unit: Uint8Array; readonly files: readonly UnitFile[] };

/** A message a unit worker sends the e3 worker. */
export type WorkerMessage =
  /** The worker serves units: what it answers `start` with. `lifeline` is
   *  the Web Lock it holds while it lives — the browser frees it once the
   *  worker has stopped, however it stopped — or `null` when it holds none. */
  | { readonly kind: 'ready'; readonly lifeline: string | null }
  /** Text a running unit's console wrote, as it wrote it. */
  | { readonly kind: 'log'; readonly id: number; readonly stream: 'stdout' | 'stderr'; readonly text: string }
  /** A unit ran: its `UnitResultType` value's beast2 bytes, and every file it
   *  wrote, relative to the unit. */
  | { readonly kind: 'done'; readonly id: number; readonly result: Uint8Array; readonly files: readonly UnitFile[] }
  /** The worker could not run a unit at all, and says why. */
  | { readonly kind: 'broken'; readonly id: number; readonly message: string };

/**
 * A unit worker, as the pool drives it: what it needs of a dedicated Web
 * Worker, which the in-process host gives too.
 */
export interface UnitWorker {
  /**
   * Sends the worker a message.
   *
   * @param message - The message
   * @param transfer - The buffers it moves to the worker rather than copies:
   *   they are the worker's once sent
   */
  postMessage(message: HostMessage, transfer: Transferable[]): void;
  /** Hears each message the worker sends. */
  onmessage: ((event: MessageEvent) => void) | null;
  /** Hears the worker fail: a script that does not load, or an error nothing
   *  in the worker caught. */
  onerror: ((event: ErrorEvent) => void) | null;
  /** Ends the worker at once, whatever it is running. */
  terminate(): void;
}

/**
 * The buffers of a message's files that it moves rather than copies: each
 * buffer a file's bytes are the whole of, once.
 *
 * @remarks
 * Moving a buffer leaves the sender none of it, so only bytes the sender owns
 * whole are moved. Bytes that are part of a larger buffer — a slice of a pool,
 * say, whose other parts the sender's code still reads — are copied with the
 * message instead, as is a view of shared memory.
 *
 * @param files - The message's files
 * @returns The buffers to move
 */
export function transferOf(files: Iterable<UnitFile>): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const [, bytes] of files) {
    if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
      buffers.add(bytes.buffer);
    }
  }
  return [...buffers];
}
