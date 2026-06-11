/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Skeleton>` tag — see the export's JSDoc.
 */

import { Skeleton as SkeletonFactory, type SkeletonOptions } from "../../feedback/skeleton/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/**
 * Shape-preserving loading placeholder — stands in for content that hasn't
 * arrived yet, holding the layout so it doesn't reflow when data lands. Pick a
 * `shape`: `text` (with `lines` for a paragraph block) or `rect` (with `width`
 * / `height` for an image, card, or button) and `count` to repeat a row.
 * Every option is a flat prop ({@link SkeletonOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Skeleton, VStack, UIComponentType } from "@elaraai/east-ui";
 *
 * const cardLoading = East.function([], UIComponentType, _$ => (
 *     <VStack gap="3" align="stretch">
 *         <Skeleton shape="rect" width="100%" height="120px" />
 *         <Skeleton shape="text" lines={2n} />
 *         <Skeleton shape="rect" width="96px" height="32px" />
 *     </VStack>
 * ));
 * ```
 *
 * @remarks
 * Carries `Skeleton.Types` — the East data type, the style struct, and the
 * shape enum. Desugars to `Skeleton.Root(options)`.
 */
export const Skeleton: JsxTag<SkeletonOptions> & { Types: typeof SkeletonFactory.Types } =
    Object.assign(optionsTag(SkeletonFactory.Root), { Types: SkeletonFactory.Types });
