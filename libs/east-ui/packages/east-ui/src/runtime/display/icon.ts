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
 * Icon — a single Font Awesome solid icon, addressed by `prefix` (`fas`, the
 * solid set — East UI draws no other, #1263) and `name`. It takes no children;
 * everything is a flat prop — the icon identity plus `size` and `colorPalette`
 * ({@link IconStyle}). Another prefix is refused at build.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Icon, HStack, UIComponentType } from "@elaraai/east-ui";
 *
 * const icons = East.function([], UIComponentType, _$ => (
 *     <HStack gap="4">
 *         <Icon prefix="fas" name="house" />
 *         <Icon prefix="fas" name="code-branch" />
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
