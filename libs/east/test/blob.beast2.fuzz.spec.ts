/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 byte-parity fuzz corpus (issue #770).
 *
 * e3 content-addresses beast2 bytes, so one value of one type must encode to
 * one byte string on every runtime. The pinned fixtures in
 * blob.beast2.parity.spec.ts cover the shapes that once diverged; this suite
 * covers the type space at random. Types come from the seeded fuzz generator
 * with every kind switched on — nested, shared and randomly-bodied recursion,
 * type values as leaves — and each sample value's bytes are computed here, in
 * TypeScript, from the type built in code, then baked into the test as a hex
 * literal. The suite is exported to /tmp/east-test-ir and replayed by the
 * east-c and east-py compliance harnesses, which encode the same value under
 * the type they read from the IR — the carried type a runner holds — so a
 * divergence in the type section or the value bytes fails there.
 *
 * Each sample asserts three things: the exact bytes; that decoding gives the
 * value back; and that re-encoding the decoded value reproduces the bytes.
 * A plain node test alongside checks the TypeScript carried path directly:
 * the type round-tripped through EastTypeValueType writes the built type's
 * bytes for every sample.
 *
 * Test names carry the type's fingerprint — the hash of its canonical beast2
 * type section — so a failure names the same type in every runtime and
 * process. Values are baked at module scope and appear inside East blocks
 * only as constants (east/no-host-in-east-block, no-module-scope-east-macro).
 */
import { test as nodeTest } from "node:test";
import nodeAssert from "node:assert/strict";
import { East, EastTypeValueType, decodeBeast2For, encodeBeast2For, toEastTypeValue, type EastType } from "../src/index.js";
import { generateFuzzValues } from "../src/fuzz.js";
import { describeEast as describe, assertEast as assert } from "./platforms.spec.js";

/** The seed pins the corpus; bump it deliberately to mint a fresh one. */
const SEED = 0xbea5;

interface Sample { value: unknown; hex: string }
interface Case { typeId: string; type: EastType; samples: Sample[] }

const hexOf = (bytes: Uint8Array): string => `0x${Buffer.from(bytes).toString("hex")}`;

const cases: Case[] = generateFuzzValues({
  numTypes: 150,
  numSamples: 3,
  valueDepth: 3,
  seed: SEED,
  includeRecursive: true,
  includeFunctions: false,   // only data encodes
  nestedRecursive: true,
  includeTypeValues: true,
}).map(({ type, fingerprint, values }) => {
  const encode = encodeBeast2For(type);
  return {
    typeId: fingerprint,
    type,
    samples: values.map((value) => ({ value, hex: hexOf(encode(value)) })),
  };
});

await describe("Blob (Beast v2 fuzz)", (test) => {
  for (const c of cases) {
    c.samples.forEach((sample, i) => {
      test(`${c.typeId} #${i}`, $ => {
        const value = $.const(sample.value as any, c.type as any);
        const encoded = $.let(East.Blob.encodeBeast(value as any, 'v2'));
        $(assert.equal(East.str`${encoded}`, sample.hex));
        const decoded = $.let(encoded.decodeBeast(c.type as any, 'v2'));
        $(assert.equal(decoded as any, value as any));
        $(assert.equal(East.Blob.encodeBeast(decoded as any, 'v2'), encoded));
      });
    });
  }
});

nodeTest("Beast v2 fuzz — a carried type writes the built type's bytes for every sample", () => {
  const roundTripType = decodeBeast2For(EastTypeValueType);
  const carry = encodeBeast2For(EastTypeValueType);
  for (const c of cases) {
    const carried = roundTripType(carry(toEastTypeValue(c.type)));
    const encode = encodeBeast2For(carried);
    for (const sample of c.samples) {
      nodeAssert.equal(hexOf(encode(sample.value)), sample.hex, `${c.typeId}: carried type`);
    }
  }
});
