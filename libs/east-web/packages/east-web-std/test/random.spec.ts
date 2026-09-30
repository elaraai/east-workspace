/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Random's seeded streams are east-node-std's, bit for bit.
 *
 * east-web-std ports east-node-std's generator and distributions, so a task
 * that seeds its draws gives the same values in a browser as on Node. These
 * specs draw from both over many seeds — the generator itself, every Random
 * platform function in turn, and a compiled East program — and compare every
 * value with East's equality, which tells `-0.0` from `0.0`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, East, FloatType, IntegerType, equalFor, lessEqualFor, lessFor, printFor, type EastType } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { RandomImpl as NodeRandomImpl, XorShift128RNG as NodeXorShift128RNG } from "@elaraai/east-node-std";
import { Random, RandomImpl, XorShift128RNG, createRandomImpl, resetToCryptoRNG } from "@elaraai/east-web-std";

/** Seeds an East program can pass: the first 256, and a 64-bit integer's edges. */
const SEEDS: readonly bigint[] = [
    ...Array.from({ length: 256 }, (_, i) => BigInt(i)),
    -1n, -2n, -12345n, 42n, 12345n, 999_999_937n,
    2n ** 31n, 2n ** 32n + 1n, 2n ** 53n + 1n,
    2n ** 63n - 1n, -(2n ** 63n),
];

/** Seeds only the generator class takes: past 64 bits, numbers, strings. */
const CLASS_SEEDS: readonly (bigint | number | string)[] = [
    2n ** 64n - 1n, 2n ** 64n, 2n ** 100n + 7n, -(2n ** 70n),
    0, 3.7, -2.5, 1e15,
    "", "my-simulation-seed", "é🙂",
];

/** How many values each generator draws per seed. */
const DRAWS = 200;

const equalFloats = equalFor(ArrayType(FloatType));

/** A platform's functions by name. */
function functions(platform: readonly PlatformFunction[]): Map<string, (...args: any[]) => any> {
    return new Map(platform.map(fn => [fn.name, fn.fn]));
}

/** One Random platform call, and the East type of what it returns. */
interface Call {
    name: string;
    args: readonly unknown[];
    type: EastType;
}

/** Every Random platform function, with parameters that reach each branch. */
const CALLS: readonly Call[] = [
    { name: "random_uniform", args: [], type: FloatType },
    { name: "random_normal", args: [], type: FloatType },
    { name: "random_range", args: [1n, 6n], type: IntegerType },
    { name: "random_range", args: [-1_000_000n, 1_000_000n], type: IntegerType },
    { name: "random_exponential", args: [1.0], type: FloatType },
    { name: "random_exponential", args: [0.2], type: FloatType },
    { name: "random_weibull", args: [2.0], type: FloatType },
    { name: "random_weibull", args: [0.5], type: FloatType },
    { name: "random_bernoulli", args: [0.5], type: IntegerType },
    { name: "random_bernoulli", args: [0.1], type: IntegerType },
    { name: "random_binomial", args: [10n, 0.5], type: IntegerType },
    { name: "random_binomial", args: [100n, 0.3], type: IntegerType },
    { name: "random_geometric", args: [0.5], type: IntegerType },
    { name: "random_geometric", args: [0.01], type: IntegerType },
    // The inversion method (lambda < 10) and the generative one (lambda >= 10)
    { name: "random_poisson", args: [3.0], type: IntegerType },
    { name: "random_poisson", args: [25.0], type: IntegerType },
    { name: "random_pareto", args: [1.16], type: FloatType },
    { name: "random_pareto", args: [2.0], type: FloatType },
    { name: "random_log_normal", args: [0.0, 1.0], type: FloatType },
    { name: "random_log_normal", args: [1.0, 0.5], type: FloatType },
    { name: "random_irwin_hall", args: [12n], type: FloatType },
    { name: "random_irwin_hall", args: [0n], type: FloatType },
    { name: "random_bates", args: [12n], type: FloatType },
    { name: "random_bates", args: [1n], type: FloatType },
];

/** The calls each round of a seed makes, three times over. */
const ROUNDS = 3;

/** A stream of uniform draws, straight from a generator. */
function stream(rng: { next(): number }, length: number = DRAWS): number[] {
    return Array.from({ length }, () => rng.next());
}

/** The error a call throws, as its message. */
function thrown(call: () => unknown): string {
    try {
        call();
    } catch (error) {
        return error instanceof Error ? error.message : "a non-Error";
    }
    return "no error";
}

describe("Random's seeded streams are east-node-std's", () => {
    it("draws east-node-std's stream from XorShift128RNG, for every seed", () => {
        for (const seed of [...SEEDS, ...CLASS_SEEDS]) {
            const web = stream(new XorShift128RNG(seed));
            const node = stream(new NodeXorShift128RNG(seed));
            assert.ok(equalFloats(web, node), `seed ${seed} draws another stream`);
        }
    });

    it("draws east-node-std's stream after a re-seed and from a clone", () => {
        for (const seed of SEEDS.slice(0, 32)) {
            const web = new XorShift128RNG(seed);
            const node = new NodeXorShift128RNG(seed);
            stream(web, 17);
            stream(node, 17);
            assert.ok(equalFloats(stream(web.clone()), stream(node.clone())), `seed ${seed}: a clone draws another stream`);
            web.seed(seed + 1n);
            node.seed(seed + 1n);
            assert.ok(equalFloats(stream(web), stream(node)), `seed ${seed + 1n}: a re-seed draws another stream`);
        }
    });

    it("draws east-node-std's values from every Random platform function, for every seed", () => {
        const web = functions(createRandomImpl());
        const node = functions(NodeRandomImpl);
        for (const seed of SEEDS) {
            web.get("random_seed")!(seed);
            node.get("random_seed")!(seed);
            for (let round = 0; round < ROUNDS; round++) {
                for (const { name, args, type } of CALLS) {
                    const drawn = web.get(name)!(...args);
                    const expected = node.get(name)!(...args);
                    const print = printFor(type);
                    assert.ok(
                        equalFor(type)(drawn, expected),
                        `seed ${seed}, round ${round}: ${name} drew ${print(drawn)} here and ${print(expected)} on Node`,
                    );
                }
            }
        }
    });

    it("gives an East program east-node-std's values", () => {
        const draw = East.function([IntegerType], FloatType, ($, seed) => {
            $(Random.seed(seed));
            $(Random.normal());
            $(Random.range(1n, 100n));
            $(Random.poisson(12.5));
            return Random.uniform();
        });
        const web = draw.toIR().compile(createRandomImpl());
        const node = draw.toIR().compile(NodeRandomImpl);
        const equalFloat = equalFor(FloatType);
        for (const seed of SEEDS) {
            assert.ok(equalFloat(web(seed), node(seed)), `seed ${seed} draws another value`);
        }
    });

    it("fails a bad parameter with east-node-std's message", () => {
        const web = functions(RandomImpl);
        const node = functions(NodeRandomImpl);
        const bad: readonly (readonly [string, readonly unknown[]])[] = [
            ["random_range", [10n, 5n]],
            ["random_exponential", [0]],
            ["random_bernoulli", [1]],
            ["random_binomial", [0n, 0.5]],
            ["random_binomial", [10n, -0.1]],
            ["random_geometric", [0]],
            ["random_poisson", [-1]],
            ["random_pareto", [-1]],
            ["random_irwin_hall", [-1n]],
            ["random_bates", [0n]],
        ];
        for (const [name, args] of bad) {
            const message = thrown(() => web.get(name)!(...args));
            assert.notEqual(message, "no error", `${name} took a bad parameter`);
            assert.equal(message, thrown(() => node.get(name)!(...args)), `${name} fails with another message`);
        }
    });
});

describe("each Random implementation keeps its own generator", () => {
    it("draws each seed's stream from each implementation, however their draws interleave", () => {
        const first = functions(createRandomImpl());
        const second = functions(createRandomImpl());
        first.get("random_seed")!(1n);
        second.get("random_seed")!(2n);
        const one: number[] = [];
        const two: number[] = [];
        for (let i = 0; i < 50; i++) {
            one.push(first.get("random_uniform")!());
            two.push(second.get("random_uniform")!(), second.get("random_uniform")!());
        }
        assert.ok(equalFloats(one, stream(new XorShift128RNG(1n), 50)));
        assert.ok(equalFloats(two, stream(new XorShift128RNG(2n), 100)));
    });

    it("keeps RandomImpl's generator apart from a created one's", () => {
        const shared = functions(RandomImpl);
        const own = functions(createRandomImpl());
        shared.get("random_seed")!(7n);
        own.get("random_seed")!(8n);
        const seven: number[] = [];
        const eight: number[] = [];
        for (let i = 0; i < 20; i++) {
            eight.push(own.get("random_uniform")!());
            seven.push(shared.get("random_uniform")!());
        }
        assert.ok(equalFloats(seven, stream(new XorShift128RNG(7n), 20)));
        assert.ok(equalFloats(eight, stream(new XorShift128RNG(8n), 20)));
        resetToCryptoRNG();
    });

    it("leaves the seeded stream on resetToCryptoRNG", () => {
        const shared = functions(RandomImpl);
        shared.get("random_seed")!(42n);
        const seeded = stream(new XorShift128RNG(42n), 21);
        assert.ok(equalFor(FloatType)(shared.get("random_uniform")!(), seeded[0]!));
        resetToCryptoRNG();
        const after = Array.from({ length: 20 }, () => shared.get("random_uniform")!() as number);
        assert.ok(!equalFloats(after, seeded.slice(1)), "the stream went on after the reset");
    });

    it("starts unseeded, drawing cryptographic values in [0, 1)", () => {
        const draws = (impl: PlatformFunction[]): number[] => {
            const uniform = functions(impl).get("random_uniform")!;
            return Array.from({ length: 1000 }, () => uniform() as number);
        };
        const first = draws(createRandomImpl());
        const second = draws(createRandomImpl());
        const atMost = lessEqualFor(FloatType);
        const below = lessFor(FloatType);
        for (const value of [...first, ...second]) {
            assert.ok(atMost(0, value) && below(value, 1), `${value} is outside [0, 1)`);
        }
        assert.ok(!equalFloats(first, second), "two unseeded implementations drew one stream");
        assert.ok(new Set(first).size > 990, "an unseeded implementation repeats itself");
    });
});
