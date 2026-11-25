/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A numeric `[min, max]` as an author writes it, as the wire holds it, and
 * whether it can be drawn (east-workspace#1726): one scale for every track of
 * a Trace, or every line a Sparkline draws, and a Record's display columns'
 * own.
 *
 * @packageDocumentation
 */

import { East, FloatType, OptionType, lessFor, none, some, type ExprType, type SubtypeExprOrValue } from "@elaraai/east";
import { NumberDomainType } from "./types.js";

/**
 * A numeric `[min, max]` as an author writes it: each bound a Float or an
 * expression of one, as a Chart axis's numeric `domain` is.
 */
export type NumberDomainInput = readonly [SubtypeExprOrValue<FloatType>, SubtypeExprOrValue<FloatType>];

/**
 * A numeric `[min, max]` as the wire holds it: bounds written as numbers that draw no scale refused as it is built
 * ({@link drawsDomain}), and bounds an expression gives as they come.
 *
 * @param domain - The bounds as written, or none
 * @param subject - What is given the domain, as a refusal names it: `Trace`, or a Record's `Sheet: column "load"`
 * @param scale - What the domain is, as the refusal says it: `one scale for every track`
 * @returns The domain, or `none` without one
 * @throws {Error} When both bounds are written as numbers and draw no scale: one is no finite number, or the max is not past the min
 */
export function numberDomainOf(domain: NumberDomainInput | undefined, subject: string, scale: string): ExprType<OptionType<NumberDomainType>> {
    if (domain === undefined) return East.value(none, OptionType(NumberDomainType));
    const [min, max] = domain;
    if (typeof min === "number" && typeof max === "number" && !drawsDomain(min, max)) {
        throw new Error(`${subject} has the domain [${min}, ${max}] — ${scale} runs from its min to a max past it, both finite numbers`);
    }
    return East.value(some({ min, max }), OptionType(NumberDomainType));
}

const floatLess = lessFor(FloatType);

/**
 * Whether a domain's bounds draw one scale: both finite numbers, the max past the min — in East's order, which stands
 * NaN past every number, so the bounds are asked to be finite first. A domain they don't draw places nothing: each
 * track, or line, runs over its own min and max. The renderers read a domain so, and a factory refuses literal bounds
 * that don't draw.
 *
 * @param min - The domain's min
 * @param max - The domain's max
 * @returns Whether the domain draws
 * @internal
 */
export function drawsDomain(min: number, max: number): boolean {
    return Number.isFinite(min) && Number.isFinite(max) && floatLess(min, max);
}
