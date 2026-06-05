/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Tag>` tag — see the export's JSDoc.
 */

import { Tag as TagFactory } from "../../display/tag/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/**
 * Tag — a keyword or filter chip, typically operator-set: a category, a facet,
 * or an applied filter. Set `closable` to add a removable × affordance and wire
 * `onClose` to react when it is dismissed. The chip text is the child; the
 * visual treatment (outline, brand, subtle, solid, dashed) plus colour, opacity,
 * border, and box-model escape hatches are flat props ({@link TagStyle}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Tag, HStack, UIComponentType } from "@elaraai/east-ui";
 *
 * const filters = East.function([], UIComponentType, _$ => (
 *     <HStack gap="2">
 *         <Tag closable={true} variant="brand">region · SE</Tag>
 *         <Tag closable={true} variant="brand">status · active</Tag>
 *         <Tag variant="dashed">+ add filter</Tag>
 *     </HStack>
 * ));
 * ```
 *
 * @remarks
 * Carries `Tag.Types` — the East data type, the style struct, and the variant
 * enum. Desugars to `Tag.Root(label, options)`.
 */
export const Tag: JsxTag<ContentProps<typeof TagFactory.Root>> & { Types: typeof TagFactory.Types } =
    Object.assign(content(TagFactory.Root), { Types: TagFactory.Types });
