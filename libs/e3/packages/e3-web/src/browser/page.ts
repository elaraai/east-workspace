/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The page side of the Chromium harness: what a test page gives the Node
 * side to call.
 *
 * A test page's entry serves its functions with {@link servePage}; the Node
 * side's `HarnessPage.call` calls one by name, with arguments and an answer
 * that serialize (strings, numbers, booleans, `null`, arrays and plain
 * objects). What a function throws fails the call, and the Node-side test
 * with it, with its message.
 *
 * @packageDocumentation
 */

/** The global the bridge is published under. */
export const BRIDGE = '__e3WebHarness';

/** A function a test page serves. */
export type PageFunction = (...args: never[]) => unknown;

/**
 * The bridge a page publishes: what the Node side calls.
 */
export interface PageBridge {
  /** Set once the page serves its functions */
  readonly ready: true;
  /** Calls a function the page serves */
  call(name: string, args: readonly unknown[]): Promise<unknown>;
}

/**
 * Serves a test page's functions to the Node side, and says the page is
 * ready.
 *
 * @param functions - The functions, by the name the Node side calls each by
 *
 * @example
 * ```ts
 * // storage.page.ts, bundled by the harness
 * servePage({
 *   async add(a: number, b: number) { return a + b; },
 * });
 * // storage.spec.ts
 * assert.equal(await page.call('add', 1, 2), 3);
 * ```
 */
export function servePage(functions: Readonly<Record<string, PageFunction>>): void {
  const bridge: PageBridge = {
    ready: true,
    async call(name, args) {
      const fn = functions[name] as ((...args: readonly unknown[]) => unknown) | undefined;
      if (fn === undefined) throw new Error(`the page serves no function '${name}'`);
      return await fn(...args);
    },
  };
  (globalThis as Record<string, unknown>)[BRIDGE] = bridge;
}
