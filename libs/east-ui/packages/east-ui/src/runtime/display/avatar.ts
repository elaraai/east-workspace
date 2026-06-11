/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Avatar>` tag — see the export's JSDoc.
 */

import { Avatar as AvatarFactory, type AvatarStyle } from "../../display/avatar/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/**
 * Avatar — a person or entity marker showing a profile image, or initials
 * derived from `name` as a fallback. It takes no children; everything is a flat
 * prop — `name`, `src`, `size`, and `colorPalette` for the initials backdrop
 * ({@link AvatarStyle}). Use `<AvatarGroup>` to overlap several into a cluster.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Avatar, HStack, UIComponentType } from "@elaraai/east-ui";
 *
 * const people = East.function([], UIComponentType, _$ => (
 *     <HStack gap="3">
 *         <Avatar name="John Doe" />
 *         <Avatar name="Jane Smith" colorPalette="blue" />
 *     </HStack>
 * ));
 * ```
 *
 * @remarks
 * Carries `Avatar.Types` — the East data type and the style struct. Desugars to
 * `Avatar.Root(options)`.
 */
export const Avatar: JsxTag<AvatarStyle> & { Types: typeof AvatarFactory.Types } =
    Object.assign(optionsTag(AvatarFactory.Root), { Types: AvatarFactory.Types });
