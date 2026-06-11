/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Trace>` tag — see the export's JSDoc.
 */

import { Trace as TraceFactory, type TraceOptions } from "../../display/trace/index.js";
import { leaf, type JsxTag } from "../combinators.js";

/**
 * Trace — a read-only inline heatmap of one or more measures over a shared
 * step axis, with a continuous now-line dividing measured past from predicted
 * future. Reach for it in a table cell next to a `<ChipRail>` (they share the
 * `density` cascade, so the rows line up) when a column needs to *show* a
 * measured-and-forecast trajectory at a glance rather than edit it.
 *
 * The `tracks` prop is a config array of `{ name, values }` rows; `now` is the
 * step index of the now-line (steps before it read as measured, the rest as
 * predicted); `scale` picks the colour encoding, `future` how predicted steps
 * read, and `axis` supplies optional per-step labels ({@link TraceOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Trace, UIComponentType } from "@elaraai/east-ui";
 *
 * const trend = East.function([], UIComponentType, _$ => (
 *     <Trace
 *         tracks={[
 *             { name: "A", values: [12, 14, 13, 18, 20, 22] },
 *             { name: "B", values: [40, 38, 35, 30, 28, 25] },
 *         ]}
 *         now={4}
 *         density="compact"
 *         scale="brand"
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `Trace.Types` — the East data type, the per-track struct, and the
 * scale / future enums. Desugars to `Trace.Root(tracks, options)`.
 */
export const Trace: JsxTag<TraceOptions & { tracks: Parameters<typeof TraceFactory.Root>[0] }> & { Types: typeof TraceFactory.Types } =
    Object.assign(leaf(TraceFactory.Root, "tracks"), { Types: TraceFactory.Types });
