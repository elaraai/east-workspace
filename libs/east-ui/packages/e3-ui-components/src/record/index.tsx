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
 * - **the toolbar** — the Sheet's items: the rail over the record's slice,
 *   its key search and its history item;
 * - **the banners** — the session's, then an `entry` the record does not
 *   hold;
 * - **main** — the grid, filling the room the inspector leaves and scrolling
 *   its own rows, the strip docked under it;
 * - **the inspector**, the end pane, 320 wide, when the Record is given one —
 *   Details for the ring's row, and the batch's Issues; a press, ⏎ or F2 on a
 *   title opens it on Details, its open tab kept per viewer;
 * - **the footer** — the Sheet's, with the record's last save.
 *
 * On a phone — the frame 560 wide or less — the frame is the BuilderFrame's
 * phone frame, the inspector its drawer, and the grid the Sheet's on a phone:
 * the title column pinned at the left, the Sheet's pager stepping through the
 * other columns, and no select column (`grid.tsx`).
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

import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Box, useToken } from "@chakra-ui/react";
import { equivalentFor, type ValueTypeOf } from "@elaraai/east";
import { RecordComponent, RecordPayloadType, type sheetKeys } from "@elaraai/e3-ui/internal";
import {
    BannerView, BuilderFrame, SessionBanners, getSomeorUndefined, historyShortcut, implementUIComponent, takeKey, typedInto, usePersistedState,
    type EditIssue,
} from "@elaraai/east-ui-components";
import { LoadingReveal, keptRead, useDensity, useSlotStyles, type SlotStyles } from "@elaraai/east-ui-components/internal";
import { SheetFooter } from "../sheet/Footer.js";
import { SheetGrid, SheetProvider, useSheetFooter, useSheetHistory, useSheetLoading, useSheetToolbarItems, useSheetToolbarRef, type SheetHost } from "../sheet/index.js";
import { useLastCommit } from "../sheet/frame/index.js";
import { useSheetInspector } from "../sheet/frame/inspector.js";
import { issueText, useSheetWords } from "../sheet/words.js";
import { openFramePane } from "../shared/schedule/open-pane.js";
import { sourcePart } from "../shared/schedule/visibility.js";
import { RecordClock } from "./clock.js";
import { RecordEmpty, RecordGridProvider, RecordHeader, RecordRow, type RecordGrid } from "./grid.js";
import { createRecordTicks } from "./ticks.js";

/** The renderer's payload, decoded. */
export type RecordValue = ValueTypeOf<typeof RecordPayloadType>;

/** The names a Record keeps its viewer's state under. */
type RecordKeys = ReturnType<typeof sheetKeys>;

/** The payload's equivalence: its data, and its functions by their IR and what they capture. */
const payloadEquivalent = equivalentFor(RecordPayloadType);

/** The select column's width, px (SL1): 20 in, the 14 box, 12 out. */
const SELECT_PX = 46;

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
    // A title opens where it edits (P4): the inspector, on Details — its open tab kept per viewer.
    const frameRef = useRef<HTMLDivElement | null>(null);
    const { state: pane, setState: setPane } = usePersistedState<{ tab: string }>(`${keys.frame}.inspector.tab`, { tab: "details" }, readTab);
    const inspectorPane = words.m.inspectorPane();
    const onOpen = useCallback(() => {
        setPane({ tab: "details" });
        openFramePane(frameRef.current, inspectorPane, "end");
    }, [setPane, inspectorPane]);
    const host = useMemo((): SheetHost => ({
        grid: { rowPx, leadPx: readOnly ? 0 : SELECT_PX, leadRun: "check", runStyles: styles, Row: RecordRow, Header: RecordHeader, Empty: RecordEmpty, onOpen },
    }), [rowPx, readOnly, styles, onOpen]);
    const nouns = getSomeorUndefined(value.noun)?.plural ?? words.m.railRows();
    const grid = useMemo((): RecordGrid => ({ styles, ticks, groups: value.columnGroups, nouns }), [styles, ticks, value.columnGroups, nouns]);
    const onTab = useCallback((tab: string) => setPane({ tab }), [setPane]);
    return (
        <RecordClock>
            <RecordGridProvider value={grid}>
                <SheetProvider value={value.sheet} storageKey={storageKey} host={host}>
                    <RecordFrame value={value} keys={keys} styles={styles} frameRef={frameRef} tab={pane.tab} onTab={onTab} />
                </SheetProvider>
            </RecordGridProvider>
        </RecordClock>
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
}

/** The frame, its regions holding the Sheet's parts and the Record's grid. */
function RecordFrame({ value, keys, styles, frameRef, tab, onTab }: RecordFrameProps) {
    const words = useSheetWords();
    const { m } = words;
    const items = useSheetToolbarItems();
    const toolbarRef = useSheetToolbarRef();
    const footer = useSheetFooter();
    const loading = useSheetLoading();
    const { session, onAction } = useSheetHistory();
    const lastCommit = useLastCommit(value.history, words);
    const saved = lastCommit === undefined ? undefined : m.savedAt({ when: lastCommit.when });
    const inspector = useSheetInspector({ value, keys, words, hidden: NO_COLUMN_HIDDEN, lastCommit });
    const end = inspector === undefined ? undefined : { ...inspector, tab, onTabChange: onTab };
    // A Save that takes rows out of the `rows` source's narrowing says so in the footer.
    const rowsPart = useMemo(() => sourcePart(getSomeorUndefined(value.sheet.slice), "rows"), [value.sheet.slice]);
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
    // No control to show — read only, no slice, no key search — no toolbar.
    const toolbar = items.some((item) => item !== undefined && item !== false) ? items : undefined;
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
                footer={<SheetFooter {...footer} saved={saved} recordSlice={rowsPart} />}
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
