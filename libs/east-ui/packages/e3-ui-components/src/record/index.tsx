/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraRecord` — the renderer of the `Record` extension declared in
 * `@elaraai/e3-ui` (`Record - DX Proposal.md` FR1): a system of records'
 * table in the Table's anatomy, laid out in `BuilderFrame`, over the Sheet's
 * one shared state — its machine, its editing session, its lens and its
 * paging — whose grid draws the Record's rows, header, select column and
 * empty state through its host (decision 8, `grid.tsx`).
 *
 * The frame's regions:
 *
 * - **the toolbar** — the title and the count of the record's rows, the rail
 *   over the record's slice, the status line, Add and Delete, and the history
 *   bar (`toolbar.tsx`, FR2–FR7); the status line says the last gesture's
 *   words, a step of the history's, or how many rows are ticked
 *   (`status.ts`, FR5, AD1–AD7);
 * - **the banners** — the session's, then an `entry` the record does not
 *   hold;
 * - **main** — the grid, filling the room the inspector leaves and scrolling
 *   its own rows, the strip docked under it. Beside the inspector it keeps
 *   more than a phone's frame, and where it could not the inspector overlays
 *   it, so the grid draws as on a phone only in a phone's frame;
 * - **the inspector**, the end pane, 320 wide, when the Record is given one —
 *   Details for the ring's row (`inspector.tsx`, IN1–IN8), and the batch's
 *   Issues, each naming its row by its place among the rows shown (IN9), and
 *   an empty field a new row needs `Required` in both, the Record's word; a
 *   press, ⏎ or F2 on a title opens it on Details with the keyboard in the
 *   title's field, as Add and Duplicate do — and the history bar's Issues and
 *   an issue's line, in the field the issue names — its open tab kept per
 *   viewer;
 * - **the footer** — the rows shown of the record's, the record's last save,
 *   the stale note and the legend (`footer.tsx`, FT1, FT2).
 *
 * Add drafts a row — first in the rows, in its key's place where they are
 * keyed — the rail's search cleared so it shows, and the ring on its title,
 * which opens it on Details (AD1). With no inspector a title edits in its
 * cell, as a text does, and Add opens its editor there. Delete takes the
 * ticked rows out as one draft, and the ticks with them (AD5); Discard drops
 * the ticks with every draft (AD6).
 *
 * On a phone — the frame 560 wide or less — the frame is the BuilderFrame's
 * phone frame, the inspector its drawer, and the grid the Sheet's on a phone:
 * the title column pinned at the left, the Sheet's pager stepping through the
 * other columns, and no select column (`grid.tsx`). Its toolbar is the title,
 * the rail and Add; the status line's words are its footer's band. A press on
 * a cell of the Sheet's kinds edits it in the bottom container, the
 * inspector's field at touch size (SH10), and the drawer holds the Record's
 * own Details.
 *
 * Its rows are 36, 32 or 28 tall, the rule included — the Record's own
 * density, else the one it is placed in, else comfortable — at the theme's
 * `sizes.row` tokens, and its header row the same. Its ages count to one
 * clock, the browser's, read again each minute (`clock.tsx`). ⌘Z undoes and
 * ⇧⌘Z redoes from anywhere in the frame, as the Sheet's do. It fills its
 * parent and draws no border.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from "react";
import { Box, useToken } from "@chakra-ui/react";
import { equivalentFor, fromEastTypeValue, type ValueTypeOf } from "@elaraai/east";
import { RecordComponent, RecordPayloadType, type sheetKeys } from "@elaraai/e3-ui/internal";
import {
    BannerView, BuilderFrame, NARROW_FRAME, SessionBanners, getSomeorUndefined, historyShortcut, implementUIComponent, takeKey, typedInto, usePersistedState,
    type EditIssue, type HistoryAction,
} from "@elaraai/east-ui-components";
import { LoadingReveal, keptRead, useDensity, useSlotStyles, type SlotStyles } from "@elaraai/east-ui-components/internal";
import {
    SheetGrid, SheetProvider, useSheetEntries, useSheetFooter, useSheetHistory, useSheetInspect, useSheetLoading, useSheetToolbarParts, useSheetToolbarRef, type SheetHost,
} from "../sheet/index.js";
import { draftChanges } from "../sheet/draft-state.js";
import { SheetMessagesProvider, type SheetMessages } from "../sheet/messages.js";
import { useLastCommit } from "../sheet/frame/index.js";
import { sheetCellEditor, useSheetInspector, type SheetInspectorHost } from "../sheet/frame/inspector.js";
import { indexColumns, indexRegisters } from "../sheet/model.js";
import type { SheetTransactions } from "../sheet/transactions.js";
import { issueText, useSheetWords } from "../sheet/words.js";
import { openFramePane } from "../shared/schedule/open-pane.js";
import { sourcePart } from "../shared/schedule/visibility.js";
import { RecordClock, useRecordNow } from "./clock.js";
import { RecordFooter, legendOf, staleNoteOf } from "./footer.js";
import { RecordEmpty, RecordGridProvider, RecordHeader, RecordRow, useRecordGrid, type RecordGrid } from "./grid.js";
import { RecordDetails, RecordInspectorProvider, recordIssueWhere, type RecordFocus, type RecordInspector } from "./inspector.js";
import { recordMessages as rm } from "./messages.js";
import { createRecordStatus, stepOf, useRecordStatusLine, type RecordNoun, type RecordStatus } from "./status.js";
import { RecordStrip } from "./strip.js";
import { createRecordTicks, type RecordTicks } from "./ticks.js";
import { useRecordToolbarItems } from "./toolbar.js";

/** The renderer's payload, decoded. */
export type RecordValue = ValueTypeOf<typeof RecordPayloadType>;

/** The names a Record keeps its viewer's state under. */
type RecordKeys = ReturnType<typeof sheetKeys>;

/** The payload's equivalence: its data, and its functions by their IR and what they capture. */
const payloadEquivalent = equivalentFor(RecordPayloadType);

/** The select column's width, px (SL1): 20 in, the 14 box, 12 out. */
const SELECT_PX = 46;

/**
 * The narrowest main gets beside a pinned inspector, px: wider than a phone's
 * frame, which the grid draws as a phone's whatever frame it sits in — the
 * pager, no select column — while the toolbar is still a desktop's.
 */
const MIN_MAIN_PX = NARROW_FRAME + 1;

/** The Sheet's words the Record says its own way (IN3, IN9): an empty field a new row needs. */
const RECORD_SHEET_MESSAGES: Partial<SheetMessages> = { issueRequired: rm.fieldRequired };

/** No column hidden: a Record has no Columns tab. */
const NO_COLUMN_HIDDEN: ReadonlySet<string> = new Set();

/** The inspector's tab, as storage holds it. */
const readTab = keptRead.record({ tab: keptRead.string });

/**
 * The names a Record keeps its viewer's state under, as a Sheet's are named —
 * apart from a Sheet's of the same name.
 *
 * @param name - The Record's `name`, if it has one
 * @returns Its frame's, its columns', its library's and its surface's names
 */
function recordKeys(name: string | undefined): RecordKeys {
    const suffix = name === undefined ? "" : `.${name}`;
    return { frame: `record${suffix}.frame`, columns: `record${suffix}.columns`, library: `record.library${suffix}`, surface: `record${suffix}.surface` };
}

/** Props of {@link EastChakraRecord}. */
export interface EastChakraRecordProps {
    /** The payload, decoded. */
    value: RecordValue;
    /** The structural storage key. */
    storageKey: string;
}

/**
 * Renders the Record — see the module docs.
 *
 * @param props - The payload and its storage key
 * @returns The Record, in its frame
 */
export const EastChakraRecord = memo(function EastChakraRecord({ value, storageKey }: EastChakraRecordProps) {
    const words = useSheetWords();
    const name = getSomeorUndefined(value.name);
    const keys = useMemo(() => recordKeys(name), [name]);
    // The rows' density (GR1): the Record's own, else the one it is placed in, else comfortable — its height the theme's.
    const placed = useDensity();
    const density = getSomeorUndefined(value.sheet.density)?.type ?? placed ?? "comfortable";
    const [rowHeight] = useToken("sizes", [`row.${density}`]);
    const rowPx = Number.parseInt(rowHeight ?? "", 10);
    const styles = useSlotStyles("record", { density });
    // A read-only Record has no select column: nothing it ticks could be acted on.
    const readOnly = (getSomeorUndefined(value.sheet.readOnly) ?? false) || value.sheet.editing.onApply.type === "none";
    const [ticks] = useState(createRecordTicks);
    const [status] = useState(createRecordStatus);
    // A title opens where it edits (P4): the inspector, on Details — its open tab kept per viewer.
    const frameRef = useRef<HTMLDivElement | null>(null);
    const { state: pane, setState: setPane } = usePersistedState<{ tab: string }>(`${keys.frame}.inspector.tab`, { tab: "details" }, readTab);
    const inspectorPane = words.m.inspectorPane();
    const openDetails = useCallback(() => {
        setPane({ tab: "details" });
        openFramePane(frameRef.current, inspectorPane, "end");
    }, [setPane, inspectorPane]);
    // …with the keyboard in the title's field (AD1), as a copy's (IN7) and an issue's once it is gone to (IN9): asked of
    // the row's Details, which answer once their form has given it.
    const [focus, setFocus] = useState<RecordFocus | undefined>(undefined);
    const focusSeq = useRef(0);
    const onOpen = useCallback((r: number, key: string) => {
        focusSeq.current += 1;
        setFocus({ r, key, seq: focusSeq.current });
        openDetails();
    }, [openDetails]);
    const focused = useCallback((seq: number) => setFocus((was) => (was !== undefined && was.seq === seq ? undefined : was)), []);
    // Each step of the history, told to the status line in the Record's words once it is taken (AD4–AD7): what it
    // will take back or send read before it is taken — after it, the session holds none of it. Discard drops the ticks
    // with the drafts (AD6); an Apply is told once its batch is written, a refusal saying itself in the banners.
    const fields = useMemo(() => draftChanges(fromEastTypeValue(value.sheet.editing.draftType)), [value.sheet.editing.draftType]);
    const onHistory = useCallback((action: HistoryAction, session: SheetTransactions) => {
        const step = stepOf(action, session, fields);
        if (step === undefined) return undefined;
        return () => {
            if (step.id === "applied" && !(session.status === "reconciling" || (session.status === "idle" && session.error === undefined))) return;
            if (step.id === "discarded") ticks.clear();
            status.say(step);
        };
    }, [fields, ticks, status]);
    // A phone's cell editor (SH10): a cell of the Sheet's kinds edits in the bottom container, its inspector's field at
    // touch size; a cycle, a toggle and a boolean step where they are pressed, and a title opens its Details — or, with
    // no inspector, edits there as a text does.
    const cellEditor = useMemo(() => sheetCellEditor(value, words, NO_COLUMN_HIDDEN), [value, words]);
    // With no inspector a title opens nowhere: it edits in its cell, as a text does, and Add opens its editor there.
    const inspector = value.inspector.type === "some";
    const host = useMemo((): SheetHost => ({
        grid: {
            rowPx, leadPx: readOnly ? 0 : SELECT_PX, leadRun: "check", runStyles: styles, Row: RecordRow, Header: RecordHeader, Empty: RecordEmpty, Strip: RecordStrip,
            onOpen: inspector ? onOpen : undefined,
        },
        onHistory,
        cellEditor,
    }), [rowPx, readOnly, styles, inspector, onOpen, onHistory, cellEditor]);
    const noun = useMemo((): RecordNoun => getSomeorUndefined(value.noun) ?? rm.rowNoun(), [value.noun]);
    const title = getSomeorUndefined(value.title);
    const grid = useMemo((): RecordGrid => ({ styles, ticks, groups: value.columnGroups, noun, title, inspector }), [styles, ticks, value.columnGroups, noun, title, inspector]);
    const inspection = useMemo((): RecordInspector => ({ focus, focused, status, ticks, readOnly }), [focus, focused, status, ticks, readOnly]);
    const onTab = useCallback((tab: string) => setPane({ tab }), [setPane]);
    return (
        <SheetMessagesProvider messages={RECORD_SHEET_MESSAGES}>
            <RecordClock>
                <RecordGridProvider value={grid}>
                    <SheetProvider value={value.sheet} storageKey={storageKey} host={host}>
                        <RecordInspectorProvider value={inspection}>
                            <RecordFrame value={value} keys={keys} styles={styles} frameRef={frameRef} tab={pane.tab} onTab={onTab} onOpen={onOpen}
                                openDetails={openDetails} ticks={ticks} status={status} readOnly={readOnly} />
                        </RecordInspectorProvider>
                    </SheetProvider>
                </RecordGridProvider>
            </RecordClock>
        </SheetMessagesProvider>
    );
}, (prev, next) => payloadEquivalent(prev.value, next.value) && prev.storageKey === next.storageKey);

/** Props of {@link RecordFrame}. */
interface RecordFrameProps {
    value: RecordValue;
    keys: RecordKeys;
    /** The record recipe's slot styles. */
    styles: SlotStyles;
    /** The frame's root: where a title's press opens the inspector. */
    frameRef: RefObject<HTMLDivElement | null>;
    /** The inspector's open tab. */
    tab: string;
    /** Opens an inspector tab. */
    onTab: (tab: string) => void;
    /** Opens the inspector on a row's Details, with the keyboard in a field: its row-space index, and the field's key. */
    onOpen: (r: number, key: string) => void;
    /** Opens the inspector on Details. */
    openDetails: () => void;
    /** The rows ticked. */
    ticks: RecordTicks;
    /** The steps of the history the status line is told of. */
    status: RecordStatus;
    /** No gesture changes the Record: no Add, no Delete. */
    readOnly: boolean;
}

/** The frame, its regions holding the Sheet's parts and the Record's grid. */
function RecordFrame({ value, keys, styles, frameRef, tab, onTab, onOpen, openDetails, ticks, status, readOnly }: RecordFrameProps) {
    const words = useSheetWords();
    const { m } = words;
    const parts = useSheetToolbarParts();
    const toolbarRef = useSheetToolbarRef();
    const entries = useSheetEntries();
    const footer = useSheetFooter();
    const loading = useSheetLoading();
    const { session, onAction } = useSheetHistory();
    const inspect = useSheetInspect();
    const now = useRecordNow();
    const lastCommit = useLastCommit(value.history, words);
    const saved = lastCommit === undefined ? undefined : m.savedAt({ when: lastCommit.when });
    // The inspector's Details the Record's (IN1–IN8), and an issue's row named by its place among the rows shown (IN9).
    const inspectorHost = useMemo((): SheetInspectorHost => ({ Details: RecordDetails, where: recordIssueWhere(words) }), [words]);
    const inspector = useSheetInspector({ value, keys, words, hidden: NO_COLUMN_HIDDEN, lastCommit, host: inspectorHost });
    const end = inspector === undefined ? undefined : { ...inspector, tab, onTabChange: onTab };
    // A Save that takes rows out of the `rows` source's narrowing says so in the footer.
    const rowsPart = useMemo(() => sourcePart(getSomeorUndefined(value.sheet.slice), "rows"), [value.sheet.slice]);
    const { noun, title } = useRecordGrid();
    const columns = useMemo(() => indexColumns(value.sheet.columns), [value.sheet.columns]);
    const registers = useMemo(() => indexRegisters(value.sheet.registers), [value.sheet.registers]);
    // The rows ticked of those shown: what Delete deletes and the status line counts.
    const tickVersion = useSyncExternalStore(ticks.subscribe, ticks.version);
    const rowIds = useMemo(() => entries.rows.map((row) => row.id), [entries.rows]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tickVersion moves with every tick: the ticks are a store read by its version.
    const ticked = useMemo(() => ticks.count(rowIds), [ticks, rowIds, tickVersion]);
    const shown = entries.count.shown;
    const total = entries.count.total;
    // Every issue holding Apply, as the history bar counts them: what an issue gone to says it is one of (AD3).
    const readiness = session.readiness;
    const issues = readiness.type === "ready" ? session.issues : readiness.value;
    const statusLine = useRecordStatusLine({
        status, notice: entries.notice, gestures: entries.gestures, ticks, ticked, of: shown ?? entries.rows.length, issues, words, noun,
    });
    // Issues takes the ring to the first issue's field, its row opened on Details with the keyboard in the field (AD3, IN9),
    // as the Issues tab's lines do. Where the row stands is read as the notice comes, never again as the rows move.
    const notice = entries.notice;
    const placeOf = useRef(inspect.placeOf);
    placeOf.current = inspect.placeOf;
    useEffect(() => {
        if (notice?.id !== "issue") return;
        const place = placeOf.current(notice.issue);
        const field = getSomeorUndefined(notice.issue.field);
        if (place !== undefined && field !== undefined) onOpen(place.r, field);
        else openDetails();
    }, [notice, onOpen, openDetails]);
    // Add drafts a row, its ring on the title (AD1); Delete the ticked rows (AD5), the ticks going with them.
    const capabilities = value.sheet.editing.edits;
    const titleKey = useMemo(() => value.sheet.columns.find((column) => column.kind.type === "title")?.key, [value.sheet.columns]);
    const add = entries.add;
    const remove = entries.remove;
    const onAdd = useCallback(() => add(titleKey), [add, titleKey]);
    const onDelete = useCallback(() => {
        remove(rowIds.filter((id) => ticks.has(id)));
        ticks.clear();
    }, [remove, rowIds, ticks]);
    // Add and Delete are off while the rows take no gesture — a narrowing standing in, a far jump held — as the session's
    // add and remove would refuse it then.
    const items = useRecordToolbarItems({
        styles, parts, title, count: total === undefined ? undefined : words.number(total), status: statusLine, noun,
        onAdd: readOnly || !capabilities.insertRows ? undefined : onAdd,
        onDelete: readOnly || !capabilities.removeRows ? undefined : onDelete,
        ticked, tickedCount: words.number(ticked), writable: session.writable && inspect.writable,
    });
    // The footer (FT1, FT2): the rows shown of the record's, the stale note over every row shown, and the legend.
    const count = shown === undefined || total === undefined ? undefined
        : rm.shownOf({ shown: words.number(shown), total: words.number(total), n: total, noun: noun.singular, nouns: noun.plural });
    const stale = entries.whole ? staleNoteOf(columns, entries.rows, now, words) : undefined;
    const legend = useMemo(() => legendOf(columns, registers), [columns, registers]);
    // An issue's place: its row's key — a Record's rows have no lines.
    const where = useCallback((issue: EditIssue) => issue.entry, []);
    const readIssue = useCallback((message: string) => issueText(message, words), [words]);
    // The history keys from anywhere in the frame: the grid's own it has answered already.
    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || typedInto(event.target)) return;
        const action = historyShortcut(event);
        if (action === undefined) return;
        takeKey(event);
        onAction(action);
    }, [onAction]);
    const missing = getSomeorUndefined(value.missing);
    // No control to show — read only, no title, no slice — no toolbar.
    const toolbar = items.some((item) => item !== undefined && item !== false && item.key !== "record-status") ? items : undefined;
    const banners = (
        <>
            <SessionBanners session={session} words={words} onAction={onAction} where={where} issueText={readIssue} />
            {missing !== undefined && (
                <Box data-record-banner="missing">
                    <BannerView status="neutral" title={m.entryMissing({ key: missing })} />
                </Box>
            )}
        </>
    );
    // One reveal clock, as the Sheet's: the footer's line and the runs' placeholders show once a read the view waits for has passed the delay.
    const waiting = footer.loading !== undefined && footer.loading.kind !== "failed";
    return (
        <LoadingReveal waiting={waiting}>
            <BuilderFrame
                ref={frameRef}
                storageKey={keys.frame}
                toolbar={toolbar}
                toolbarRef={toolbarRef}
                banners={banners}
                end={end}
                minMain={MIN_MAIN_PX}
                footer={<RecordFooter styles={styles} count={count} saved={saved} stale={stale} recordSlice={rowsPart} legend={legend} live={statusLine}
                    loading={footer.loading} noun={footer.noun} onRetry={footer.onRetry} />}
                loading={loading.cold}
                busy={loading.busy}
                loadingPitch={loading.pitch}
                liveFooter
                onKeyDown={onKeyDown}
            >
                <Box css={styles.root} data-record="">
                    <Box css={styles.grid}>
                        <SheetGrid />
                    </Box>
                </Box>
            </BuilderFrame>
        </LoadingReveal>
    );
}

implementUIComponent(RecordComponent, EastChakraRecord);
