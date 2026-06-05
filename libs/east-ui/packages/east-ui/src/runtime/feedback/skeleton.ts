/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Feedback `<Skeleton>` tag — shape-preserving loading placeholder. Maps to `Skeleton.Root`. */

import { Skeleton as SkeletonFactory, type SkeletonOptions } from "../../feedback/skeleton/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** `<Skeleton shape="text" lines={3n} />` — loading placeholder. Maps to `Skeleton.Root`. */
export const Skeleton: JsxTag<SkeletonOptions> & { Types: typeof SkeletonFactory.Types } =
    Object.assign(optionsTag(SkeletonFactory.Root), { Types: SkeletonFactory.Types });
