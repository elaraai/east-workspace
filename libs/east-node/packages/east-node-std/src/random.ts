/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, FloatType, IntegerType, NullType } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import { EastError } from "@elaraai/east/internal";

// Import vendored random library
import type RNG from "./random/rng.js";
import CryptoRNG from "./random/crypto-rng.js";
import XorShift128RNG from "./random/xorshift128.js";
import uniformDist from "./random/distributions/uniform.js";
import uniformIntDist from "./random/distributions/uniform-int.js";
import normalDist from "./random/distributions/normal.js";
import exponentialDist from "./random/distributions/exponential.js";
import bernoulliDist from "./random/distributions/bernoulli.js";
import binomialDist from "./random/distributions/binomial.js";
import geometricDist from "./random/distributions/geometric.js";
import poissonDist from "./random/distributions/poisson.js";
import paretoDist from "./random/distributions/pareto.js";
import logNormalDist from "./random/distributions/log-normal.js";
import irwinHallDist from "./random/distributions/irwin-hall.js";
import batesDist from "./random/distributions/bates.js";

// Global RNG instance (uses cryptographically secure random by default)
let globalRNG: RNG = new CryptoRNG();

/**
 * Reset global RNG to cryptographically secure mode.
 * Primarily for testing to avoid test pollution.
 */
export function resetToCryptoRNG(): void {
    globalRNG = new CryptoRNG();
}

// Platform Function Definitions

/**
 * Generates a uniform random float in the range [0.0, 1.0).
 *
 * Returns a uniformly distributed random floating-point number greater than or equal to 0.0
 * and strictly less than 1.0. Uses cryptographically secure random number generation by default.
 *
 * This is a platform function for the East language, enabling secure random number generation
 * in East programs running on Node.js.
 *
 * @returns A random float in [0.0, 1.0)
 *
 * @example
 * ```ts
 * const generateRandom = East.function([], FloatType, $ => {
 *     return Random.uniform();
 * });
 * ```
 *
 * @remarks
 * - Uses Node.js crypto.randomBytes for cryptographic security
 * - Uniform distribution across the range
 * - Never returns exactly 1.0
 */
export const random_uniform = East.platform("random_uniform", [], FloatType);

/**
 * Generates a random float from a standard normal distribution (mean=0, standard deviation=1).
 *
 * Returns a random floating-point number drawn from a normal (Gaussian) distribution
 * with mean 0.0 and standard deviation 1.0. Uses the Marsaglia polar method for
 * high-quality normal distribution sampling.
 *
 * This is a platform function for the East language, enabling normal distribution sampling
 * in East programs running on Node.js.
 *
 * @returns A random float from N(0, 1)
 *
 * @example
 * ```ts
 * const generateNormal = East.function([], FloatType, $ => {
 *     const z = $.let(Random.normal());
 *     // Scale and shift: z * stddev + mean
 *     return z.multiply(2.5).add(10.0);  // N(10, 2.5)
 * });
 * ```
 *
 * @remarks
 * - Uses Marsaglia polar method for high-quality normal distribution
 * - Mean: 0.0, Standard deviation: 1.0
 * - Can return any real number (unbounded range)
 * - Use `.multiply(stddev).add(mean)` to scale/shift distribution
 */
export const random_normal = East.platform("random_normal", [], FloatType);

/**
 * Generates a random integer in the range [min, max] (both endpoints inclusive).
 *
 * Returns a uniformly distributed random integer between min and max (both inclusive).
 * Uses cryptographically secure random number generation. The range must be valid (min ≤ max).
 *
 * This is a platform function for the East language, enabling random integer generation
 * in East programs running on Node.js.
 *
 * @param min - The minimum value (inclusive)
 * @param max - The maximum value (inclusive)
 * @returns A random integer in [min, max]
 *
 * @throws {EastError} When min > max
 *
 * @example
 * ```ts
 * const rollDice = East.function([], IntegerType, $ => {
 *     return Random.range(1n, 6n);  // 1-6 inclusive
 * });
 * ```
 *
 * @remarks
 * - Both min and max are inclusive
 * - Uniform distribution across the range
 * - Uses floor method to avoid modulo bias
 */
export const random_range = East.platform("random_range", [IntegerType, IntegerType], IntegerType);

/**
 * Generates a random float from an exponential distribution.
 *
 * Returns a random floating-point number drawn from an exponential distribution
 * with rate parameter lambda (λ). The mean of the distribution is 1/λ.
 * Commonly used for modeling time between events in a Poisson process.
 *
 * This is a platform function for the East language, enabling exponential distribution sampling
 * in East programs running on Node.js.
 *
 * @param lambda - Rate parameter (λ > 0), default 1.0. Mean = 1/λ
 * @returns A random float from Exp(λ)
 *
 * @throws {EastError} When lambda ≤ 0
 *
 * @example
 * ```ts
 * const waitTime = East.function([], FloatType, $ => {
 *     // Average wait time of 5 minutes (lambda = 0.2)
 *     return Random.exponential(0.2);
 * });
 * ```
 *
 * @remarks
 * - Uses inverse transform sampling: -ln(U) / λ
 * - Always returns positive values
 * - Mean = 1/λ, Variance = 1/λ²
 * - Memoryless property: P(X > s + t | X > s) = P(X > t)
 */
export const random_exponential = East.platform("random_exponential", [FloatType], FloatType);

/**
 * Generates a random float from a Weibull distribution.
 *
 * Returns a random floating-point number drawn from a Weibull distribution
 * with shape parameter k. Uses exponential distribution transformation.
 * Commonly used for modeling failure rates and lifetime distributions.
 *
 * This is a platform function for the East language, enabling Weibull distribution sampling
 * in East programs running on Node.js.
 *
 * @param shape - Shape parameter (k > 0). k=1 gives exponential, k>1 increases failure rate
 * @returns A random float from Weibull(k, 1)
 *
 * @throws {EastError} When shape ≤ 0
 *
 * @example
 * ```ts
 * const lifetime = East.function([], FloatType, $ => {
 *     // Shape=2 models wear-out failures
 *     return Random.weibull(2.0);
 * });
 * ```
 *
 * @remarks
 * - Uses transformation: exponential() ^ (1/shape)
 * - Shape < 1: decreasing failure rate
 * - Shape = 1: constant failure rate (exponential)
 * - Shape > 1: increasing failure rate
 */
export const random_weibull = East.platform("random_weibull", [FloatType], FloatType);

/**
 * Generates a binary random outcome (0 or 1).
 *
 * Returns 0 or 1 based on success probability p. This models a single
 * Bernoulli trial, like a biased coin flip.
 *
 * This is a platform function for the East language, enabling binary random outcomes
 * in East programs running on Node.js.
 *
 * @param p - Success probability (0 ≤ p < 1), default 0.5
 * @returns 0 or 1 (as integer)
 *
 * @throws {EastError} When p < 0 or p ≥ 1
 *
 * @example
 * ```ts
 * const coinFlip = East.function([], IntegerType, $ => {
 *     // Fair coin: 50% chance of 1
 *     return Random.bernoulli(0.5);
 * });
 * ```
 *
 * @remarks
 * - Returns 1 with probability p, 0 with probability (1-p)
 * - Mean = p, Variance = p(1-p)
 * - Special case of binomial with n=1
 */
export const random_bernoulli = East.platform("random_bernoulli", [FloatType], IntegerType);

/**
 * Generates the number of successes in n independent Bernoulli trials.
 *
 * Returns an integer count of successes when performing n independent trials,
 * each with success probability p. Models scenarios like coin flips, pass/fail tests.
 *
 * This is a platform function for the East language, enabling binomial distribution sampling
 * in East programs running on Node.js.
 *
 * @param n - Number of trials (integer > 0)
 * @param p - Success probability per trial (0 ≤ p < 1), default 0.5
 * @returns Number of successes (integer in [0, n])
 *
 * @throws {EastError} When n ≤ 0, not an integer, or p < 0 or p ≥ 1
 *
 * @example
 * ```ts
 * const heads = East.function([], IntegerType, $ => {
 *     // Number of heads in 10 coin flips
 *     return Random.binomial(10n, 0.5);
 * });
 * ```
 *
 * @remarks
 * - Mean = n × p, Variance = n × p × (1-p)
 * - Returns value in range [0, n]
 * - Sum of n independent Bernoulli(p) trials
 */
export const random_binomial = East.platform("random_binomial", [IntegerType, FloatType], IntegerType);

/**
 * Generates the number of trials until the first success.
 *
 * Returns an integer representing the number of independent Bernoulli trials
 * needed to get the first success, where each trial has success probability p.
 * Models scenarios like "how many attempts until success?"
 *
 * This is a platform function for the East language, enabling geometric distribution sampling
 * in East programs running on Node.js.
 *
 * @param p - Success probability per trial (0 < p < 1), default 0.5
 * @returns Number of trials until first success (integer ≥ 1)
 *
 * @throws {EastError} When p ≤ 0 or p ≥ 1
 *
 * @example
 * ```ts
 * const attempts = East.function([], IntegerType, $ => {
 *     // Rolls until getting a 6 (p = 1/6)
 *     return Random.geometric(1.0 / 6.0);
 * });
 * ```
 *
 * @remarks
 * - Mean = 1/p, Variance = (1-p)/p²
 * - Always returns integer ≥ 1
 * - Memoryless property like exponential distribution
 * - Uses inverse transform sampling
 */
export const random_geometric = East.platform("random_geometric", [FloatType], IntegerType);

/**
 * Generates the number of events in a fixed interval from a Poisson process.
 *
 * Returns an integer count of events occurring in a fixed interval,
 * where events occur independently at a constant average rate λ (lambda).
 * Commonly used for modeling rare events, arrivals, or counts.
 *
 * This is a platform function for the East language, enabling Poisson distribution sampling
 * in East programs running on Node.js.
 *
 * @param lambda - Average rate of events (λ > 0), default 1.0
 * @returns Number of events (integer ≥ 0)
 *
 * @throws {EastError} When lambda ≤ 0
 *
 * @example
 * ```ts
 * const customers = East.function([], IntegerType, $ => {
 *     // Average 3 customers per hour
 *     return Random.poisson(3.0);
 * });
 * ```
 *
 * @remarks
 * - Mean = λ, Variance = λ
 * - Always returns non-negative integer
 * - Uses inversion method for λ < 10, generative method for λ ≥ 10
 * - Approximates binomial when n is large and p is small
 */
export const random_poisson = East.platform("random_poisson", [FloatType], IntegerType);

/**
 * Generates a random float from a Pareto distribution (power law).
 *
 * Returns a random floating-point number drawn from a Pareto distribution
 * with shape parameter α (alpha). Models phenomena following power laws,
 * like wealth distribution, city sizes, or word frequencies.
 *
 * This is a platform function for the East language, enabling Pareto distribution sampling
 * in East programs running on Node.js.
 *
 * @param alpha - Shape parameter (α ≥ 0), default 1.0. Smaller α = heavier tail
 * @returns A random float from Pareto(α) (value ≥ 1.0)
 *
 * @throws {EastError} When alpha < 0
 *
 * @example
 * ```ts
 * const wealth = East.function([], FloatType, $ => {
 *     // Heavy-tailed distribution (80/20 rule)
 *     return Random.pareto(1.16);
 * });
 * ```
 *
 * @remarks
 * - Always returns value ≥ 1.0
 * - Mean = α/(α-1) for α > 1, infinite otherwise
 * - Heavier tail as α decreases
 * - Models "80/20 rule" and power law phenomena
 */
export const random_pareto = East.platform("random_pareto", [FloatType], FloatType);

/**
 * Generates a random float whose logarithm is normally distributed.
 *
 * Returns a random floating-point number from a log-normal distribution,
 * where ln(X) ~ N(μ, σ²). Commonly used for modeling multiplicative processes,
 * stock prices, or quantities that can't be negative.
 *
 * This is a platform function for the East language, enabling log-normal distribution sampling
 * in East programs running on Node.js.
 *
 * @param mu - Mean of underlying normal distribution, default 0.0
 * @param sigma - Standard deviation of underlying normal, default 1.0
 * @returns A random float from LogNormal(μ, σ) (always positive)
 *
 * @example
 * ```ts
 * const stockPrice = East.function([], FloatType, $ => {
 *     // Log-normal with ln(X) ~ N(0, 0.2)
 *     return Random.logNormal(0.0, 0.2);
 * });
 * ```
 *
 * @remarks
 * - Always returns positive values
 * - If ln(X) ~ N(μ, σ²), then X ~ LogNormal(μ, σ)
 * - Median = exp(μ), Mean = exp(μ + σ²/2)
 * - Right-skewed distribution
 */
export const random_log_normal = East.platform("random_log_normal", [FloatType, FloatType], FloatType);

/**
 * Generates the sum of n independent uniform random variables.
 *
 * Returns the sum of n independent uniform(0,1) random variables.
 * This is the Irwin-Hall distribution. As n increases, approaches
 * normal distribution by Central Limit Theorem.
 *
 * This is a platform function for the East language, enabling Irwin-Hall distribution sampling
 * in East programs running on Node.js.
 *
 * @param n - Number of uniform variables to sum (integer ≥ 0), default 1
 * @returns Sum of n uniform(0,1) random variables (float in [0, n])
 *
 * @throws {EastError} When n < 0 or not an integer
 *
 * @example
 * ```ts
 * const irwinHall = East.function([], FloatType, $ => {
 *     // Sum of 12 uniform variables
 *     return Random.irwinHall(12n);
 * });
 * ```
 *
 * @remarks
 * - Range: [0, n]
 * - Mean = n/2, Variance = n/12
 * - Approximates N(n/2, n/12) for large n
 * - Related to Bates distribution (divided by n)
 */
export const random_irwin_hall = East.platform("random_irwin_hall", [IntegerType], FloatType);

/**
 * Generates the average of n independent uniform random variables.
 *
 * Returns the average of n independent uniform(0,1) random variables.
 * This is the Bates distribution. Approaches normal distribution as
 * n increases (Central Limit Theorem).
 *
 * This is a platform function for the East language, enabling Bates distribution sampling
 * in East programs running on Node.js.
 *
 * @param n - Number of uniform variables to average (integer > 0), default 1
 * @returns Average of n uniform(0,1) random variables (float in [0, 1])
 *
 * @throws {EastError} When n ≤ 0 or not an integer
 *
 * @example
 * ```ts
 * const bates = East.function([], FloatType, $ => {
 *     // Average of 12 uniform variables (smoother than single uniform)
 *     return Random.bates(12n);
 * });
 * ```
 *
 * @remarks
 * - Range: [0, 1]
 * - Mean = 0.5, Variance = 1/(12n)
 * - Approximates N(0.5, 1/(12n)) for large n
 * - More concentrated around 0.5 as n increases
 */
export const random_bates = East.platform("random_bates", [IntegerType], FloatType);

/**
 * Seeds the global random number generator.
 *
 * Sets the seed for the random number generator, allowing reproducible random sequences.
 * All subsequent random operations will use this seeded RNG until a new seed is set
 * or the process restarts.
 *
 * This is a platform function for the East language, enabling reproducible randomness
 * in East programs running on Node.js.
 *
 * @param seed - Seed value (integer)
 * @returns null
 *
 * @example
 * ```ts
 * const seedAndGenerate = East.function([], FloatType, $ => {
 *     $(Random.seed(12345n));
 *     return Random.uniform();  // Will be reproducible
 * });
 * ```
 *
 * @remarks
 * - IMPORTANT: Seeding switches from cryptographically secure random to a deterministic
 *   PRNG (xorshift128+). This is essential for reproducible simulations but should not
 *   be used when cryptographic security is required.
 * - Same seed produces same sequence of random numbers
 * - Useful for testing and reproducible simulations
 */
export const random_seed = East.platform("random_seed", [IntegerType], NullType);


// Platform Function Implementations

const RandomImpl: PlatformFunction[] = [
    random_uniform.implement(() => {
        return uniformDist(globalRNG, 0, 1)();
    }),

    random_normal.implement(() => {
        return normalDist(globalRNG, 0, 1)();
    }),

    random_range.implement((min: bigint, max: bigint) => {
        if (min > max) {
            throw new EastError(`Invalid range: min (${min}) > max (${max})`, {
                location: [{ filename: "random_range", line: 0n, column: 0n }],
            });
        }
        try {
            return BigInt(uniformIntDist(globalRNG, min, max)());
        } catch (err: any) {
            throw new EastError(`Random range generation failed: ${err.message}`, {
                location: [{ filename: "random_range", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    random_exponential.implement((lambda: number) => {
        try {
            return exponentialDist(globalRNG, lambda)();
        } catch (err: any) {
            throw new EastError(`Random exponential generation failed: ${err.message}`, {
                location: [{ filename: "random_exponential", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    random_weibull.implement((shape: number) => {
        try {
            // Weibull = exponential() ^ (1/shape)
            const exp = exponentialDist(globalRNG, 1);
            return Math.pow(exp(), 1 / shape);
        } catch (err: any) {
            throw new EastError(`Random Weibull generation failed: ${err.message}`, {
                location: [{ filename: "random_weibull", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    random_bernoulli.implement((p: number) => {
        try {
            return BigInt(bernoulliDist(globalRNG, p)());
        } catch (err: any) {
            throw new EastError(`Random Bernoulli generation failed: ${err.message}`, {
                location: [{ filename: "random_bernoulli", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    random_binomial.implement((n: bigint, p: number) => {
        try {
            return BigInt(binomialDist(globalRNG, n, p)());
        } catch (err: any) {
            throw new EastError(`Random binomial generation failed: ${err.message}`, {
                location: [{ filename: "random_binomial", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    random_geometric.implement((p: number) => {
        try {
            return BigInt(geometricDist(globalRNG, p)());
        } catch (err: any) {
            throw new EastError(`Random geometric generation failed: ${err.message}`, {
                location: [{ filename: "random_geometric", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    random_poisson.implement((lambda: number) => {
        try {
            return BigInt(poissonDist(globalRNG, lambda)());
        } catch (err: any) {
            throw new EastError(`Random Poisson generation failed: ${err.message}`, {
                location: [{ filename: "random_poisson", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    random_pareto.implement((alpha: number) => {
        try {
            return paretoDist(globalRNG, alpha)();
        } catch (err: any) {
            throw new EastError(`Random Pareto generation failed: ${err.message}`, {
                location: [{ filename: "random_pareto", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    random_log_normal.implement((mu: number, sigma: number) => {
        try {
            return logNormalDist(globalRNG, mu, sigma)();
        } catch (err: any) {
            throw new EastError(`Random log-normal generation failed: ${err.message}`, {
                location: [{ filename: "random_log_normal", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    random_irwin_hall.implement((n: bigint) => {
        try {
            return irwinHallDist(globalRNG, n)();
        } catch (err: any) {
            throw new EastError(`Random Irwin-Hall generation failed: ${err.message}`, {
                location: [{ filename: "random_irwin_hall", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    random_bates.implement((n: bigint) => {
        try {
            return batesDist(globalRNG, n)();
        } catch (err: any) {
            throw new EastError(`Random Bates generation failed: ${err.message}`, {
                location: [{ filename: "random_bates", line: 0n, column: 0n }],
                cause: err
            });
        }
    }),

    random_seed.implement((seed: bigint) => {
        // Switch to seedable PRNG (xorshift128+) and set the seed
        // IMPORTANT: This disables cryptographic security for reproducible simulations
        globalRNG = new XorShift128RNG(seed);
    }),
];

/**
 * Grouped random platform functions.
 *
 * Provides random number generation and sampling operations for East programs,
 * including multiple probability distributions and collection sampling.
 *
 * @example
 * ```ts
 * import { East, FloatType, IntegerType } from "@elaraai/east";
 * import { Random } from "@elaraai/east-node-std";
 *
 * const rollDice = East.function([], IntegerType, $ => {
 *     return Random.range(1n, 6n);
 * });
 *
 * const compiled = East.compile(rollDice.toIR(), Random.Implementation);
 * const result = compiled();  // Random integer from 1 to 6
 * ```
 */
export const Random = {
    /**
     * Generates a uniform random float in the range [0.0, 1.0).
     *
     * Returns a uniformly distributed random floating-point number greater than or equal to 0.0
     * and strictly less than 1.0. Uses cryptographically secure random number generation.
     *
     * @returns A random float in [0.0, 1.0)
     *
     * @example
     * ```ts
     * const generateRandom = East.function([], FloatType, $ => {
     *     return Random.uniform();
     * });
     *
     * const compiled = East.compile(generateRandom.toIR(), Random.Implementation);
     * const result = compiled();  // e.g., 0.7234891234
     * ```
     */
    uniform: random_uniform,

    /**
     * Generates a random float from a standard normal distribution (mean=0, standard deviation=1).
     *
     * Returns a random floating-point number drawn from a normal (Gaussian) distribution
     * with mean 0.0 and standard deviation 1.0. Use multiplication and addition to scale
     * and shift to different mean/standard deviation.
     *
     * @returns A random float from N(0, 1)
     *
     * @example
     * ```ts
     * const generateNormal = East.function([], FloatType, $ => {
     *     const z = $.let(Random.normal());
     *     // Scale and shift: z * stddev + mean
     *     return z.multiply(2.5).add(10.0);  // N(10, 2.5)
     * });
     *
     * const compiled = East.compile(generateNormal.toIR(), Random.Implementation);
     * const result = compiled();  // e.g., 9.234 (from N(10, 2.5))
     * ```
     */
    normal: random_normal,

    /**
     * Generates a random integer in the range [min, max] (both endpoints inclusive).
     *
     * Returns a uniformly distributed random integer between min and max (both inclusive).
     * Uses cryptographically secure random number generation.
     *
     * @param min - The minimum value (inclusive)
     * @param max - The maximum value (inclusive, must be >= min)
     * @returns A random integer in [min, max]
     *
     * @throws {EastError} When min > max
     *
     * @example
     * ```ts
     * const rollDice = East.function([], IntegerType, $ => {
     *     return Random.range(1n, 6n);  // 1-6 inclusive
     * });
     *
     * const compiled = East.compile(rollDice.toIR(), Random.Implementation);
     * const result = compiled();  // e.g., 4n
     * ```
     */
    range: random_range,

    /**
     * Generates a random float from an exponential distribution.
     *
     * Returns a random floating-point number drawn from an exponential distribution
     * with rate parameter lambda (λ). The mean of the distribution is 1/λ.
     * Commonly used for modeling time between events in a Poisson process.
     *
     * @param lambda - Rate parameter (λ > 0), where mean = 1/λ
     * @returns A random float from Exp(λ)
     *
     * @throws {EastError} When lambda <= 0
     *
     * @example
     * ```ts
     * const waitTime = East.function([], FloatType, $ => {
     *     // Average wait time of 5 minutes (lambda = 0.2)
     *     return Random.exponential(0.2);
     * });
     *
     * const compiled = East.compile(waitTime.toIR(), Random.Implementation);
     * const result = compiled();  // e.g., 3.7 minutes
     * ```
     */
    exponential: random_exponential,

    /**
     * Generates a random float from a Weibull distribution.
     *
     * Returns a random floating-point number drawn from a Weibull distribution
     * with shape parameter k. Commonly used for modeling failure rates and lifetime distributions.
     *
     * @param shape - Shape parameter (k > 0). k=1 gives exponential, k>1 increases failure rate
     * @returns A random float from Weibull(k, 1)
     *
     * @throws {EastError} When shape <= 0
     *
     * @example
     * ```ts
     * const lifetime = East.function([], FloatType, $ => {
     *     // Shape=2 models wear-out failures
     *     return Random.weibull(2.0);
     * });
     *
     * const compiled = East.compile(lifetime.toIR(), Random.Implementation);
     * const result = compiled();  // e.g., 1.23
     * ```
     */
    weibull: random_weibull,

    /**
     * Generates a binary random outcome (0 or 1).
     *
     * Returns 0 or 1 based on success probability p. This models a single
     * Bernoulli trial, like a biased coin flip.
     *
     * @param p - Success probability (0 <= p < 1)
     * @returns 0 or 1 (as integer)
     *
     * @throws {EastError} When p < 0 or p >= 1
     *
     * @example
     * ```ts
     * const coinFlip = East.function([], IntegerType, $ => {
     *     // Fair coin: 50% chance of 1
     *     return Random.bernoulli(0.5);
     * });
     *
     * const compiled = East.compile(coinFlip.toIR(), Random.Implementation);
     * const result = compiled();  // e.g., 1n or 0n
     * ```
     */
    bernoulli: random_bernoulli,

    /**
     * Generates the number of successes in n independent Bernoulli trials.
     *
     * Returns an integer count of successes when performing n independent trials,
     * each with success probability p. Models scenarios like coin flips, pass/fail tests.
     *
     * @param n - Number of trials (integer > 0)
     * @param p - Success probability per trial (0 <= p < 1)
     * @returns Number of successes (integer in [0, n])
     *
     * @throws {EastError} When n <= 0, not an integer, or p < 0 or p >= 1
     *
     * @example
     * ```ts
     * const heads = East.function([], IntegerType, $ => {
     *     // Number of heads in 10 coin flips
     *     return Random.binomial(10n, 0.5);
     * });
     *
     * const compiled = East.compile(heads.toIR(), Random.Implementation);
     * const result = compiled();  // e.g., 6n
     * ```
     */
    binomial: random_binomial,

    /**
     * Generates the number of trials until the first success.
     *
     * Returns an integer representing the number of independent Bernoulli trials
     * needed to get the first success, where each trial has success probability p.
     * Models scenarios like "how many attempts until success?"
     *
     * @param p - Success probability per trial (0 < p < 1)
     * @returns Number of trials until first success (integer >= 1)
     *
     * @throws {EastError} When p <= 0 or p >= 1
     *
     * @example
     * ```ts
     * const attempts = East.function([], IntegerType, $ => {
     *     // Rolls until getting a 6 (p = 1/6)
     *     return Random.geometric(1.0 / 6.0);
     * });
     *
     * const compiled = East.compile(attempts.toIR(), Random.Implementation);
     * const result = compiled();  // e.g., 4n
     * ```
     */
    geometric: random_geometric,

    /**
     * Generates the number of events in a fixed interval from a Poisson process.
     *
     * Returns an integer count of events occurring in a fixed interval,
     * where events occur independently at a constant average rate λ (lambda).
     * Commonly used for modeling rare events, arrivals, or counts.
     *
     * @param lambda - Average rate of events (λ > 0)
     * @returns Number of events (integer >= 0)
     *
     * @throws {EastError} When lambda <= 0
     *
     * @example
     * ```ts
     * const customers = East.function([], IntegerType, $ => {
     *     // Average 3 customers per hour
     *     return Random.poisson(3.0);
     * });
     *
     * const compiled = East.compile(customers.toIR(), Random.Implementation);
     * const result = compiled();  // e.g., 2n
     * ```
     */
    poisson: random_poisson,

    /**
     * Generates a random float from a Pareto distribution (power law).
     *
     * Returns a random floating-point number drawn from a Pareto distribution
     * with shape parameter α (alpha). Models phenomena following power laws,
     * like wealth distribution, city sizes, or word frequencies.
     *
     * @param alpha - Shape parameter (α >= 0). Smaller α = heavier tail
     * @returns A random float from Pareto(α) (value >= 1.0)
     *
     * @throws {EastError} When alpha < 0
     *
     * @example
     * ```ts
     * const wealth = East.function([], FloatType, $ => {
     *     // Heavy-tailed distribution (80/20 rule)
     *     return Random.pareto(1.16);
     * });
     *
     * const compiled = East.compile(wealth.toIR(), Random.Implementation);
     * const result = compiled();  // e.g., 2.45
     * ```
     */
    pareto: random_pareto,

    /**
     * Generates a random float whose logarithm is normally distributed.
     *
     * Returns a random floating-point number from a log-normal distribution,
     * where ln(X) ~ N(μ, σ²). Commonly used for modeling multiplicative processes,
     * stock prices, or quantities that can't be negative.
     *
     * @param mu - Mean of underlying normal distribution
     * @param sigma - Standard deviation of underlying normal (must be > 0)
     * @returns A random float from LogNormal(μ, σ) (always positive)
     *
     * @example
     * ```ts
     * const stockPrice = East.function([], FloatType, $ => {
     *     // Log-normal with ln(X) ~ N(0, 0.2)
     *     return Random.logNormal(0.0, 0.2);
     * });
     *
     * const compiled = East.compile(stockPrice.toIR(), Random.Implementation);
     * const result = compiled();  // e.g., 1.15
     * ```
     */
    logNormal: random_log_normal,

    /**
     * Generates the sum of n independent uniform random variables.
     *
     * Returns the sum of n independent uniform(0,1) random variables.
     * This is the Irwin-Hall distribution. As n increases, approaches
     * normal distribution by Central Limit Theorem.
     *
     * @param n - Number of uniform variables to sum (integer >= 0)
     * @returns Sum of n uniform(0,1) random variables (float in [0, n])
     *
     * @throws {EastError} When n < 0 or not an integer
     *
     * @example
     * ```ts
     * const irwinHall = East.function([], FloatType, $ => {
     *     // Sum of 12 uniform variables
     *     return Random.irwinHall(12n);
     * });
     *
     * const compiled = East.compile(irwinHall.toIR(), Random.Implementation);
     * const result = compiled();  // e.g., 6.234 (approximately N(6, 1))
     * ```
     */
    irwinHall: random_irwin_hall,

    /**
     * Generates the average of n independent uniform random variables.
     *
     * Returns the average of n independent uniform(0,1) random variables.
     * This is the Bates distribution. Approaches normal distribution as
     * n increases (Central Limit Theorem).
     *
     * @param n - Number of uniform variables to average (integer > 0)
     * @returns Average of n uniform(0,1) random variables (float in [0, 1])
     *
     * @throws {EastError} When n <= 0 or not an integer
     *
     * @example
     * ```ts
     * const bates = East.function([], FloatType, $ => {
     *     // Average of 12 uniform variables (smoother than single uniform)
     *     return Random.bates(12n);
     * });
     *
     * const compiled = East.compile(bates.toIR(), Random.Implementation);
     * const result = compiled();  // e.g., 0.523 (approximately N(0.5, 1/144))
     * ```
     */
    bates: random_bates,

    /**
     * Seeds the global random number generator.
     *
     * Sets the seed for the random number generator, allowing reproducible random sequences.
     * All subsequent random operations will use this seeded RNG until a new seed is set
     * or the process restarts.
     *
     * @param seed - Seed value (integer)
     * @returns null
     *
     * @example
     * ```ts
     * const seedAndGenerate = East.function([], FloatType, $ => {
     *     $(Random.seed(12345n));
     *     return Random.uniform();  // Will be reproducible
     * });
     *
     * const compiled = East.compile(seedAndGenerate.toIR(), Random.Implementation);
     * const result = compiled();  // Same result every time with same seed
     * ```
     *
     * @remarks
     * IMPORTANT: Seeding switches from cryptographically secure random to a deterministic
     * PRNG (xorshift128+). Essential for reproducible simulations.
     */
    seed: random_seed,

    /**
     * Node.js implementation of random platform functions.
     *
     * Pass this to {@link East.compile} to enable random operations.
     */
    Implementation: RandomImpl,
} as const;

// Export RandomImpl for backwards compatibility
export { RandomImpl, XorShift128RNG };
