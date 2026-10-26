/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `@elaraai/east-ui-components/internal` — the building blocks this package's
 * renderers share, for the sibling renderer packages whose components are made
 * of the same parts: e3-ui-components' Plan (#1177), Sheet (#1179),
 * Flowchart (#1243) and Schematic (#1384), which moved out of this package.
 * Not an API for apps, and not held stable: an app
 * renders through the public entry, and a sibling renderer package moves with
 * this one.
 *
 * @packageDocumentation
 */

// Formatting: a tick's spec and printers, a date pattern's printer and reader,
// the theme's colour lookup, and a density's row heights.
export { formatDatePattern, parseDatePattern, tickFormatter, type TickFormat } from "./charts/spec/index.js";
export { resolveColor, useDensityHeights } from "./collections/shared/helpers.js";
// The review chrome's foot, its toolbar item, and the decision column's width.
export {
    DECISION_WIDTH, ReviewFoot, reviewToolbarItem, type ReviewFootLabels, type ReviewFootModel, type ReviewToolbarLabels,
    type ReviewToolbarOptions, type ReviewToolbarRanks,
} from "./collections/shared/review.js";
// Row virtualization, and a paged source's windows: their scroll geometry
// (the window ledger), which of them are resident, and a key search's query
// as its `seek` asks it — the paged Plan's and the paged Sheet's (#577).
// A row's measured height on the device-pixel grid the frame places its rows on — what a collection measures its rows'
// estimates from (#1398, CL8); and where the rows a collection draws as runs stand, which the frame anchors on (#1424).
export { VIRTUALIZE_UNBOUNDED_AT, VirtualRows, devicePixels, type RowRuns, type RowsViewport } from "./collections/virtual-rows.js";
// What scrolls a frame's rows, for a row taller than the view — an unloaded run — to draw what of it is in view, and
// which row shows at the top of the view, for the row that says something once there (#1398).
export { useRowsScroll, useRowsTop, type RowsScroll } from "./collections/rows-scroll.js";
export { snapshotOf, windowedSourceOf, type WindowedSourceValue } from "./collections/windowed-source.js";
export {
    createLedger, documentHeight, elementAtOffset, elementsIn, isObserved, observeWindow, offsetOfElement,
    offsetOfWindow, rowsIn, slotHeight, windowAtOffset, type WindowLedger, type WindowMeasure,
} from "./collections/window-ledger.js";
export {
    DEFAULT_RESIDENCY, NO_RESIDENCY, advance, demandRange, isEmpty, leftRun, pin, residentWindows, step, travelOf, trim, unpinAll,
    type Residency, type ResidencyOptions, type Travel,
} from "./collections/window-residency.js";
export { toSeekQuery, type SeekQueryValue } from "./collections/key-search/seek-query.js";
// A key search pick's hand-off of the keyboard to its host's view, once the match lands and the box has let it go (#1398).
export { createPickHandOff, usePickHandOff, type PickHandOff, type PickingSource } from "./collections/key-search/hand-off.js";
// Density, the drag grammar's IR veto, and its slot codecs.
export { DensityProvider, useDensity } from "./contracts/density.js";
export { useIRCanDrop, type CanDropFn } from "./dnd/ir-can-drop.js";
export { dateTimeSlot, numberSlot, stringSlot } from "./dnd/slot-key.js";
// The date field's parts and its conversions — the Sheet's date editor.
export { CompoundDateField, CompoundDateInput, CompoundDateSegment } from "./forms/input/date/index.js";
export { dateToCalendarDate, dateValueToDate } from "./forms/input/index.js";
// The editing session's parts: its bar, a draft's presentation and checks, and its words.
export { HistoryBar } from "./editing/HistoryBar.js";
export {
    CLEAN_DRAFT, kindOfIssue, normalizeDraft, presentDraft, raiseIssue, wholeEntryReadiness, type DraftPresentation,
} from "./editing/draft.js";
export { DRAFT_ISSUE_TEXT, SESSION_TEXT, type EditHistoryWord } from "./editing/messages.js";
export { type EditSource } from "./editing/use-edit-session.js";
// The Slice: its bound range, the brush, the rail's toolbar items, and density.
export { boundRangeDomain, boundRangeHistogram } from "./platform/slice/index.js";
export { BrushStrip } from "./slice/brush-strip.js";
export { SliceDensityContext } from "./slice/density.js";
export { railAffordanceKinds } from "./slice/rail-kinds.js";
export { HOST_RANK, useSliceToolbarItems } from "./slice/rail/index.js";
export { SliceRangeContent } from "./slice/range/index.js";
// The rail's field chip, for a result a host shows as one: a Find fix's, which its × clears (#1342); and its
// choice chips and quiet reset, for choices a host offers as the rail does: a Sheet's views, folded with its key search (#1345).
export { SliceChoiceGroup, SliceClearButton, SliceFieldChip, type SliceChoice } from "./slice/choice.js";
export { RecordSliceFieldEditor, RecordSliceSummary, RecordSlicesSummary, recordSliceNoun, useRecordSliceToolbarItems, useRecordSlicesToolbarItems } from "./slice/record/index.js";
// How the rail words a source's choice — `Status: Ready` — for a host that names choices as the rail's `Replaces …` does:
// the Sheet's line for a row its narrowing hides, naming the filters that hide it.
export { recordChoiceLabel } from "./slice/record/value.js";
// A record source's count, handed to its builder as soon as it lands, before its pages (#1398, problem 23).
export { useRecordSliceCount, type RecordSliceCount } from "./slice/record/count.js";
export { prepareRecordSliceSave, RecordSliceSaveNotice } from "./slice/record/save.js";
export { recordSliceWindow, recordSliceDomain, recordSliceWindowFits, setRecordSliceWindow, clearRecordSliceWindow } from "./slice/record/range.js";
// Whether a record Slice still holds its seed — its `initial`, written over by nothing — which a builder's restored view replaces;
// and where its narrowing's rows sit in the record, which of some rows — or of the record's own, by position — it holds, and where
// a key lands in the record's own order (#1349) — the Sheet's lens and its key search; and the cells of a series or a summary index its
// binding lists, counted and read, the rows of several of its record's keys in one read, and the revision its record is
// read at (#1039) — the Plan's events; a window of its record's own rows, by position — the Schematic's Find (#1404); and an
// area index's cells, counted and read, the bounds of a density raster's searches and the entries of some of their runs,
// and another record's rows under the keys the cells' and the runs' entries name — the Schematic's window and its details
// (#1393).
export {
    recordSliceSeeded, recordSlicePlace, recordSliceWithin, recordSliceWithinAt, recordSliceSeek, recordSliceCellRuns, recordSliceCellEntries,
    recordSliceCellJoins, recordSliceRows, recordSliceRevision, recordSlicePage, recordSliceBounds, recordSliceRunEntries, recordSliceRunJoins,
} from "./platform/slice/record.js";
// The UI store, tracked reads, and the boundary a renderer's East calls run in.
export { getStore, initializeStore, trackKey } from "./platform/state-runtime.js";
export { createTrackedRead, awaitTracked } from "./reactive/tracked.js";
export { PagedScan, SCAN_CONCURRENCY } from "./collections/paged-scan.js";
export { EastErrorBoundary } from "./reactive/error-display.js";
// Keyboard and sizing primitives, and a control's touch target on a coarse
// pointer — its halo, the row's widths kept (#346, #1221).
export { radioGroupKey } from "./primitives/radio-group.js";
export { parseCssSize } from "./style/parse-size.js";
export { coarseHitArea } from "./style/hit-area.js";
// The Plan's slot recipe: in the theme with every recipe, and its geometry measured against it.
export { planSlotRecipe } from "./theme/slot-recipes/plan.js";
// A slot recipe's styles made once for the theme and its variants: what a part drawn often reads (#1398, CL9).
export { useSlotStyles, type SlotStyles, type SlotVariants } from "./theme/slot-styles.js";
// The theme colour tokens a Schematic's colour may name (D14): what its Issues tab holds a colour to (#1391).
export { schematicColorTokens } from "./theme/slot-recipes/schematic.js";

// The Chooser: a searchable, sectioned single-choice list with reasons (#1322).
export { Chooser, type ChooserOption, type ChooserOptionState, type ChooserProps, type ChooserSection } from "./pick/chooser/index.js";

// Paged builder palettes reuse the Library face, its search box — finding within the tab alone, through its
// source's part of the rail (#1340, ruling 11) — and the shared bounded window plan; and a builder's own tab — the
// Schematic's Index (#1389) — its search box and its empty state.
export { LibraryCard, LibraryEmptyState, LibrarySearchBox } from "./collections/library/index.js";
// Its page — what a host whose figures swap with its rows waits on, the Calendar's Backlog count (#1424).
export { PagedLibrary, PAGED_LIBRARY_PAGE, type LibraryPageSource, type PagedLibrarySearch } from "./collections/library/paged.js";
// What a search of a record through its source's part reads, the rail's choices kept: a paged tab's, and the
// Schematic's Index's over a kind read by area (#1393).
export { pagedSearchFields, pagedSearchTarget, pagedSearchWhere, type PagedSearchTarget } from "./collections/library/paged-search.js";
export { SEARCH_DELAY_MS } from "./slice/record/index.js";
// A tab's count while a builder's rail narrows it: over resident cards, and over a paged record (#1339, #1341).
export { narrowedCount, pagedCount, type CountWords, type PagedCountSource } from "./collections/library/count.js";

// One way to show a read in flight or failed (#1398): the unloaded run and its placeholder shapes, the narrow
// layouts' placeholder card, the region wash, a failure said once — a row grid's line, a region's box — and an
// empty region said once in the line's slot, the reveal's one clock (CL4) — a builder's, around its frame, which its
// parts read where they show — their words, and the retained treatment's recipe parts; and the footer's one loading
// line with the rail's fit (CL3).
export {
    REVEAL_DELAY_MS, REVEAL_HOLD_MS, revealStep, useLoadingReveal, type RevealState, type RevealStep, type RevealTimings,
    LoadingReveal, useRevealed, type LoadingRevealProps,
    barShare, runRows, runView, type RunGeometry, type RunGroup, type RunSlot, type RunView,
    LoadingEmptyLine, LoadingFailedBox, LoadingFailedLine, LoadingWash, PlaceholderCard, PlaceholderShape, placeholderAlign,
    type LoadingEmptyLineProps, type LoadingFailedBoxProps, type LoadingFailedLineProps, type LoadingRetry, type LoadingWashProps, type PlaceholderCardProps,
    type PlaceholderKind, type PlaceholderShapeProps,
    UnloadedRun, type RunCell, type RunFailure, type RunGridCell, type UnloadedRunProps,
    loadingMessages, type LoadingMessages,
} from "./collections/loading/index.js";
export { retainedColumn, retainedRow } from "./theme/slot-recipes/loading.js";
export {
    FooterMore, LoadingLine, footerCut, loadingLineText, measureFooter, useFooterFit,
    type FooterMoreProps, type LoadingLineProps, type LoadingLineText, type LoadingLineValue,
} from "./layout/builder-frame/loading-line.js";
export { FOOTER_UNFIT, fitFooter, type FooterFit, type FooterFitInput, type LoadingLineForm } from "./layout/builder-frame/footer-fit.js";
