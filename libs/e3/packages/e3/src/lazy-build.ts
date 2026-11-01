/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The SDK's own East functions, each built the first time it is read (#1466).
 *
 * The record modules hold the East functions their indexes' and writes'
 * programs call. Built at import, they cost every process that imports
 * `@elaraai/e3` — every CLI run, every server start, every spec — some sixty
 * builds and the TypeScript compiler, which the first build in a process
 * loads, whether the process reads a record or not. Each module keeps them as
 * the getters of one object instead, which {@link lazyBuilds} has build its
 * function the first time it is read, as East builds its own libraries
 * (#1127).
 *
 * @packageDocumentation
 */
import { SourceMap, with_source_map, withLocationCapture } from '@elaraai/east';

/**
 * Makes each getter of an object build its value the first time it is read,
 * and keep it.
 *
 * @remarks
 * A value is built with no location captured, under a source map of its own:
 * as an installed SDK built it at import, whose frames East never captures,
 * since they sit under `node_modules`, while no other function was being
 * built. So a program holds the bytes it held then, whoever reads one of
 * these first — never the reader's frames, and, in this repository, never
 * the SDK's own.
 *
 * A property that is no getter stays as it is.
 *
 * @typeParam L - The object, its values as getters
 * @param library - The object, each of whose getters builds one value
 * @returns The object, each getter now building its value once, the first
 *   time it is read, after which the value is a property of its own
 */
export function lazyBuilds<L extends object>(library: L): L {
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(library))) {
    const build = descriptor.get;
    if (build === undefined) continue;
    Object.defineProperty(library, name, {
      enumerable: descriptor.enumerable ?? true,
      configurable: true,
      get: () => {
        const built: unknown = with_source_map(new SourceMap(), () => withLocationCapture(false, () => build.call(library)));
        Object.defineProperty(library, name, { value: built, enumerable: descriptor.enumerable ?? true, writable: false, configurable: false });
        return built;
      },
    });
  }
  return library;
}
