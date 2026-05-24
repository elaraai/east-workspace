/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, NullType, example } from "@elaraai/east";
import { Random } from "@elaraai/east-node-std";

export const randomUniform = example({
    keywords: ["random", "Random", "uniform", "distribution"],
    description: "Generate a uniform random number in [0, 1)",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const value = $.let(Random.uniform());
        return value.greaterEqual(0.0).and(() => value.less(1.0));
    }),
    inputs: [],
    returns: true,
});

export const randomNormal = example({
    keywords: ["random", "Random", "normal", "gaussian", "distribution"],
    description: "Generate a normally distributed random number",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const value = $.let(Random.normal());
        return value.notEqual(value.add(1.0));
    }),
    inputs: [],
    returns: true,
});

export const randomRange = example({
    keywords: ["random", "Random", "range", "integer", "bounded"],
    description: "Generate a random integer in [min, max]",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const value = $.let(Random.range(1n, 6n));
        return value.greaterEqual(1n).and(() => value.lessEqual(6n));
    }),
    inputs: [],
    returns: true,
});

export const randomExponential = example({
    keywords: ["random", "Random", "exponential", "distribution"],
    description: "Generate an exponentially distributed random number",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const value = $.let(Random.exponential(1.0));
        return value.greater(0.0);
    }),
    inputs: [],
    returns: true,
});

export const randomWeibull = example({
    keywords: ["random", "Random", "weibull", "distribution"],
    description: "Generate a Weibull distributed random number",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const value = $.let(Random.weibull(2.0));
        return value.greater(0.0);
    }),
    inputs: [],
    returns: true,
});

export const randomBernoulli = example({
    keywords: ["random", "Random", "bernoulli", "distribution", "coin flip"],
    description: "Generate a Bernoulli trial result (0 or 1)",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const value = $.let(Random.bernoulli(0.5));
        return value.greaterEqual(0n).and(() => value.lessEqual(1n));
    }),
    inputs: [],
    returns: true,
});

export const randomBinomial = example({
    keywords: ["random", "Random", "binomial", "distribution", "trials"],
    description: "Generate a binomial distributed random integer",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const value = $.let(Random.binomial(10n, 0.5));
        return value.greaterEqual(0n).and(() => value.lessEqual(10n));
    }),
    inputs: [],
    returns: true,
});

export const randomGeometric = example({
    keywords: ["random", "Random", "geometric", "distribution"],
    description: "Generate a geometrically distributed random integer",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const value = $.let(Random.geometric(0.5));
        return value.greaterEqual(1n);
    }),
    inputs: [],
    returns: true,
});

export const randomPoisson = example({
    keywords: ["random", "Random", "poisson", "distribution"],
    description: "Generate a Poisson distributed random integer",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const value = $.let(Random.poisson(3.0));
        return value.greaterEqual(0n);
    }),
    inputs: [],
    returns: true,
});

export const randomPareto = example({
    keywords: ["random", "Random", "pareto", "distribution", "power law"],
    description: "Generate a Pareto distributed random number",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const value = $.let(Random.pareto(2.0));
        return value.greaterEqual(1.0);
    }),
    inputs: [],
    returns: true,
});

export const randomLogNormal = example({
    keywords: ["random", "Random", "logNormal", "distribution"],
    description: "Generate a log-normally distributed random number",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const value = $.let(Random.logNormal(0.0, 1.0));
        return value.greater(0.0);
    }),
    inputs: [],
    returns: true,
});

export const randomIrwinHall = example({
    keywords: ["random", "Random", "irwinHall", "distribution"],
    description: "Generate an Irwin-Hall distributed random number in [0, n]",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const value = $.let(Random.irwinHall(12n));
        return value.greaterEqual(0.0).and(() => value.lessEqual(12.0));
    }),
    inputs: [],
    returns: true,
});

export const randomBates = example({
    keywords: ["random", "Random", "bates", "distribution"],
    description: "Generate a Bates distributed random number in [0, 1]",
    fn: East.asyncFunction([], BooleanType, ($) => {
        const value = $.let(Random.bates(12n));
        return value.greaterEqual(0.0).and(() => value.lessEqual(1.0));
    }),
    inputs: [],
    returns: true,
});

export const randomSeed = example({
    keywords: ["random", "Random", "seed", "reproducible", "deterministic"],
    description: "Seed the random number generator for reproducible results",
    fn: East.asyncFunction([], NullType, ($) => {
        $(Random.seed(42n));
    }),
    inputs: [],
});
