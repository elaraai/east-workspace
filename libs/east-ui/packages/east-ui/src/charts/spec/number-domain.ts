/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A numeric `[min, max]` as an author writes it, and as the wire holds it
 * (east-workspace#1726): one scale for every track of a Trace, or every line
 * a Sparkline draws, and a Record's display columns' own.
 *
 * @packageDocumentation
 */

import { East, OptionType, none, some, type ExprType, type FloatType, type SubtypeExprOrValue } from "@elaraai/east";
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
