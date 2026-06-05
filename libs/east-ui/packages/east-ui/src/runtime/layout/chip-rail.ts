/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<ChipRail>` tag — see the export's JSDoc.
 */

import { ChipRail as ChipRailFactory, type ChipRailOptions } from "../../layout/chip-rail/index.js";
import { container, type JsxTag } from "../combinators.js";
import type { ContainerChildrenType } from "../children.js";

/**
 * A single-line horizontal rail of compact chips, typically `<Tag>`s, joined
 * by an optional inline `separator`. Reach for it for filter facets, metadata
 * trails (Week / Region / Status), and breadcrumb-like step sequences. Choose
 * the `separator` (`line` / `dot` / `none`), the chip `density`, and the
 * `overflow` behaviour (e.g. `scroll` so a long rail scrolls horizontally);
 * options are flat ({@link ChipRailOptions}). The chips are the JSX children.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { ChipRail, Tag, UIComponentType } from "@elaraai/east-ui";
 *
 * const facets = East.function([], UIComponentType, _$ => (
 *     <ChipRail density="compact" separator="dot">
 *         <Tag>Observe</Tag>
 *         <Tag>Explain</Tag>
 *         <Tag>Decide</Tag>
 *         <Tag>Commit</Tag>
 *     </ChipRail>
 * ));
 * ```
 *
 * @remarks
 * Carries `ChipRail.Types` — the East data type, the style struct, and the
 * separator/overflow enums. Desugars to `ChipRail.Root(children, options)`.
 */
export const ChipRail: JsxTag<ChipRailOptions & { children?: ContainerChildrenType }> & { Types: typeof ChipRailFactory.Types } =
    Object.assign(container(ChipRailFactory.Root), { Types: ChipRailFactory.Types });
