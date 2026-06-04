/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Display `<AvatarGroup>` tag — overlapping avatar cluster. Maps to `AvatarGroup.Root`. */

import { AvatarGroup as AvatarGroupFactory, type AvatarGroupOptions } from "../../display/avatar-group/index.js";
import { leaf, type JsxTag } from "../combinators.js";

/** `<AvatarGroup avatars={[…]} max={5} />` — avatar cluster (config-array prop). Maps to `AvatarGroup.Root`. */
export const AvatarGroup: JsxTag<AvatarGroupOptions & { avatars: Parameters<typeof AvatarGroupFactory.Root>[0] }> =
    leaf(AvatarGroupFactory.Root, "avatars");
