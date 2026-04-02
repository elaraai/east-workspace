/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Vendored from npm package 'random' (https://github.com/transitive-bullshit/random)
 * Originally by Travis Fischer, distributed under MIT license
 */

export type SeedFn = () => number;
export type SeedType = number | bigint | string | SeedFn | RNG;

export default abstract class RNG {
    abstract get name(): string;

    abstract next(): number;

    abstract seed(_seed?: SeedType, _opts?: Record<string, unknown>): void;

    abstract clone(_seed?: SeedType, _opts?: Record<string, unknown>): RNG;
}
