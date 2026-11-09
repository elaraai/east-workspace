/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the Sheet's parts place and are handed (SB4): the parts the root builds from one shared state — the toolbar, the
 * grid, the footer, the loading facts, the history, the inspector's reads and gestures — and what a frame hands them: the
 * viewer's hidden columns, the drops, a host's grid and its rows, header, empty state and strip.
 *
 * @packageDocumentation
 */

import type { ComponentType, MouseEvent, ReactNode, RefObject } from "react";
import type { SystemStyleObject } from "@chakra-ui/react";
import type { EditIssue, HistoryAction, LandingAttributes, ToolbarItem } from "@elaraai/east-ui-components";
import type { PlaceholderKind, SlotStyles } from "@elaraai/east-ui-components/internal";
import type { SheetColumnIndex, SheetColumnMeta, SheetRegisterIndex } from "./model.js";
import type { SheetNotice } from "./sheet-types.js";
import type { SheetTransactions } from "./transactions.js";
import type { SheetDropHost } from "./drop.js";
import type { LinkCellContext } from "./cells/Cell.js";
import type { SheetActionHost } from "./actions/host.js";
import type { StripAction, StripModel } from "./Strip.js";
import type { SheetFooterProps } from "./Footer.js";
import type { DraftPresentation } from "./draft-state.js";
import type { SheetToolbarParts } from "./Toolbar.js";
import type { SheetCellValue, SheetRowValue, SheetSubRowValue } from "./values.js";

export type Styles = Record<string, Record<string, unknown>>;

/** What the element the grid is laid in carries: the attributes the rows' styles and the tests key on. */
export interface SheetRootFacts {
    /** A paged source with rows still to load. */
    partial: boolean;
    /** The copilot runs. */
    copilot: boolean;
    /** A narrowing is active. */
    lens: boolean;
    /** The open view tab, if any. */
    view: string | undefined;
    /** Rows slide after a gesture that folds or opens. */
    moving: boolean;
}

/**
 * What the frame places of a run of the app's optimiser (#1409, #1418): the
 * banner the result lands with, for its banners slot, and the landing — on
 * the frame's own root, whose attributes and styles draw the flares, the glow
 * and the totals' flash on the cells and the counts.
 */
export interface SheetOptimiseParts {
    /** The banner, for the frame's banners slot before the session's; nothing with no optimiser. */
    banner: ReactNode;
    /** The landing, for the frame's root: its ref, which the cascade is measured under, its attributes and its styles. */
    landing: { ref: RefObject<HTMLDivElement | null>; attributes: LandingAttributes; css: SystemStyleObject };
}

/**
 * What the sheet's parts place (SB4): everything the root builds before it
 * lays out, from one shared state — the store, the editing session, the
 * lens and the selection.
 */
export interface SheetParts {
    /** The sheet recipe's slot styles. */
    styles: Styles;
    /** What {@link SheetRoot} carries. */
    root: SheetRootFacts;
    /** The toolbar: its items, the same as parts (#1533), and the element the frame places them in. */
    toolbar: {
        items: ReadonlyArray<ToolbarItem | false | undefined>;
        parts: SheetToolbarParts;
        ref: RefObject<HTMLDivElement | null>;
    };
    /** The header, the rows and the strip: what {@link SheetGrid} places. */
    grid: ReactNode;
    /** The footer's props: today's footer, fed from the shared state. */
    footer: SheetFooterProps;
    /** How the frame shows a paged source being read (#1398): its cold load, a read in flight after it, and the rows' pitch. */
    loading: SheetLoadingFacts;
    /** The editing session and its history actions: what the frame's banners report, and what their Retry and Discard run. */
    history: SheetHistory;
    /** What shows in place of the whole sheet when its source failed before any row landed (#853). */
    failure: ReactNode | undefined;
    /** What the inspector pane reads of the sheet, and the gestures it makes (#1188). */
    inspect: SheetInspect;
    /** A library card's ⏎ (#1187, SB45): the card, by its library and its key, taken as a drop below the ring's row. Stable. */
    enter: (library: string, key: string) => void;
    /** What the frame places of a run of the app's optimiser (#1409). */
    optimise: SheetOptimiseParts;
    /** A phone's Library (`Mobile Sheet Spec.md` SH11). */
    phoneLibrary: SheetPhoneLibrary;
    /** What a host's own chrome counts of the rows and changes in them (#1533). */
    entries: SheetEntries;
}

/**
 * The rows as a host's own chrome counts and changes them (#1533) — the
 * Record's title, status line, Add, Delete and footer: the rows drawn, how
 * many the narrowing shows and the record holds, the last gesture's notice,
 * the gestures recorded, and a gesture that adds a row and one that removes
 * rows.
 */
export interface SheetEntries {
    /** The rows drawn, the drafts applied: the resident rows — under the lens, the narrowing's. */
    rows: readonly SheetRowValue[];
    /** Whether `rows` is every row the narrowing shows: inline rows, or a paged source or a lens with no run left to read. */
    whole: boolean;
    /** How many rows the narrowing shows, and how many the record holds — the drafts applied; `undefined` while not known. */
    count: { shown: number | undefined; total: number | undefined };
    /** What the last gesture left in the footer's line; `null` once a step of the history moved past it. */
    notice: SheetNotice | null;
    /** How many gestures have been recorded — a cell's write, an insert, a removal: it moves with each. */
    gestures: number;
    /**
     * Adds a row, one draft and one undo step: first in the rows where the rows keep an order, and where they are keyed
     * in its key's place — the app's `newKey`'s, else a UUID. The rail's search clears first, so the row is never
     * hidden; the ring lands on the row at `column` — the driver's, else its first editable column, by default — a
     * column that edits out of place opening where the host edits it, and any other its editor. The footer's notice
     * says so. Stable.
     */
    add: (column?: string) => void;
    /** Removes rows by id, one draft and one undo step; a new row is simply dropped, and the ring goes with its row. The footer's notice says how many. Stable. */
    remove: (ids: readonly string[]) => void;
}

/** What a phone's Library reads of the sheet, and the taps it makes (`Mobile Sheet Spec.md` SH11, R7). */
export interface SheetPhoneLibrary {
    /** What a tap on a card of a library acts on, as the hint names it: its row, or its band; `undefined` with nothing to act on. */
    targetOf: (library: string) => string | undefined;
    /** Whether a card of a library is what its target holds now: every cell it sets is there. */
    holds: (library: string, key: string) => boolean;
    /** A tap on a card: its cells set on its target, or a template added below the ring's row, as one transaction. */
    tap: (library: string, key: string) => void;
    /** Pages the window to a column, by the least it must. Stable. */
    goToColumn: (key: string) => void;
}

/**
 * How the frame shows a paged source being read (#1398, CL4, CL5) — what
 * `BuilderFrame` takes as `loading`, `busy` and `loadingPitch`
 * ({@link useSheetLoading}).
 */
export interface SheetLoadingFacts {
    /** Cold load: nothing of a paged source drawn yet, and no failure to say — the frame's skeleton covers it; `undefined` for an inline sheet, which has none. */
    cold: boolean | undefined;
    /** After cold load, a read in flight — a window, a narrowing's rows, the lens's stretch: the grid, the region being read, is busy. */
    busy: boolean;
    /** The rows' pitch, in px: the skeleton's rows draw at it, so it matches what it covers. */
    pitch: number;
}

/** The editing session as the frame reads it ({@link useSheetHistory}). */
export interface SheetHistory {
    /** The session: its status, its issues, its error and whether the source moved under its drafts. */
    session: SheetTransactions;
    /** Runs a history action as the history item does — an open editor commits first. */
    onAction: (action: HistoryAction) => void;
}

/**
 * What the frame hands the parts beside the payload (#1184): the viewer's
 * hidden columns, and the drops the sheet takes.
 */
export interface SheetHost {
    /**
     * The columns the grid leaves out, by key, and the band cells under them
     * (#1186) — a viewer's choice, never the sheet's: a new row still has
     * every declared cell. Hiding every column hides none.
     */
    hidden?: ReadonlySet<string> | undefined;
    /**
     * What the sheet takes dropped (#1187): the surface its rows register
     * on, a library's templates and an author's cards — and its rows' grips
     * move them. Absent, the sheet takes no drop and its rows have no grip.
     */
    drop?: SheetDropHost | undefined;
    /**
     * What the rail counts each source the frame's lists follow in, by the
     * source's name (#1345): a templates list's source, templates; an author's
     * tab's, its cards. A source with a label of its own is counted in that.
     */
    nouns?: ReadonlyMap<string, string> | undefined;
    /**
     * The app's optimiser (#1409): the binding of its `e3.function`, as the
     * payload holds it — what the Elara eye calls over the tab's rows. Absent,
     * the sheet has no eye.
     */
    optimise?: { readonly name: string } | undefined;
    /**
     * A phone's cell editor (`Mobile Sheet Spec.md` SH10, R9): what the bottom
     * container shows for the ring's cell — the inspector's form at touch size,
     * that cell's field — in the docked strip's place. Absent, or answering
     * `undefined` for a cell its form has no field for, the strip shows. A
     * host's grid asks it for no cell that steps in place or opens where the
     * host edits it.
     */
    cellEditor?: ((at: SheetCellEditorAt) => ReactNode | undefined) | undefined;
    /**
     * What draws the grid's rows and header in the Sheet's place (#1531) — the Record's, in the Table's anatomy, over
     * the Sheet's one machine, session and lens. Such a grid opens with no ring, which a press or the first move key
     * places; its cycles, toggles and booleans step in place, and a title opens through `onOpen`, or with none edits
     * in its cell; its strip shows the cell under the pointer, and the ring's once the pointer leaves; and it has no
     * gutter — no row numbers, seams, insertion strip or padding under the rows. On a phone's frame it is the Sheet's
     * (#1536): its lead goes as the gutter does, the column the sheet's `narrow.pin` names is held at the left, and the
     * pager pages the rest — its rows and its header told so ({@link SheetHostLayout}), and its header which columns
     * are in view as the window pages ({@link SheetColumnWindow}). Absent, the Sheet draws its own.
     */
    grid?: SheetGridHost | undefined;
    /**
     * Told of each step of the history as the history item, a key or a banner asks for it (#1533) — before it is
     * taken, the session as it stands, so a host can read what the step will take back or replay (`nextUndo`,
     * `nextRedo`, the drafts an Apply sends). What it answers is called once the step is taken: an Apply's once its
     * request has been answered, the session then saying how. Absent, nothing is told.
     */
    onHistory?: ((action: HistoryAction, session: SheetTransactions) => (() => void) | undefined) | undefined;
}

/**
 * What a row's drafts changed against what the record holds (#1531): whether it is new, the columns whose cells
 * differ, the cells the record holds, and how many fields the drafts change.
 */
export interface SheetRowChanges {
    /** A new row, never applied. */
    added: boolean;
    /** The columns, by key, whose cells differ from what the record holds — none on a new row. */
    dirty: ReadonlySet<string>;
    /** The cells the record holds for the row: what a changed cell was — none on a new row. */
    held: ReadonlyMap<string, SheetCellValue> | undefined;
    /** How many of the row's fields its drafts change, a field no column shows among them — none on a new row. */
    fields: number;
    /**
     * A new row's fields still missing, by name — what a person must fill before Save: never an option, which is none
     * unset, nor a field a column from data writes, which starts at its type's default. None on a row the record holds.
     */
    missing: ReadonlySet<string>;
}

/**
 * A row-space row a host draws ({@link SheetGridHost.Row}, #1531): its cells, the ring's column, the range, the open
 * editor and its draft, with the Sheet's own pointer calls — so a press, a double press and a hover are the Sheet's
 * gestures, whatever draws them.
 */
export interface SheetHostRowProps {
    /** The sheet recipe's slot styles: what a cell's content draws with. */
    styles: Styles;
    /** Its row-space index. */
    r: number;
    /** The row; `undefined` for a blank padding row. */
    row: SheetRowValue | undefined;
    /** The columns the grid draws. */
    columns: SheetColumnIndex;
    /** The registers, by name. */
    registers: SheetRegisterIndex;
    /** The driver column's key: a quantity's unit is its driver member's. */
    driverColumn: string | undefined;
    /** The rows' tracks: the host's lead, where it is laid out, then each column's. */
    gridTemplate: string;
    /** How the grid lays the row out: its lead's track, and a phone's frame. */
    layout: SheetHostLayout;
    /** Its height, px, the rule included. */
    rowPx: number;
    /** The grid's id: a cell's id is `{idPrefix}-{r}-{c}`, what the grid names as its active cell. */
    idPrefix: string;
    /** Its place among the grid's rows, the header first. */
    ariaRowIndex: number | undefined;
    /** The ring's column on the ring's row; `undefined` elsewhere, and while no ring is placed. */
    selC: number | undefined;
    /** The range's columns on a row inside it. */
    range: { c0: number; c1: number } | undefined;
    /** The open editor on its row: its column, and the element laid over the cell. */
    editor: { c: number; node: ReactNode } | undefined;
    /** How its draft presents. */
    draft: DraftPresentation | undefined;
    /** What its drafts changed; `undefined` for a row no gesture has touched. */
    changes: SheetRowChanges | undefined;
    /** Whether a gesture may be made now: the sheet writable, and its session taking one. */
    writable: boolean;
    /** A link cell's halves, vocabulary and flags. */
    linkCtx: (row: SheetRowValue | undefined, meta: SheetColumnMeta) => LinkCellContext | undefined;
    /** What its action cells ask of the sheet; absent with no action column. Stable. */
    actions: SheetActionHost | undefined;
    onCellDown: (r: number, c: number, e: MouseEvent) => void;
    onCellDouble: (r: number, c: number) => void;
    onCellEnter: (r: number, c: number) => void;
}

/** The header a host draws over its rows ({@link SheetGridHost.Header}, #1531). */
export interface SheetHostHeaderProps {
    /** The columns the grid draws. */
    columns: readonly SheetColumnMeta[];
    /** The rows' tracks: the host's lead, where it is laid out, then each column's. */
    gridTemplate: string;
    /** How the grid lays the header out: its lead's track, and a phone's frame. */
    layout: SheetHostLayout;
    /** A row's height, px: the header row's. */
    rowPx: number;
    /** The rows shown, by id: the resident rows, in order. */
    rowIds: readonly string[];
    /** A phone's window of columns as it pages (#1536): which are in view; `undefined` off a phone, where every one is. */
    columnWindow: SheetColumnWindow | undefined;
}

/**
 * A phone's window of columns as it rests (`Mobile Sheet Spec.md` SH1, #1536): the first in view among the columns the
 * pager pages — every one but a pinned one — how many show at once, and a column's slot.
 */
export interface SheetColumnWindow {
    /** The first column in view, counted among the paged columns. */
    first: number;
    /** How many columns show at once. */
    inView: number;
    /** A column's slot, px: the frame's width less the pinned column, shared by those in view. */
    slotPx: number;
}

/**
 * How the grid lays a host's rows and header out (#1536): whether its lead has a track, and a phone's frame
 * (`Mobile Sheet Spec.md`) — its columns a window the pager pages, any column the sheet's `narrow.pin` names held at
 * the left. One object while it holds, so no row's memo sees it change.
 */
export interface SheetHostLayout {
    /** Whether the lead track is laid out: the host's lead, where it has one — never on a phone's frame, as the gutter is not (R5). */
    lead: boolean;
    /** A phone's frame: the columns a window of slots, which the pager pages (SH1). */
    phone: boolean;
    /** The width of the column a phone's frame holds at the left, px — the first column; `0` with none (SH4). */
    pinPx: number;
}

/** What a host shows when the narrowing leaves no row to show ({@link SheetGridHost.Empty}, #1531). */
export interface SheetHostEmptyProps {
    /** The rail's search narrows the rows — else its filters alone. */
    query: boolean;
    /** Clears what narrows them: the search, else the filters. */
    onClear: () => void;
}

/** The cell a host's strip speaks of ({@link SheetHostStripProps.at}, #1533): its row, its column and what its drafts changed. */
export interface SheetHostStripCell {
    /** Its row-space index. */
    r: number;
    /** Its row. */
    row: SheetRowValue;
    /** Its column. */
    column: SheetColumnMeta;
    /** What the row's drafts changed; `undefined` for a row no gesture has touched. */
    changes: SheetRowChanges | undefined;
}

/**
 * The strip a host draws under its rows ({@link SheetGridHost.Strip}, #1533): the Sheet's own strip as it stands, and
 * the cell the host's words would speak of.
 */
export interface SheetHostStripProps {
    /** The sheet recipe's slot styles: what the Sheet's own strip draws with. */
    styles: Styles;
    /** The Sheet's own strip as it stands: an editor's, a suggestion's, an action's, a cell's detail — or off. */
    model: StripModel;
    /** A chip of the Sheet's strip, taken. */
    onAction: (action: StripAction) => void;
    /** Whether the Sheet's strip speaks of what is in hand — an open editor, a range, a suggestion, an action: the host draws it then. */
    own: boolean;
    /** The cell under the pointer, else the ring's — `undefined` with neither, and over a row that is not drawn yet. */
    at: SheetHostStripCell | undefined;
    /** The columns the grid draws. */
    columns: SheetColumnIndex;
    /** The registers, by name. */
    registers: SheetRegisterIndex;
    /** Whether a gesture may be made now: the sheet writable, and its session taking one. */
    writable: boolean;
}

/**
 * A host's grid ({@link SheetHost.grid}, #1531): its rows' pitch and lead, and what draws its rows, its header and,
 * when the narrowing leaves nothing to show, its empty state — over the Sheet's machine, session, lens and paging.
 */
export interface SheetGridHost {
    /** A row's height, px, the rule included: the host's density's. */
    rowPx: number;
    /** The lead track before the columns, px — a Record's select column; `0` for none. */
    leadPx: number;
    /** What a run of rows not drawn yet shows in the lead track: a select column's box. */
    leadRun: PlaceholderKind;
    /** The slot styles a run of rows not drawn yet draws with — `run`, `runRow`, `runGutter` (the lead), `runCell`, `runActionCell`. */
    runStyles: SlotStyles;
    /** Draws a row-space row. */
    Row: ComponentType<SheetHostRowProps>;
    /** Draws the header over the rows: it sticks with them. */
    Header: ComponentType<SheetHostHeaderProps>;
    /** Shown under the header when the narrowing leaves no row to show; absent, nothing is. */
    Empty?: ComponentType<SheetHostEmptyProps> | undefined;
    /**
     * Draws the strip docked under the rows in the Sheet's place (#1533): the host's words for the cell it is over, or
     * for none, and the Sheet's own strip while it speaks of what is in hand. Absent, the Sheet's. A phone's action bar
     * and cell editor take the strip's place either way.
     */
    Strip?: ComponentType<SheetHostStripProps> | undefined;
    /**
     * A press, ⏎ or F2 on a cell that edits out of place — a title: the host opens it where it edits it. Absent, a title
     * edits in its cell, as a text does.
     */
    onOpen?: ((r: number, columnKey: string) => void) | undefined;
}

/** The cell a phone's bottom container edits ({@link SheetHost.cellEditor}). */
export interface SheetCellEditorAt {
    /** Its row-space row: a row, a line or a band. */
    r: number;
    /** Its column's key — on a band, its band cell's. */
    columnKey: string;
    /** On a group's band: its group's form. */
    band: boolean;
    /** How the row names itself where an action column names it — `step 10 · Cut tube stock`, as its action bar's head does; else `undefined`. */
    name: string | undefined;
    /** ⌄ close: the container goes until a cell is pressed again. */
    onClose: () => void;
}

/**
 * Where a row, a line or a band the inspector pane shows stands (#1188):
 * its place, its number, its group and its sub rows — all read off the
 * body, never from the source.
 */
export interface SheetInspectPlace {
    /** Its row-space index. */
    r: number;
    /** A flat or loose row, a group's line, or a group's band. */
    kind: "row" | "line" | "band";
    /** The entry it is — a line's, its group's. */
    entry: string;
    /** A line's key in its group. */
    child: string | undefined;
    /** A line's place among its group's lines — what an issue addresses it by. */
    index: number | undefined;
    /** Its wire row: a row's or a band's group row, or a line's cells as a row. */
    row: SheetRowValue;
    /** Its number: a row's in the sheet, a line's in its group, a band's group's. */
    number: number;
    /** A line's group, or a band's own: its title and its line count. */
    group: { title: string | undefined; lines: number } | undefined;
    /** Owned upstream: its stamped cells are read only. */
    owned: boolean;
    /** The read-only rows under it (#844). */
    subRows: readonly SheetSubRowValue[];
}

/**
 * A row, a line or a band the inspector pane shows (#1188): its place,
 * its draft as its struct's values, what the record holds, and how its draft
 * presents — the source's entry read once while the resident rows stand.
 */
export interface SheetInspectTarget extends SheetInspectPlace {
    /** Its draft as its struct's values, by field: a field's value, `undefined` while it is missing or unreadable; `undefined` while its entry is not read yet. */
    value: Readonly<Record<string, unknown>> | undefined;
    /** What the record holds for it, as `value` holds the draft — `undefined` for a row never applied. */
    baseline: Readonly<Record<string, unknown>> | undefined;
    /** Its complete value — every field given and read — or `undefined` until it is: what an author's inspector is given (SB58). */
    complete: unknown;
    /** How its draft presents: pending, never applied, and its issues by field. */
    presentation: DraftPresentation;
}

/** What the ring and the range select, as the inspector shows it (SB47–SB51): one place — its target read by {@link SheetInspect.targetAt} — or several rows, or nothing. */
export type SheetSelected =
    | { kind: "none" }
    | { kind: "one"; place: SheetInspectPlace }
    | { kind: "several"; rs: readonly number[]; r0: number; r1: number };

/** How a host's Duplicate makes its copies ({@link SheetInspect.duplicate}, #1534) — a Record's: its title left empty, the ring on it. */
export interface SheetDuplicateOptions {
    /** A field each copy leaves empty: missing on its draft, and blank under the column over it, which its key names — a Record's title. */
    empty?: string | undefined;
    /** The column the ring lands on in the first copy, once the body holds it: a cell that edits out of place opens where the host edits it, as a host's Add's does. */
    ring?: string | undefined;
}

/** One row's write from the inspector — beside the others, one transaction (SB52). */
export interface SheetInspectWrite {
    /** The row-space row it lands on: a row, a line, or a band. */
    r: number;
    /** Cells by column key (a band's: by band cell key), as the grid writes them. */
    cells?: ReadonlyMap<string, SheetCellValue> | undefined;
    /** Text by column key, read as typing in the cell reads it — a custom column's. */
    texts?: ReadonlyMap<string, string> | undefined;
    /** Fields no column shows, by name: their new values, set on the draft. */
    fields?: ReadonlyMap<string, unknown> | undefined;
}

/** What the inspector pane reads of the sheet, and the gestures it makes (#1188). */
export interface SheetInspect {
    /** What the ring and the range select. */
    selected: SheetSelected;
    /** The target at a row-space index, if one stands there: its draft, what the record holds, and how it presents — the one call that reads the source. */
    targetAt: (r: number) => SheetInspectTarget | undefined;
    /** A gesture may be made now: the sheet is writable and its session takes one. */
    writable: boolean;
    /** Whether rows (a grouped sheet's lines), groups may be inserted, and rows removed. */
    can: { insertRows: boolean; insertGroups: boolean; removeRows: boolean; removeGroups: boolean };
    /** The sheet's rows (not blank padding), the entries its drafts change, and the batch's issues. */
    counts: { rows: number; pending: number; issues: number };
    /** Every issue of the batch: the drafts' and the author's checks', then an Apply's conflicts and refusals. */
    issues: readonly EditIssue[];
    /** What an issue refuses its entry for: a field still missing, or one refused — an Apply's conflicts and refusals among them. */
    kindOf: (issue: EditIssue) => "incomplete" | "invalid";
    /**
     * Write rows: every cell, text and field as one transaction, the copilot asked again for a row whose trigger column
     * changed. A write that `joins` the last one — given the same key — is one step of the history with it. Each cell
     * asks the grid's one check (#1560): a cell its mark locks takes none, nor one with no blank a clear (#1561).
     */
    write: (writes: readonly SheetInspectWrite[], joins?: string) => void;
    /** Put the ring on a row's cell under a column the grid shows, and focus the grid; `false` when the grid does not show it. */
    editInSheet: (r: number, key: string) => boolean;
    /** Delete the rows (or lines) from `r0` to `r1`, as ⌫ on them does. */
    remove: (r0: number, r1: number) => void;
    /** Duplicate rows, lines or bands — a band with its lines — each just after its source, as one transaction; a host's copies as its options say. Returns whether the session recorded it. */
    duplicate: (rs: readonly number[], options?: SheetDuplicateOptions) => boolean;
    /** Add a line at the end of the band's group. */
    addLine: (bandR: number) => void;
    /** Delete a band's group with its lines, as one transaction. */
    removeGroup: (bandR: number) => void;
    /** The column — on a band, the band cell — a key names at a row. */
    columnAt: (r: number, key: string) => SheetColumnMeta | undefined;
    /** The cell under a column at a row. */
    cellAt: (r: number, key: string) => SheetCellValue | undefined;
    /** What a row's drafts changed against what the record holds, as the grid tints its cells by it (#1561); `undefined` for a row no gesture has touched, and for a line or a band. */
    changesAt: (r: number) => SheetRowChanges | undefined;
    /** A quantity's unit at a row: its driver member's. */
    unitAt: (r: number, key: string) => string | undefined;
    /** A date column's level at a row (#844). */
    levelAt: (r: number, key: string) => "week" | "day" | "range" | "time" | undefined;
    /** The register members a column's options rule offers a row; `undefined` offers every one. */
    allowedAt: (r: number, key: string) => ReadonlySet<string> | undefined;
    /** A cell drawn as the grid draws it — a link's halves and their chips. */
    drawCell: (r: number, key: string) => ReactNode;
    /** An action field as Details draws it (#1478): its state, the cases its row is offered, and a choice's or a form's inline. */
    drawAction: (r: number, key: string) => ReactNode;
    /** Go to an issue's cell — seeking its row on a paged sheet, and, where the rail's filters hide it, clearing them (the hidden pick). */
    goToIssue: (issue: EditIssue) => void;
    /** What an issue's line says of its row while the rail's filters hide it — which, once e3 has said — or `undefined` while they do not, or it is not yet known. */
    hiddenNote: (issue: EditIssue) => string | undefined;
    /** Ask e3 whether the rail's filters hide the rows of some issues the sheet does not draw, and by which: what their lines then say. */
    askHidden: (issues: readonly EditIssue[]) => void;
    /** Where an issue's row stands among the rows drawn — a line by its place in its group — or `undefined` where the sheet does not draw it: hidden by the narrowing, or not read yet (#1534). */
    placeOf: (issue: EditIssue) => SheetInspectPlace | undefined;
}
