/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One realm for bytes in a DOM test, as a browser page has one (#1375), and
 * no request past the harness's fetch (#1380).
 *
 * Vitest's jsdom environment puts jsdom's typed arrays and `ArrayBuffer` in
 * place of Node's, while the bytes Node's message ports, `fetch`,
 * `TextEncoder` and `Buffer` make are still Node's, so `instanceof Uint8Array`
 * fails for them. e3-web in a test's process (`src/e3-web.test-utils.ts`)
 * hands a record's bytes over Node's ports, and its in-memory storage tells
 * bytes from a stream by `instanceof Uint8Array`: given Node's bytes in
 * jsdom's realm, it took them for a stream and failed ("bytes.slice is not a
 * function"). This puts Node's constructors back before a test file loads
 * East or anything that makes bytes. In a Node environment they are Node's
 * already, and nothing changes.
 *
 * A test's requests go to e3 through the harness's fetch, as a page's go
 * through the fetch its provider gives: the global `fetch` refuses each
 * request, as a network that fails does, and a test that made one fails,
 * naming it.
 *
 * @packageDocumentation
 */

import { afterEach } from "vitest";

const globals = globalThis as unknown as Record<string, unknown>;

/** One of each constructor, made in whichever realm the global names now. */
const samples: readonly (readonly [name: string, sample: object])[] = [
    ["Uint8Array", new Uint8Array(0)], ["Uint8ClampedArray", new Uint8ClampedArray(0)],
    ["Uint16Array", new Uint16Array(0)], ["Uint32Array", new Uint32Array(0)],
    ["Int8Array", new Int8Array(0)], ["Int16Array", new Int16Array(0)], ["Int32Array", new Int32Array(0)],
    ["Float32Array", new Float32Array(0)], ["Float64Array", new Float64Array(0)],
    ["ArrayBuffer", new ArrayBuffer(0)],
];

// Node's structured clone makes its copy in Node's own realm, whatever the
// global names: the copy's constructor is Node's.
for (const [name, sample] of samples) globals[name] = (structuredClone(sample) as object).constructor;

/** Each request that reached the global fetch in the test running now. */
let escaped: string[] = [];

/** The global fetch: it refuses every request, which never goes through the harness's. */
const refused: typeof globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : `${input}`;
    escaped.push(url);
    throw new TypeError(`fetch failed: ${url} went to the global fetch, not through the harness's`);
};
globalThis.fetch = refused;

afterEach(() => {
    const urls = escaped;
    escaped = [];
    if (urls.length > 0) throw new Error(`the test's requests reached the global fetch, not the harness's: ${urls.join(", ")}`);
});
