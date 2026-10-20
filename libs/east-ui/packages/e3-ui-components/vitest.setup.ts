/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One realm for bytes in a DOM test, as a browser page has one (#1375).
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
 * @packageDocumentation
 */

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
