/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<AvatarGroup>` tag — see the export's JSDoc.
 */

import { AvatarGroup as AvatarGroupFactory, type AvatarGroupOptions } from "../../display/avatar-group/index.js";
import { leaf, type JsxTag } from "../combinators.js";

/**
 * AvatarGroup — an overlapping cluster of avatars for showing a small set of
 * people at a glance (assignees, collaborators, a team). The `avatars` prop is
 * a config array of per-avatar records (`name`, `src`, …); `max` caps how many
 * render before collapsing the rest into a `+N` overflow chip, and `size`/
 * `borderColor` style the stack ({@link AvatarGroupOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { AvatarGroup, UIComponentType } from "@elaraai/east-ui";
 *
 * const team = East.function([], UIComponentType, _$ => (
 *     <AvatarGroup
 *         avatars={[{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }, { name: "Dan" }, { name: "Eve" }]}
 *         max={3n}
 *         size="sm"
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `AvatarGroup.Types` — the East data type, the per-avatar item struct,
 * and the style struct. Desugars to `AvatarGroup.Root(avatars, options)`.
 */
export const AvatarGroup: JsxTag<AvatarGroupOptions & { avatars: Parameters<typeof AvatarGroupFactory.Root>[0] }> & { Types: typeof AvatarGroupFactory.Types } =
    Object.assign(leaf(AvatarGroupFactory.Root, "avatars"), { Types: AvatarGroupFactory.Types });
