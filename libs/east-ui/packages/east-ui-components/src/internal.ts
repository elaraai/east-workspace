/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `@elaraai/east-ui-components/internal` — the building blocks this package's
 * renderers share, for the sibling renderer packages whose components are made
 * of the same parts: e3-ui-components' Plan (#1177), which moved out of this
 * package. Not an API for apps, and not held stable: an app renders through the
 * public entry, and a sibling renderer package moves with this one.
 *
 * @packageDocumentation
 */

// Formatting: a tick's spec and printers, and the theme's colour lookup.
export { formatDatePattern, tickFormatter, type TickFormat } from "./charts/spec/index.js";
export { resolveColor } from "./collections/shared/helpers.js";
// The review chrome's foot, and the decision column's width.
export { DECISION_WIDTH, ReviewFoot, type ReviewFootModel } from "./collections/shared/review.js";
// Row virtualization, and a paged source's windows: their scroll geometry
// (the window ledger), which of them are resident, and a key search's query
// as its `seek` asks it — the paged Plan's and the paged Sheet's (#577).
export { VIRTUALIZE_UNBOUNDED_AT, VirtualRows } from "./collections/virtual-rows.js";
export { windowedSourceOf, type WindowedSourceValue } from "./collections/windowed-source.js";
export {
    createLedger, documentHeight, elementAtOffset, elementsIn, isObserved, observeWindow, offsetOfElement,
    offsetOfWindow, rowsIn, slotHeight, windowAtOffset, type WindowLedger, type WindowMeasure,
} from "./collections/window-ledger.js";
export {
    DEFAULT_RESIDENCY, NO_RESIDENCY, advance, demandRange, isEmpty, pin, residentWindows, step, trim, unpinAll,
    type Residency, type ResidencyOptions,
} from "./collections/window-residency.js";
export { toSeekQuery, type SeekQueryValue } from "./collections/key-search/seek-query.js";
// Density, the drag grammar's IR veto, and its slot codecs.
export { DensityProvider } from "./contracts/density.js";
export { useIRCanDrop, type CanDropFn } from "./dnd/ir-can-drop.js";
export { dateTimeSlot, numberSlot, stringSlot } from "./dnd/slot-key.js";
// The editing session's parts.
export { HistoryBar } from "./editing/HistoryBar.js";
export { kindOfIssue, wholeEntryReadiness } from "./editing/draft.js";
export { type EditSource } from "./editing/use-edit-session.js";
// The Slice: its bound range, the brush, the rail's toolbar items, and density.
export { boundRangeDomain, boundRangeHistogram } from "./platform/slice/index.js";
export { BrushStrip } from "./slice/brush-strip.js";
export { SliceDensityContext } from "./slice/density.js";
export { railAffordanceKinds } from "./slice/rail-kinds.js";
export { HOST_RANK, useSliceToolbarItems } from "./slice/rail/index.js";
// The UI store, tracked reads, and the boundary a renderer's East calls run in.
export { getStore, initializeStore } from "./platform/state-runtime.js";
export { createTrackedRead } from "./reactive/tracked.js";
export { EastErrorBoundary } from "./reactive/error-display.js";
// Keyboard and sizing primitives.
export { radioGroupKey } from "./primitives/radio-group.js";
export { parseCssSize } from "./style/parse-size.js";
// The Plan's slot recipe: in the theme with every recipe, and its geometry measured against it.
export { planSlotRecipe } from "./theme/slot-recipes/plan.js";
