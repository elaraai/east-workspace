/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Typography tag for a single formatted number — a KPI, percent, currency
 * amount, unit-bearing quantity, or timestamp. Pair it with a `Format`
 * descriptor for locale-aware rendering and `sentiment` for tone colouring.
 */

import { Numeric as NumericFactory } from "../../typography/numeric/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/**
 * Numeric — one formatted numeric value. The number is the `value` prop
 * (not a child); `format` (a `Format.*` descriptor — currency, percent,
 * compact, unit, scientific, date/time) controls rendering, and
 * `sentiment`/`showSign`/`textStyle` tune tone and size, all flat props
 * ({@link NumericStyle}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Numeric, Format, UIComponentType } from "@elaraai/east-ui";
 *
 * const delta = East.function([], UIComponentType, _$ => (
 *     <Numeric
 *         value={-0.12}
 *         format={Format.Percent({ maximumFractionDigits: 0n, signDisplay: "exceptZero" })}
 *         sentiment="negative"
 *         showSign
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `Numeric.Types` — the East data type and style struct. The
 * `value` prop is the positional `value` argument folded onto the JSX
 * surface. Desugars to `Numeric.Root(value, options)`.
 */
export const Numeric: JsxTag<ValueProps<typeof NumericFactory.Root, "value">> & { Types: typeof NumericFactory.Types } =
    Object.assign(leaf(NumericFactory.Root, "value"), { Types: NumericFactory.Types });
