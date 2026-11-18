/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The fuzz generator's deterministic stream: the numbers a seed gives, which
 * the replay corpus and every spec that makes its cases from a seed are held
 * to, and the reseeding that reproduces a generation.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { generateFuzzValues, randomStream, randomType, seedFuzz } from "./fuzz.js";
import { printType } from "./types.js";

describe("randomStream", () => {
  test("gives the numbers mulberry32 gives for a seed, so a corpus made from one is made again", () => {
    // Pinned: a change to these numbers changes every case drawn from them,
    // and the replay corpus east-c and east-py hold.
    const corpus = randomStream(0xea57);
    assert.deepEqual([corpus(), corpus(), corpus(), corpus()],
      [0.5014431714080274, 0.27206260175444186, 0.9932428349275142, 0.16608138708397746]);
    const cases = randomStream(1616);
    assert.deepEqual([cases(), cases(), cases(), cases()],
      [0.24111352767795324, 0.7884585086721927, 0.5056421912740916, 0.8840749769005924]);
  });

  test("gives equal streams for equal seeds, each its own, and every number in [0, 1)", () => {
    const [a, b, other] = [randomStream(7), randomStream(7), randomStream(8)];
    const drawn = Array.from({ length: 10_000 }, () => a());
    assert.deepEqual(Array.from({ length: 10_000 }, () => b()), drawn, "a stream of the same seed gives the same numbers");
    assert.notDeepEqual(Array.from({ length: 10 }, () => other()), drawn.slice(0, 10), "another seed gives others");
    assert.ok(drawn.every((n) => n >= 0 && n < 1), "every number is in [0, 1)");
    // Only the seed's low 32 bits are read.
    const [low, high] = [randomStream(5), randomStream(5 + 2 ** 32)];
    assert.deepEqual([low(), low()], [high(), high()]);
  });
});

describe("seedFuzz", () => {
  test("reseeds the generator, so what it draws after is drawn again after the same seed", () => {
    const draw = (): string[] => Array.from({ length: 50 }, () => printType(randomType(1, { includeRecursive: false, includeFunctions: false })));
    seedFuzz(0x1652);
    const first = draw();
    randomType(); // whatever was drawn in between
    seedFuzz(0x1652);
    assert.deepEqual(draw(), first);
    assert.deepEqual(generateFuzzValues({ numTypes: 20, seed: 9 }).map((c) => c.fingerprint),
      generateFuzzValues({ numTypes: 20, seed: 9 }).map((c) => c.fingerprint), "a generation from a seed is made again");
  });
});
