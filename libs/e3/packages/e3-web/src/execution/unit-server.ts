/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A unit worker's side of the unit protocol: it runs each unit it is sent with
 * east's `executeUnit` over the unit's files in memory, as east-node's `exec`
 * runs one over a directory.
 *
 * The platform functions a unit lists are resolved by package name, from the
 * packages its worker serves: east-node-std's name is answered by
 * east-web-std's platform, whose console writes to the unit's logs as it
 * writes, and an app adds its own packages. A package the worker does not
 * serve fails the unit, naming the package; a platform function a package
 * does not provide fails it at compile, naming the function, as east's
 * compile names it. A failed unit's message and locations are written to its
 * stderr, as east-node's `exec` writes them.
 *
 * `serveUnits` (`../units.ts`) serves this in a dedicated Web Worker, and the
 * in-process host (`in-process.ts`) over a `MessageChannel` in the e3
 * worker's own thread.
 *
 * @packageDocumentation
 */

import {
  InMemoryUnitIO,
  UnitResultType,
  UnitType,
  decodeBeast2For,
  encodeBeast2For,
  executeUnit,
  type Unit,
} from '@elaraai/east';
import type { PlatformFunction } from '@elaraai/east/internal';
import { createWebPlatform, type ConsoleSink } from '@elaraai/east-web-std';
import { transferOf, type HostMessage, type UnitFile, type WorkerMessage } from './protocol.js';

/**
 * What a unit's platform package is given when it is resolved for a unit: its
 * console, and the port of the services the unit's host serves.
 */
export interface UnitPlatformContext {
  /** Where the unit's console output goes: the execution's logs, as it is
   *  written. */
  readonly console: ConsoleSink;
  /**
   * The port the e3 worker handed this unit worker as it started it, or
   * `null` when it handed none: what a package that reaches back to its host
   * — e3's own platform functions, bound to a fetch into the e3 worker — talks
   * to it through.
   */
  readonly port: MessagePort | null;
}

/**
 * A platform package a unit worker serves: its platform functions, or what
 * makes them for each unit from the unit's context.
 */
export type UnitPlatformPackage =
  | readonly PlatformFunction[]
  | ((context: UnitPlatformContext) => readonly PlatformFunction[] | Promise<readonly PlatformFunction[]>);

/** The platform packages a unit worker serves, by the name a runner lists
 *  each under in a unit. */
export type UnitPlatforms = Readonly<Record<string, UnitPlatformPackage>>;

/** The name a runner lists east-node-std's platform functions under. */
export const EAST_NODE_STD = '@elaraai/east-node-std';

/**
 * The packages every unit worker serves: east-node-std's name, answered by
 * east-web-std's platform, so a task written for east-node runs unchanged in
 * a browser. Its console writes to the unit's logs, and each unit has a Random
 * generator of its own.
 */
export const STANDARD_PLATFORMS: UnitPlatforms = {
  [EAST_NODE_STD]: (context) => createWebPlatform({ console: context.console }),
};

/** Where a unit server's messages go: a worker's global scope, or a port. */
export interface UnitEndpoint {
  /**
   * Sends the host a message.
   *
   * @param message - The message
   * @param transfer - The buffers it moves rather than copies
   */
  postMessage(message: WorkerMessage, transfer: Transferable[]): void;
}

/**
 * Wraps a unit's platform functions as a host that cannot end a unit's
 * thread stops them: see {@link UnitServerOptions.guard}.
 */
export type PlatformGuard = (functions: readonly PlatformFunction[]) => readonly PlatformFunction[];

/** How a {@link UnitServer} runs units. */
export interface UnitServerOptions {
  /** The platform packages it serves, by name */
  readonly platforms: UnitPlatforms;
  /**
   * Wraps each package's platform functions before a unit is compiled with
   * them: the in-process host's, which shares the e3 worker's thread and so
   * cannot terminate it, stops a unit at its next platform call this way.
   */
  readonly guard?: PlatformGuard;
}

/** An error's message. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Runs the units its host sends, one at a time as the host sends them, and
 * answers each with its result and the files it wrote.
 */
export class UnitServer {
  /** The port the host handed at start, for the platform packages that reach
   *  back to it */
  private port: MessagePort | null = null;

  /**
   * @param endpoint - Where its messages go
   * @param options - The packages it serves, and the guard of a host that
   *   cannot end its thread
   */
  constructor(private readonly endpoint: UnitEndpoint, private readonly options: UnitServerOptions) {}

  /**
   * Handles a message from the host: `start` is answered `ready`, and a unit
   * is run and answered with its result.
   *
   * @param message - The message
   */
  async receive(message: HostMessage): Promise<void> {
    if (message.kind === 'start') {
      this.port = message.port;
      this.endpoint.postMessage({ kind: 'ready' }, []);
      return;
    }
    try {
      await this.run(message.id, message.unit, message.files);
    } catch (err) {
      this.endpoint.postMessage({ kind: 'broken', id: message.id, message: messageOf(err) }, []);
    }
  }

  /**
   * Runs a unit over its files, and answers with its result and the files it
   * wrote.
   *
   * @throws {Error} When the unit does not decode, or its answer cannot be
   *   sent: the unit was never run, or its result is lost.
   */
  private async run(id: number, encoded: Uint8Array, files: readonly UnitFile[]): Promise<void> {
    let unit: Unit;
    try {
      unit = decodeBeast2For(UnitType)(encoded);
    } catch (err) {
      throw new Error(`the unit does not decode: ${messageOf(err)}`);
    }
    const io = new InMemoryUnitIO(files);
    // What the unit was given, by the paths the IO holds it under: what it
    // wrote is everything else.
    const given = new Set(io.files.keys());
    const write = (stream: 'stdout' | 'stderr') => (text: string): void => {
      this.endpoint.postMessage({ kind: 'log', id, stream, text }, []);
    };
    const context: UnitPlatformContext = { console: { stdout: write('stdout'), stderr: write('stderr') }, port: this.port };
    const result = await executeUnit(unit, io, { platforms: (name) => this.platforms(name, context) });
    if (result.outcome.type === 'failed') {
      // A failed unit's message and its source locations, written to its
      // stderr as east-node's `exec` writes them.
      const { message, locations } = result.outcome.value;
      context.console.stderr(`${['Error: ' + message, ...locations.map((l) => `  at ${l.filename}:${l.line}:${l.column}`)].join('\n')}\n`);
    }
    const written: UnitFile[] = [...io.files].filter(([path]) => !given.has(path));
    this.endpoint.postMessage({ kind: 'done', id, result: encodeBeast2For(UnitResultType)(result), files: written }, transferOf(written));
  }

  /**
   * The platform functions of a package the unit lists.
   *
   * @throws {Error} When the worker serves no package of that name: the unit
   *   fails, naming it.
   */
  private async platforms(name: string, context: UnitPlatformContext): Promise<readonly PlatformFunction[]> {
    const served = this.options.platforms;
    if (!Object.hasOwn(served, name)) {
      throw new Error(`the platform package ${name} is not served to units in this browser: serveUnits({ platforms }) adds an app's own`);
    }
    const entry = served[name]!;
    const functions = typeof entry === 'function' ? await entry(context) : entry;
    return this.options.guard === undefined ? functions : this.options.guard(functions);
  }
}
