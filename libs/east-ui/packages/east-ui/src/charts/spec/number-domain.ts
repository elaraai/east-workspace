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
 * A numeric `[min, max]` as the wire holds it.
 *
 * @param domain - The bounds as written, or none
 * @returns The domain, or `none` without one
 */
export function numberDomainOf(domain: NumberDomainInput | undefined): ExprType<OptionType<NumberDomainType>> {
    return domain === undefined
        ? East.value(none, OptionType(NumberDomainType))
        : East.value(some({ min: domain[0], max: domain[1] }), OptionType(NumberDomainType));
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
