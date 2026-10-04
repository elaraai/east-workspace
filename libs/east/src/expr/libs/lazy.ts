/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Standard libraries whose functions are built on first use (#1127).
 *
 * Importing East used to build every function of its integer, float and
 * datetime libraries — tracing each body, checking its types and reading its
 * parameters' names, which loads the TypeScript compiler — whether or not the
 * process used one. A library is written as an object whose functions are
 * getters, and {@link lazyLibrary} has each build its function the first time
 * it is read.
 */

import { SourceMap, with_source_map, withLocationCapture } from "../../location.js";

/**
 * Makes each getter of a library build its function the first time it is
 * read, as an import of East used to build it, and keep it.
 *
 * @remarks
 * A function is built with no location captured and under a source map of
 * its own, as it was built at import: every frame of a library's body is
 * East's own, which a captured location leaves out, and no other function is
 * being built while a module is imported. Built inside a reader's function
 * otherwise, it would take the reader's frames for its own, and the names its
 * `$.let`s bind from the reader's line. So the IR a program gets from a
 * library function is the IR it got when East built them all at import.
 *
 * A property that is no getter — a builder the library re-exports — stays as
 * it is.
 *
 * @typeParam L - The library: its functions as getters
 * @param library - The library, each of whose getters builds one function
 * @returns The library, each getter now building its function once, the first
 *   time it is read, after which the function is a property of its own
 * @internal
 */
export function lazyLibrary<L extends object>(library: L): L {
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
