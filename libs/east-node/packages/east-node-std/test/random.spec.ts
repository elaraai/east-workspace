/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { describeEast, Assert, Random, resetToCryptoRNG, NodePlatform, XorShift128RNG } from "@elaraai/east-node-std";
import * as ex from "./random.examples.js";

// Reset RNG before each test to avoid test pollution
beforeEach(() => {
    resetToCryptoRNG();
});

// Direct unit tests for XorShift128 RNG
describe("XorShift128 RNG", () => {
    test("produces values in [0, 1)", () => {
        const rng = new XorShift128RNG(12345);
        for (let i = 0; i < 100; i++) {
            const value = rng.next();
            assert.ok(value >= 0 && value < 1, `Value ${value} not in [0, 1)`);
        }
    });

    test("same seed produces same sequence", () => {
        const rng1 = new XorShift128RNG(42);
        const rng2 = new XorShift128RNG(42);

        const seq1 = Array.from({ length: 10 }, () => rng1.next());
        const seq2 = Array.from({ length: 10 }, () => rng2.next());

        assert.deepEqual(seq1, seq2);
    });

    test("different seeds produce different sequences", () => {
        const rng1 = new XorShift128RNG(42);
        const rng2 = new XorShift128RNG(123);

        const seq1 = Array.from({ length: 10 }, () => rng1.next());
        const seq2 = Array.from({ length: 10 }, () => rng2.next());

        assert.notDeepEqual(seq1, seq2);
    });

    test("re-seeding produces reproducible sequence", () => {
        const rng = new XorShift128RNG(42);
        const seq1 = Array.from({ length: 10 }, () => rng.next());

        rng.seed(42);
        const seq2 = Array.from({ length: 10 }, () => rng.next());

        assert.deepEqual(seq1, seq2);
    });

    test("clone creates independent copy", () => {
        const rng1 = new XorShift128RNG(42);
        rng1.next(); // Advance state
        rng1.next();

        const rng2 = rng1.clone() as XorShift128RNG;

        // Both should produce same values from here
        const seq1 = Array.from({ length: 5 }, () => rng1.next());
        const seq2 = Array.from({ length: 5 }, () => rng2.next());

        assert.deepEqual(seq1, seq2);
    });

    test("string seed works", () => {
        const rng1 = new XorShift128RNG();
        rng1.seed("my-simulation-seed");
        const seq1 = Array.from({ length: 10 }, () => rng1.next());

        const rng2 = new XorShift128RNG();
        rng2.seed("my-simulation-seed");
        const seq2 = Array.from({ length: 10 }, () => rng2.next());

        assert.deepEqual(seq1, seq2);
    });
});

// Platform function tests
describeEast("Random platform functions", (test) => {
    Assert.examples(test, { randomUniform: ex.randomUniform, randomNormal: ex.randomNormal, randomRange: ex.randomRange, randomExponential: ex.randomExponential, randomWeibull: ex.randomWeibull, randomBernoulli: ex.randomBernoulli, randomBinomial: ex.randomBinomial, randomGeometric: ex.randomGeometric, randomPoisson: ex.randomPoisson, randomPareto: ex.randomPareto, randomLogNormal: ex.randomLogNormal, randomIrwinHall: ex.randomIrwinHall, randomBates: ex.randomBates, randomSeed: ex.randomSeed });

    test("uniform returns number in [0, 1)", $ => {
        const value = $.let(Random.uniform());
        $(Assert.greaterEqual(value, 0.0));
        $(Assert.less(value, 1.0));
    });

    test("normal returns a number", $ => {
        const value = $.let(Random.normal());
        // Normal distribution is unbounded, just verify it returns a number
        // We can't easily test range without statistical analysis
        $(Assert.notEqual(value, value.add(1.0)));  // Sanity check: x != x+1
    });

    test("range returns integer in [min, max]", $ => {
        const value = $.let(Random.range(1n, 6n));
        $(Assert.greaterEqual(value, 1n));
        $(Assert.lessEqual(value, 6n));
    });

    test("range throws when min > max", $ => {
        $(Assert.throws(Random.range(10n, 5n), /Invalid range/));
    });

    test("exponential returns positive number", $ => {
        const value = $.let(Random.exponential(1.0));
        $(Assert.greater(value, 0.0));
    });

    test("exponential with custom lambda", $ => {
        const value = $.let(Random.exponential(0.5));
        $(Assert.greater(value, 0.0));
    });

    test("weibull returns positive number", $ => {
        const value = $.let(Random.weibull(2.0));
        $(Assert.greater(value, 0.0));
    });

    test("weibull with shape=1 (exponential)", $ => {
        const value = $.let(Random.weibull(1.0));
        $(Assert.greater(value, 0.0));
    });

    test("bernoulli returns 0 or 1", $ => {
        const value = $.let(Random.bernoulli(0.5));
        $(Assert.greaterEqual(value, 0n));
        $(Assert.lessEqual(value, 1n));
    });

    test("bernoulli with p=0.1", $ => {
        const value = $.let(Random.bernoulli(0.1));
        $(Assert.greaterEqual(value, 0n));
        $(Assert.lessEqual(value, 1n));
    });

    test("binomial returns integer in [0, n]", $ => {
        const value = $.let(Random.binomial(10n, 0.5));
        $(Assert.greaterEqual(value, 0n));
        $(Assert.lessEqual(value, 10n));
    });

    test("binomial with n=1 (bernoulli)", $ => {
        const value = $.let(Random.binomial(1n, 0.5));
        $(Assert.greaterEqual(value, 0n));
        $(Assert.lessEqual(value, 1n));
    });

    test("geometric returns positive integer", $ => {
        const value = $.let(Random.geometric(0.5));
        $(Assert.greaterEqual(value, 1n));
    });

    test("geometric with small p", $ => {
        const value = $.let(Random.geometric(0.1));
        $(Assert.greaterEqual(value, 1n));
    });

    test("poisson returns non-negative integer", $ => {
        const value = $.let(Random.poisson(3.0));
        $(Assert.greaterEqual(value, 0n));
    });

    test("poisson with lambda=1", $ => {
        const value = $.let(Random.poisson(1.0));
        $(Assert.greaterEqual(value, 0n));
    });

    test("pareto returns number >= 1", $ => {
        const value = $.let(Random.pareto(2.0));
        $(Assert.greaterEqual(value, 1.0));
    });

    test("pareto with alpha=1.16 (80/20)", $ => {
        const value = $.let(Random.pareto(1.16));
        $(Assert.greaterEqual(value, 1.0));
    });

    test("logNormal returns positive number", $ => {
        const value = $.let(Random.logNormal(0.0, 1.0));
        $(Assert.greater(value, 0.0));
    });

    test("logNormal with custom mu and sigma", $ => {
        const value = $.let(Random.logNormal(1.0, 0.5));
        $(Assert.greater(value, 0.0));
    });

    test("irwinHall returns number in [0, n]", $ => {
        const value = $.let(Random.irwinHall(12n));
        $(Assert.greaterEqual(value, 0.0));
        $(Assert.lessEqual(value, 12.0));
    });

    test("irwinHall with n=1", $ => {
        const value = $.let(Random.irwinHall(1n));
        $(Assert.greaterEqual(value, 0.0));
        $(Assert.lessEqual(value, 1.0));
    });

    test("bates returns number in [0, 1]", $ => {
        const value = $.let(Random.bates(12n));
        $(Assert.greaterEqual(value, 0.0));
        $(Assert.lessEqual(value, 1.0));
    });

    test("bates with n=1 (uniform)", $ => {
        const value = $.let(Random.bates(1n));
        $(Assert.greaterEqual(value, 0.0));
        $(Assert.lessEqual(value, 1.0));
    });

    test("seed enables reproducible uniform values", $ => {
        // Seed, generate value, reseed with same, generate again - should match
        $(Random.seed(42n));
        const v1 = $.let(Random.uniform());
        $(Random.seed(42n));
        const v2 = $.let(Random.uniform());
        $(Assert.equal(v1, v2));
    });

    test("seed enables reproducible range values", $ => {
        $(Random.seed(12345n));
        const v1 = $.let(Random.range(1n, 100n));
        $(Random.seed(12345n));
        const v2 = $.let(Random.range(1n, 100n));
        $(Assert.equal(v1, v2));
    });

    test("different seeds produce different values", $ => {
        $(Random.seed(42n));
        const v1 = $.let(Random.uniform());
        $(Random.seed(999n));
        const v2 = $.let(Random.uniform());
        $(Assert.notEqual(v1, v2));
    });
}, { platformFns: NodePlatform });
