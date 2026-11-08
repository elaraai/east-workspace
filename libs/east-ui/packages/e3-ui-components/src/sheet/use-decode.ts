/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Sheet's decoded value as the parts read it: the columns the grid draws — those the viewer hides left out, a phone's
 * pinned one first — the registers, the group declaration, the pitches and the gutter, the tracks, the app's callbacks and
 * its new keys, the narrowing and the views, the copilot's declaration and the row source.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { SortedSet, StringType, StructType, compareFor, equalFor, printFor, type ValueTypeOf } from "@elaraai/east";
import { Sheet } from "@elaraai/e3-ui/internal";
import { getSomeorUndefined, useCoarsePointer, useSlicesReactivity, useDataStable } from "@elaraai/east-ui-components";
import { useDensityHeights, devicePixels, type RowsViewport, windowedSourceOf } from "@elaraai/east-ui-components/internal";
import type { RecordSliceBindType, RecordSliceStateType } from "@elaraai/east-ui/internal";
import { DEFAULT_BLANKS, DEFAULT_GUTTER_PX, TITLE_KEY, densityOf, groupBandPx, indexColumns, indexGroup, indexRegisters, parseWidth } from "./model.js";
import { keyOrderOf } from "./key-order.js";
import { narrowingOf, sheetViewsEqual } from "./view-state.js";
import { mintKey } from "../shared/schedule/records.js";
import { sourcePart } from "../shared/schedule/visibility.js";
import { todayUtc } from "./parse/date.js";
import { SheetRefused } from "./creation.js";
import { useSheetWords } from "./words.js";
import { SuggestMemo, type FillColumn } from "./suggest.js";
import { InFlight } from "./suggest-async.js";
import { NUMBER_PX, gutterFolds, gutterWidths } from "./gutter.js";
import type { SheetPagerColumn } from "./Pager.js";
import type { SheetNarrowing, SheetNounValue, SheetProposerValue, SheetRowValue, SheetSavedView, SheetDriverValue, SheetPagedSourceValue, SheetRootValue, SheetSelectionValue } from "./values.js";
import type { SheetHost, SheetHostLayout } from "./parts.js";

const sheetRootDataEqual = equalFor(Sheet.Types.Root);

const stringEqual = equalFor(StringType);

const compareString = compareFor(StringType);

/** A live source's rows under one narrowing, named apart (#1354): the source and its narrowing, as East prints them. */
const printNarrowedSource = printFor(StructType({ source: StringType, narrowing: StringType }));

/**
 * The narrowing a live source serves as it stands (#1354); `undefined` for any
 * other arm, or while it cannot be read — the paging says why, as it reads.
 *
 * @param source - The rows' windowed source, if any
 * @returns Its narrowing, as text
 */
function narrowingOfSource(source: { query?: (() => string) | undefined } | undefined): string | undefined {
    if (source?.query === undefined) return undefined;
    try {
        return source.query();
    } catch {
        return undefined;
    }
}

/** No slice: no store key to follow. */
const NO_KEYS: readonly string[] = [];

/** A phone's frame (`Mobile Sheet Spec.md` SH4): a pinned column's width, at the left, beside the window of columns. */
export const PHONE_PIN_PX = 150;

/** How many columns a phone's frame shows at once beside any pinned one, unless the sheet's `narrow` says (SH1.4). */
const PHONE_COLUMNS = 2;

/** What the jump menu keys the Row column by (SH2): no column's key, a name no author's column reaches through the grid. */
const ROW_COLUMN = "\u0000row";

/** A phone's band, px (SH6): 44, whatever the density. */
const PHONE_BAND_PX = 44;

/**
 * The decode's East values, by their types' names: a value's inferred type carries East's variant brand, which the
 * declaration build cannot name (TS4058).
 */
interface SheetDecodeValues {
    readonly capabilities: SheetRootValue["editing"]["edits"];
    readonly chrome: Extract<SheetRootValue["slice"], { type: "some" }>["value"] | undefined;
    readonly declaredViews: SheetRootValue["views"];
    readonly decodedRows: readonly SheetRowValue[] | undefined;
    readonly driver: SheetDriverValue | undefined;
    readonly narrowing: SheetNarrowing | undefined;
    readonly onSelectFn: Extract<SheetRootValue["onSelect"], { type: "some" }>["value"] | undefined;
    readonly onViewsChangeFn: Extract<SheetRootValue["onViewsChange"], { type: "some" }>["value"] | undefined;
    readonly pagedSource: SheetPagedSourceValue | undefined;
    readonly proposers: SheetProposerValue[];
    readonly rowsPart: ValueTypeOf<RecordSliceBindType> | undefined;
    readonly rowsWhere: ValueTypeOf<typeof RecordSliceStateType>["where"] | undefined;
    readonly selection: SheetSelectionValue | undefined;
    readonly views: readonly SheetSavedView[];
    readonly viewsRef: RefObject<readonly SheetSavedView[]>;
}

/**
 * Decodes the Sheet's value into what every part reads (see the module docs).
 *
 * @param value - The Sheet root value
 * @param host - What the frame hands the parts
 * @returns The columns, the layout, the callbacks, the narrowing, the views and the row source
 */
export function useSheetDecode(value: SheetRootValue, host: SheetHost) {
    // Changes identity on a DATA change only — what owns local state keys on
    // it; callbacks come from `value` (#809).
    const data = useDataStable(value, sheetRootDataEqual);
    // The sheet's words (#861) — the message table in effect, and the
    // counts the chrome prints (the summary, the hints, the messages, the
    // lens line) in the app's locale (#850).
    const words = useSheetWords();
    // The grid's id: its cells' ids hang off it, and the view tabs name it as what they switch (#860).
    const gridId = useId();
    // ── Decode ────────────────────────────────────────────────────────────
    // Every declared column — what a new row is made of — and the columns
    // the grid draws: all but those the viewer hides (#1186), and every one
    // when it would hide them all.
    const allColumns = useMemo(() => indexColumns(value.columns), [value.columns]);
    const hidden = host.hidden;
    // A host draws the grid (#1531): its rows at its pitch, its lead before the columns, no gutter.
    const hostGrid = host.grid;
    // The frame's width: inside it (`clientWidth`), the view a sub row's well
    // keeps its content to; its box (`offsetWidth`, which no scrollbar of its
    // own changes), what decides whether the gutter folds (#1215).
    const [viewPx, setViewPx] = useState<number | undefined>(undefined);
    const [framePx, setFramePx] = useState<number | undefined>(undefined);
    // A phone's frame (`Mobile Sheet Spec.md`): 560 wide or less — a frame not laid out yet (0 wide) is none. The
    // columns are a window the pager pages (SH1), no gutter (R5) — and a host's grid no lead (#1536); the column the
    // sheet's `narrow.pin` names, where it names one the grid draws, leads the row pinned at the left (SH4) — none by
    // default (ruled 3 Nov 2026).
    const phoneFrame = framePx !== undefined && framePx > 0 && framePx <= 560;
    const narrow = useMemo(() => getSomeorUndefined(value.narrow), [value.narrow]);
    const pinKey = narrow === undefined ? undefined : getSomeorUndefined(narrow.pin);
    const columns = useMemo(() => {
        const shown = hidden === undefined || hidden.size === 0 ? value.columns : value.columns.filter((c) => !hidden.has(c.key));
        const drawn = shown.length === 0 ? value.columns : shown;
        const pinAt = !phoneFrame || pinKey === undefined ? -1 : drawn.findIndex((c) => stringEqual(c.key, pinKey));
        // The pinned column first, the others in their order beside it.
        if (pinAt > 0) return indexColumns([drawn[pinAt]!, ...drawn.slice(0, pinAt), ...drawn.slice(pinAt + 1)]);
        return drawn.length === value.columns.length ? allColumns : indexColumns(drawn);
    }, [allColumns, value.columns, hidden, phoneFrame, pinKey]);
    // Whether a phone's frame pins a column: the one `narrow.pin` names, led into first place above.
    const pinned = phoneFrame && pinKey !== undefined && columns.list[0] !== undefined && stringEqual(columns.list[0].key, pinKey);
    const pinPx = pinned ? PHONE_PIN_PX : 0;
    // A phone's Row column (SH2, R5): the row numbers as a column of the window, off until the jump menu's `Row number` —
    // never a host's grid's, which has no row numbers (#1531).
    const [rowNumbersOn, setRowNumbers] = useState(false);
    const rowNumbers = phoneFrame && hostGrid === undefined && rowNumbersOn;
    const registers = useMemo(() => indexRegisters(value.registers), [value.registers]);
    const driver = useMemo(() => getSomeorUndefined(value.driver), [value.driver]);
    const driverColumn = driver?.column;
    // Grouped rows (#740): the band's cells and the title span.
    const titleColumn = words.m.titleColumn();
    const group = useMemo(() => {
        const g = getSomeorUndefined(value.group);
        return g !== undefined ? indexGroup(g, columns, titleColumn) : undefined;
    }, [value.group, columns, titleColumn]);
    const titleMeta = group?.cells.get(TITLE_KEY);
    // Rows of the line type may stand between the groups (#846): a LOOSE row.
    const loose = group?.loose === true;
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const size = densityOf(value);
    const coarse = useCoarsePointer();
    // The pitches on the device-pixel grid the frame measures and places its rows on (`devicePixels`), as the Roster's
    // and the Calendar's row floors are: at a fractional device pixel ratio a row drawn at a CSS pitch measures a
    // fraction of a pixel off it, which the frame keeps by its key — the rows read as the sheet opened, leaving the run
    // for a band as a far drag came to rest, took theirs with them and moved the view up by as much; under the lens every
    // row and stretch mounting was a compensation of the scroll the view could only round, and the view crept as the
    // narrowing's rows landed (#1398, CL8). On the grid each one measures as it was laid out, and rows land where their
    // placeholders stood.
    const densityRow = useDensityHeights(size).row;
    // A phone's rows (SH5): 44 on a coarse pointer, 32 on a fine one, whatever the density — the rule included. A host's
    // grid, its own pitch at every width (#1531).
    const rowPx = devicePixels(phoneFrame && hostGrid === undefined ? (coarse ? 44 : 32) : Math.max(hostGrid?.rowPx ?? densityRow, coarse ? 45 : 0));
    const bandPx = devicePixels(phoneFrame ? PHONE_BAND_PX : Math.max(groupBandPx(size), coarse ? 46 : 42));
    // A sub row's least height; a wrapping detail grows it, and the rows are measured.
    const subRowPx = devicePixels(30);
    // The word for a group: the host's (#844), else the sheet's words (#861).
    // The machine's messages carry only the host's, and word a missing one
    // when they show — so a new table re-words them.
    const declaredNoun = group?.noun;
    const noun = useMemo<SheetNounValue>(() => declaredNoun ?? { singular: words.m.groupNoun(), plural: words.m.groupNouns() }, [declaredNoun, words.m]);
    const readOnly = (getSomeorUndefined(value.readOnly) ?? false) || value.editing.onApply.type === "none";
    const capabilities = value.editing.edits;
    // A keyed source — paged (#880), or a record read whole (#1182): its rows
    // sort by key, at the key's own type, so nothing is placed by position.
    const keyed = value.editing.keyType.type === "some";
    // The narrowing (#1345): one rail over the sheet's `Slice.bindRecords` —
    // its `rows` source the rows', which the sheet pages from it; each other
    // source narrows the templates list or the library tab that names it.
    const chrome = useMemo(() => getSomeorUndefined(value.slice), [value.slice]);
    const rowsPart = useMemo(() => sourcePart(chrome, "rows"), [chrome]);
    // The query already orders these rows by its index. Drafting a cell must
    // preserve that order; primary keys are identity, not display positions.
    const keyOrder = useMemo(() => (!value.ordered && value.editing.keyType.type === "some" ? keyOrderOf(value.editing.keyType.value) : undefined), [value.editing.keyType, value.ordered]);
    const canInsertRows = !readOnly && capabilities.insertRows;
    const canInsertGroups = !readOnly && capabilities.insertGroups && group !== undefined;
    // The grouped blank-tail path remains until all insertions use explicit destinations.
    const blanks = !capabilities.insertRows ? 0 : group !== undefined ? (readOnly ? 0 : 1) : Number(getSomeorUndefined(value.blanks) ?? BigInt(DEFAULT_BLANKS));
    // What moves the rows, as the frame reports it (#856): the element they
    // scroll in, both ways.
    const [viewport, setViewport] = useState<RowsViewport | null>(null);
    // The number column: as wide as the widest number the sheet shows, in the
    // number's own face (measured in `use-scroll.tsx`, before the first paint), never
    // narrower than its least width — and every gutter grows by what it grows by.
    const [numberPx, setNumberPx] = useState(NUMBER_PX);
    const least = gutterWidths(numberPx);
    // Touch targets fit in separate lanes; row heights include their seam borders.
    const fullGutterPx = Math.max(parseWidth(style !== undefined ? getSomeorUndefined(style.gutterWidth) : undefined) ?? DEFAULT_GUTTER_PX, least.fine, coarse ? least.coarse : 0);
    // A frame too narrow for the touch gutter beside the first column folds it: one row-actions button holds each row's actions (#1215).
    const folded = hostGrid === undefined && gutterFolds(framePx, coarse, fullGutterPx, columns.list[0]?.width);
    // A phone's frame has no gutter (R5): its rows are picked by their pinned cell, and their actions are the Inspector's.
    // A host's grid has none either (#1531): its lead stands there — a Record's select column — where it has one, and on
    // a phone's frame goes as the gutter does (#1536).
    const gutterPx = phoneFrame ? 0 : hostGrid !== undefined ? hostGrid.leadPx : folded ? least.folded : fullGutterPx;
    // The columns a phone's pager pages: every one but a pinned one; and what it pages, the Row column before them while it shows.
    const pagedColumns = useMemo(() => (pinned ? columns.list.slice(1) : columns.list), [columns, pinned]);
    const pagerColumns = useMemo((): readonly SheetPagerColumn[] => {
        const each = pagedColumns.map((c): SheetPagerColumn => ({ key: c.key, header: c.header, kind: words.m.columnKind({ kind: c.kind }) }));
        return rowNumbers ? [{ key: ROW_COLUMN, header: words.m.pagerRow(), kind: words.m.pagerRowKind() }, ...each] : each;
    }, [pagedColumns, rowNumbers, words.m]);
    // A phone's window (SH1.4): the frame's width less any pinned column, shared by the columns in view — as many as
    // the sheet's `narrow.columns` says, else two, and never more than it pages: the window never ends at an empty slot.
    const narrowColumns = narrow === undefined ? undefined : getSomeorUndefined(narrow.columns);
    const phoneColumns = Math.max(1, Math.min(narrowColumns === undefined ? PHONE_COLUMNS : Number(narrowColumns), pagerColumns.length));
    const slotPx = phoneFrame && viewPx !== undefined ? Math.max(0, (viewPx - pinPx) / phoneColumns) : 0;
    // The frame's slack goes to the TEXT columns, each capped at 2.5× its
    // width, and the last column takes the rest, out to the frame's edge: the
    // grid ends at its own last column, never at an empty track after it. A
    // host's grid keeps its last column at its own width, as any other, and
    // what is left lies after it, empty: a Record's cells stay under their
    // headers, never out at the frame's edge. A phone's frame: any pinned
    // column, then a slot a column (SH1, SH4) — the gutter's cells drawn
    // nowhere (the recipe), so they take no track, but as the Row column, a
    // slot of its own first among the paged ones (SH2).
    const gridTemplate = useMemo(() => {
        if (phoneFrame) {
            const tracks = columns.list.map((_c, i) => (i === 0 && pinned ? `${PHONE_PIN_PX}px` : `${slotPx}px`));
            if (rowNumbers) tracks.splice(pinned ? 1 : 0, 0, `${slotPx}px`);
            return tracks.join(" ");
        }
        const last = columns.list.length - 1;
        const tracks = columns.list.map((c, i) => (i === last && hostGrid === undefined ? `minmax(${c.width}px, 1fr)`
            : c.kind === "text" ? `minmax(${c.width}px, ${Math.round(c.width * 2.5)}px)` : `${c.width}px`));
        if (hostGrid !== undefined) tracks.push("1fr");
        // A host's grid with no lead has no lead track (#1531).
        return hostGrid !== undefined && gutterPx === 0 ? tracks.join(" ") : `${gutterPx}px ${tracks.join(" ")}`;
    }, [gutterPx, columns, phoneFrame, slotPx, pinned, rowNumbers, hostGrid]);
    // How a host's rows and header are laid out (#1536): its lead's track, a phone's frame and its pinned column — one
    // object while they hold, so no row's memo sees it change.
    const hostLayout = useMemo((): SheetHostLayout => ({ lead: gutterPx > 0, phone: phoneFrame, pinPx }), [gutterPx, phoneFrame, pinPx]);
    const minWidth = phoneFrame ? pinPx + slotPx * pagerColumns.length : gutterPx + columns.list.reduce((n, c) => n + c.width, 0);
    // The window as it stands, for a pick of the phone's Library (SH11).
    const pagerRef = useRef({ list: pagerColumns, slot: slotPx, inView: phoneColumns });
    pagerRef.current = { list: pagerColumns, slot: slotPx, inView: phoneColumns };
    const today = useMemo(() => todayUtc(), []);

    // Callbacks — taken from the latest value on every render.
    const onSelectFn = useMemo(() => getSomeorUndefined(value.onSelect), [value.onSelect]);
    const onViewsChangeFn = useMemo(() => getSomeorUndefined(value.onViewsChange), [value.onViewsChange]);
    // A new entry's key (#1536): the app's `newKey`'s, given every key taken, each as its text — else a UUID, as every
    // builder mints one. A key the app gives that is taken, or a `newKey` that throws, refuses the gesture.
    const newKeyFn = useMemo(() => getSomeorUndefined(value.newKey), [value.newKey]);
    // Every key the sheet has minted, taken from then on: a gesture's own before the session holds them.
    const minted = useRef(new Set<string>());
    const mintAmong = useCallback((taken: Set<string>): string => {
        let key: string;
        if (newKeyFn === undefined) key = mintKey((k) => taken.has(k));
        else {
            try {
                key = newKeyFn(new SortedSet(taken, compareString));
            } catch (error) {
                throw new SheetRefused({ id: "keyFailed", reason: error instanceof Error ? error.message : String(error) });
            }
            if (taken.has(key)) throw new SheetRefused({ id: "keyTaken", key });
        }
        taken.add(key);
        minted.current.add(key);
        return key;
    }, [newKeyFn]);
    // The controlled selection follows the host's DATA: a closure-only change
    // must not snap the ring back to it.
    const selection = useMemo(() => getSomeorUndefined(data.selection), [data.selection]);
    // The slice and the views run on a grouped sheet too.
    const activeView = useMemo(() => getSomeorUndefined(value.activeView), [value.activeView]);

    // ── The narrowing — every source's, live from the store (§3.8, #1345) ──
    // A slice write moves the version, and nothing else here does (#611).
    const sliceVersion = useSlicesReactivity(chrome?.slice.parts.map((part) => part.slice.key) ?? NO_KEYS);
    const narrowing = useMemo<SheetNarrowing | undefined>(() => (chrome === undefined ? undefined : narrowingOf(chrome)),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sliceVersion IS the dependency of each part's `read()`: the store moves, no prop does (#611)
        [chrome, sliceVersion]);
    // The `rows` source's narrowing: what the lens draws over the record's rows (#1349).
    const rowsWhere = useMemo(() => narrowing?.get("rows")?.where, [narrowing]);

    // ── The views — the local layer over `views` until the host writes back ──
    // The layer sits over the host's views by VALUE, not identity: every host
    // re-render decodes a fresh array, and a tab the host has not written back
    // yet must survive a row write-back.
    const declaredViews = value.views;
    const [viewsState, setViewsState] = useState<{ over: readonly SheetSavedView[]; views: readonly SheetSavedView[] }>({ over: declaredViews, views: declaredViews });
    const views = useMemo(() => Object.is(viewsState.over, declaredViews) || sheetViewsEqual(viewsState.over, declaredViews) ? viewsState.views : declaredViews, [viewsState, declaredViews]);
    const viewsRef = useRef(views);
    viewsRef.current = views;

    // The copilot's declaration: the columns' fill providers and the proposers, as wire functions (§4.8).
    const suggestDecl = useMemo(() => getSomeorUndefined(value.suggest), [value.suggest]);
    const fillColumns = useMemo<FillColumn[]>(() => columns.list.map((m) => ({
        key: m.key, kind: m.kind, editable: m.editable && m.kind !== "stamped" && m.kind !== "action", providers: m.raw.fill,
    })), [columns]);
    const proposers = useMemo<SheetProposerValue[]>(() => suggestDecl?.propose ?? [], [suggestDecl]);
    const ahead = Number(suggestDecl?.ahead ?? 2n);
    const triggers = useMemo(() => new Set(suggestDecl?.triggers ?? []), [suggestDecl]);
    const copilotOn = !readOnly && (proposers.length > 0 || fillColumns.some((c) => c.providers.length > 0));
    // The memo empties on every new value — new data, or a provider closure
    // the root memo saw change (#809).
    const suggestMemo = useRef(new SuggestMemo());
    useEffect(() => { suggestMemo.current.clear(); }, [value]);
    const inflight = useRef(new InFlight());

    // ── The row source: inline rows, or the paged driver ──────────────────
    // Any windowed arm: `paged`; `pinned` naming its snapshot — the one the
    // driver follows through changes, and the session edits — as a `rows`
    // source's record is (#1349); or `live`, a narrowed source naming its
    // narrowing too (#1354). A live source keeps its id under every narrowing,
    // so the sheet names each narrowing's rows apart, by the source and the
    // narrowing together: its paging, its key search and its scroll take a new
    // narrowing as the new result it is, and the session edits the record
    // whatever the narrowing. The narrowing is read as it stands: the slice's
    // reactivity above re-renders the sheet when a choice moves it.
    const windowed = windowedSourceOf(value.rows);
    const narrowedBy = narrowingOfSource(windowed);
    const pagedSource = useMemo(() => (windowed === undefined || narrowedBy === undefined ? windowed
        : { ...windowed, id: printNarrowedSource({ source: windowed.id, narrowing: narrowedBy }) }), [windowed, narrowedBy]);
    // Over a `rows` source the rows are its record's, every one in the record's order (#1349): the source's
    // narrowing is drawn over them as the lens while it narrows them.
    const recordRows = rowsPart !== undefined && windowed !== undefined && narrowedBy === undefined;
    const lensWanted = recordRows && rowsWhere !== undefined && rowsWhere.size > 0;
    const decodedRows = useMemo<readonly SheetRowValue[] | undefined>(
        () => (data.rows.type === "inline" ? (data.rows.value as readonly SheetRowValue[]) : undefined),
        [data.rows],
    );
    const named: SheetDecodeValues = {
        capabilities, chrome, declaredViews, decodedRows, driver, narrowing, onSelectFn, onViewsChangeFn, pagedSource,
        proposers, rowsPart, rowsWhere, selection, views, viewsRef,
    };
    return {
        activeView, ahead, allColumns, bandPx, blanks, canInsertGroups, canInsertRows, columns, copilotOn, declaredNoun,
        driverColumn, fillColumns, folded, framePx, gridId, gridTemplate, group, gutterPx, hostGrid, hostLayout,
        inflight, keyOrder, keyed, lensWanted, loose, minWidth, mintAmong, minted, noun, numberPx, pagedColumns,
        pagerColumns, pagerRef, phoneColumns, phoneFrame, pinPx, pinned, readOnly, recordRows, registers, rowNumbers,
        rowPx, setFramePx, setNumberPx, setRowNumbers, setViewPx, setViewport, setViewsState, size, slotPx, subRowPx,
        suggestMemo, titleMeta, today, triggers, viewPx, viewport, words, ...named,
    };
}

/** What {@link useSheetDecode} gives the parts after it. */
export type SheetDecode = ReturnType<typeof useSheetDecode>;
