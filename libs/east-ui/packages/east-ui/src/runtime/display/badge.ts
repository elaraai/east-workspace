/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Badge>` tag — see the export's JSDoc.
 */

import { Badge as BadgeFactory } from "../../display/badge/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/**
 * Badge — a compact status or taxonomy pill for terse, inline labels such as
 * NEW, BETA, a status hue, or a count callout. Use it to annotate an item with
 * a single word or short number, not to carry running prose. The label text is
 * the child; visual treatment is chosen by `variant` (outline, brand, the
 * status hues ok/warn/danger, count, callout) with colour, opacity, border, and
 * box-model escape hatches as flat props ({@link BadgeStyle}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Badge, HStack, UIComponentType } from "@elaraai/east-ui";
 *
 * const markers = East.function([], UIComponentType, _$ => (
 *     <HStack gap="2">
 *         <Badge variant="brand">Beta</Badge>
 *         <Badge variant="ok">OK</Badge>
 *         <Badge variant="count">17</Badge>
 *     </HStack>
 * ));
 * ```
 *
 * @remarks
 * Carries `Badge.Types` — the East data type, the style struct, and the variant
 * enum. Desugars to `Badge.Root(label, options)`.
 */
export const Badge: JsxTag<ContentProps<typeof BadgeFactory.Root>> & { Types: typeof BadgeFactory.Types } =
    Object.assign(content(BadgeFactory.Root), { Types: BadgeFactory.Types });
