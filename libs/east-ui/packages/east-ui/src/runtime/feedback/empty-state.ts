/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<EmptyState>` tag — see the export's JSDoc.
 */

import { EmptyState as EmptyStateFactory, type EmptyStateOptions } from "../../feedback/empty-state/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/**
 * Zero-state placeholder — fills the space where a list, table, or panel would
 * be when there is nothing to show, and tells the user why and what to do next.
 * Use it for no-results, nothing-created-yet, and error states. `title` and
 * `description` carry the message, a `glyph` (mono text) or `icon` sets the
 * visual anchor, and `actions` offers the recovery affordance (clear filters,
 * create the first item, retry). Every option is a flat prop
 * ({@link EmptyStateOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { EmptyState, Button, UIComponentType } from "@elaraai/east-ui";
 *
 * const noResults = East.function([], UIComponentType, _$ => (
 *     <EmptyState
 *         title="No results"
 *         glyph="·   ·   ·"
 *         description="Try clearing filters or broadening your search."
 *         actions={<Button variant="outline">Clear filters</Button>}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `EmptyState.Types` — the East data type and the style struct.
 * `title` / `description` / `actions` accept a string (coerced to `<Text>`) or
 * any UI node. Desugars to `EmptyState.Root(options)`.
 */
export const EmptyState: JsxTag<EmptyStateOptions> & { Types: typeof EmptyStateFactory.Types } =
    Object.assign(optionsTag(EmptyStateFactory.Root), { Types: EmptyStateFactory.Types });
