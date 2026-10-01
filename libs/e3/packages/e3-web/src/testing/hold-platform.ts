/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The platform package e3-web's interrupted-run spec serves its unit workers:
 * `test_hold()`, which a unit calls to stay running until its page closes.
 *
 * A unit worker of a page that holds never returns from it: the call keeps
 * the worker's thread, as a long unit does, until the page closes and its
 * workers stop with it. A unit worker of any other page returns at once.
 * Portable: a page's unit worker bundles it, and the fixture package names
 * it in Node.
 *
 * @packageDocumentation
 */

import { East, NullType } from '@elaraai/east';
import type { PlatformFunction } from '@elaraai/east/internal';

/** The name a task lists the package under, as a runner's `{ custom }`
 *  platform. */
export const HOLD_PLATFORM = 'e3-web-hold';

/** `test_hold()`: returns at once, or, in a page that holds, never. A stream
 *  task's body is synchronous, so it is too. */
export const test_hold = East.platform('test_hold', [], NullType);

/**
 * The package, for a unit worker.
 *
 * @param held - Whether the unit worker's page holds: its units never return
 *   from `test_hold`
 * @returns The package's platform functions
 */
export function holdPlatform(held: boolean): PlatformFunction[] {
  return [
    test_hold.implement(() => {
      // The unit keeps its worker's thread, as a unit computing for long
      // does, until the page that started the worker closes.
      while (held) { /* held */ }
      return null;
    }),
  ];
}
