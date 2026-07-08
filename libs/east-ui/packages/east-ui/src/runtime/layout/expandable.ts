/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Expandable>` tag — see the export's JSDoc.
 */

import { Expandable as ExpandableFactory } from "../../layout/expandable/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/**
 * Lets its single child region expand in place to fill the app container —
 * the whole window the app renders in — and collapse back into the layout.
 * Reach for it when one dense region (a chart, a schedule, a board) deserves
 * the full window while the user works in it. The content keeps its identity
 * across the toggle (CSS takeover, not an overlay), so scroll, selection,
 * and drag state survive. A floating control in the region's top-right
 * toggles it; Esc collapses the topmost expanded region. Drive it from state
 * with `expanded` + `onExpandedChange`, or omit both for local toggling;
 * `label` names the control for assistive tech.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Box, Expandable, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const region = East.function([], UIComponentType, _$ => (
 *     <Expandable label="Schedule">
 *         <Box padding="3" background="bg.surface">
 *             <Text>Dense chart region — expand me</Text>
 *         </Box>
 *     </Expandable>
 * ));
 * ```
 *
 * @remarks
 * Carries `Expandable.Types` — the East data type and style struct. Desugars
 * to `Expandable.Root(content, options)`.
 */
export const Expandable: JsxTag<ContentProps<typeof ExpandableFactory.Root>> & { Types: typeof ExpandableFactory.Types } =
    Object.assign(content(ExpandableFactory.Root), { Types: ExpandableFactory.Types });
