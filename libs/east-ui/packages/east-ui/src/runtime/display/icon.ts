/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Icon>` tag — see the export's JSDoc.
 */

import { Icon as IconFactory, type IconStyle } from "../../display/icon/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/**
 * Icon — a single Font Awesome glyph, addressed by `prefix` (fas solid, far
 * regular, fab brands) and `name`. It takes no children; everything is a flat
 * prop — the glyph identity plus `size` and `colorPalette` ({@link IconStyle}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Icon, HStack, UIComponentType } from "@elaraai/east-ui";
 *
 * const glyphs = East.function([], UIComponentType, _$ => (
 *     <HStack gap="4">
 *         <Icon prefix="fas" name="house" />
 *         <Icon prefix="fab" name="github" />
 *     </HStack>
 * ));
 * ```
 *
 * @remarks
 * Carries `Icon.Types` — the East data type and the style struct. Desugars to
 * `Icon.Root(options)`.
 */
export const Icon: JsxTag<IconStyle> & { Types: typeof IconFactory.Types } =
    Object.assign(optionsTag(IconFactory.Root), { Types: IconFactory.Types });
