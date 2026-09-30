/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Vendored from npm package 'random' (https://github.com/transitive-bullshit/random)
 * Originally by Travis Fischer, distributed under MIT license
 *
 * Ported verbatim from east-node-std's src/random/rng.ts
 * (libs/east-node/packages/east-node-std/src/random/rng.ts): a seeded stream
 * must stay bit-identical to east-node-std's, which test/random.spec.ts checks.
 */

export type SeedFn = () => number;
export type SeedType = number | bigint | string | SeedFn | RNG;

export default abstract class RNG {
    abstract get name(): string;

    abstract next(): number;

    abstract seed(_seed?: SeedType, _opts?: Record<string, unknown>): void;

    abstract clone(_seed?: SeedType, _opts?: Record<string, unknown>): RNG;
}
