/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Stat>` tag — see the export's JSDoc.
 */

import { Stat as StatFactory, type StatStyle } from "../../display/stat/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/**
 * Stat — a headline-metric tile pairing a `label` with a formatted `value`, the
 * unit you reach for when a single number is the point of a panel (Revenue,
 * Users, Growth). It takes no children; everything is a flat prop — pass a
 * `format` ({@link Format}) to render the numeric value, `helpText` for
 * context, and `indicator` (up / down) for a trend arrow ({@link StatStyle}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Format, Stat, HStack, UIComponentType } from "@elaraai/east-ui";
 *
 * const metrics = East.function([], UIComponentType, _$ => (
 *     <HStack gap="8">
 *         <Stat label="Revenue" value={45231} format={Format.Currency({ currency: "USD", maximumFractionDigits: 0n })} />
 *         <Stat label="Growth" value={0.2336} format={Format.Percent({ maximumFractionDigits: 2n })} indicator="up" />
 *     </HStack>
 * ));
 * ```
 *
 * @remarks
 * Carries `Stat.Types` — the East data type and the style struct. Desugars to
 * `Stat.Root(options)`.
 */
export const Stat: JsxTag<StatStyle> & { Types: typeof StatFactory.Types } =
    Object.assign(optionsTag(StatFactory.Root), { Types: StatFactory.Types });
