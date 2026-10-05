/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraSheetBuilder` — the renderer of the `SheetBuilder` extension
 * declared in `@elaraai/e3-ui` (#1184, `Sheet Builder Spec.md` §7, §8,
 * SB18–SB24): an e3 record edited as a sheet, laid out in `BuilderFrame`.
 *
 * The sheet is today's, whole. The payload's `sheet` is the very
 * `SheetRootType` `Sheet.View` draws, and `SheetProvider` builds its one
 * shared state from it — the store, the editing session, the lens and the
 * selection. The builder places the sheet's parts in the frame's regions:
 *
 * - **the toolbar** — the sheet's items (`useSheetToolbarItems`) on the
 *   frame's one folding row, in §7.1's order: the view tabs, the context
 *   switch, the match count, the key search, the slice's rail, the scope
 *   badge, and the history item, which leaves its error to the banners. ⌘F
 *   in the grid finds the search box in it;
 * - **the banners** — the session's (`SessionBanners`): an Apply's conflict,
 *   naming its rows and who changed the record last; a refusal, with its
 *   reason; an unknown outcome and a failed confirmation read, each with
 *   Retry; the out-of-date notice, with Discard — and last, an `entry` the
 *   record does not hold;
 * - **the library**, the start pane, and **the inspector**, the end pane:
 *   `BuilderFrame`'s panes, whose open tab and collapsed state persist under
 *   the builder's `id`. The library's Columns tab hides columns from the
 *   grid, per viewer, under the builder's `id` too (SB36);
 * - **main** — the grid, filling the room the panes leave and scrolling its
 *   own rows, the strip docked under it;
 * - **the footer** — the sheet's, with the record's last save from its
 *   commits.
 *
 * The builder fills its parent and draws no border.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo } from "react";
import { Box } from "@chakra-ui/react";
import { StringType, equalFor, equivalentFor, type ValueTypeOf } from "@elaraai/east";
import { SheetBuilderComponent, SheetBuilderPayloadType, sheetKeys } from "@elaraai/e3-ui/internal";
import {
    BannerView, BuilderFrame, SessionBanners, getSomeorUndefined, implementUIComponent, usePersistedState, useTrackedEvaluation, type EditIssue,
} from "@elaraai/east-ui-components";
import { SheetFooter } from "../Footer.js";
import { SheetGrid, SheetProvider, SheetRoot, useSheetFooter, useSheetHistory, useSheetToolbarItems, useSheetToolbarRef, type SheetHost } from "../index.js";
import { todayUtc } from "../parse/date.js";
import { issueText, useSheetWords, type SheetWords } from "../words.js";
import { useSheetInspector } from "./inspector.js";
import { useSheetLibrary } from "./library.js";

/** The renderer's payload, decoded. */
type SheetBuilderValue = ValueTypeOf<typeof SheetBuilderPayloadType>;

/** The names the builder keeps its viewer's state under. */
type SheetKeys = ReturnType<typeof sheetKeys>;

/** The payload's equivalence: its data, and its functions by their IR and what they capture. */
const payloadEquivalent = equivalentFor(SheetBuilderPayloadType);
const stringEqual = equalFor(StringType);

/** No column hidden: what a viewer who has hidden none keeps. */
const NONE_HIDDEN: readonly string[] = [];

/**
 * The columns a viewer hides, as storage holds them: a list of keys, or
 * anything else a store held by mistake, which hides none.
 *
 * @param stored - What storage holds
 * @returns The keys hidden
 */
function hiddenOf(stored: unknown): ReadonlySet<string> {
    return new Set(Array.isArray(stored) ? stored.filter((key): key is string => typeof key === "string") : []);
}

/** Props of {@link EastChakraSheetBuilder}. */
export interface EastChakraSheetBuilderProps {
    /** The payload, decoded. */
    value: SheetBuilderValue;
    /** The structural storage key. */
    storageKey: string;
}

/**
 * The record's last save, in the footer's words (SB22): its newest commit's
 * time, as the day's time when it was today and in full otherwise.
 *
 * @param history - The payload's `history`: the record's commits, newest first
 * @param words - The sheet's words
 * @returns `saved 14:02`, or `undefined` while the commits are unread
 */
function useLastSave(history: SheetBuilderValue["history"], words: SheetWords): string | undefined {
    // Read where the builder renders, and again when the record moves.
    const read = useCallback(() => history(), [history]);
    const { result } = useTrackedEvaluation(read);
    const last = result.ok && result.value.type === "some" ? result.value.value[0] : undefined;
    if (last === undefined) return undefined;
    const today = stringEqual(words.date(last.at), words.date(todayUtc()));
    return words.m.savedAt({ when: today ? words.time(last.at) : words.dateTime(last.at) });
}

/**
 * Renders the sheet builder — see the module docs.
 *
 * @param props - The payload and its storage key
 * @returns The builder
 */
export const EastChakraSheetBuilder = memo(function EastChakraSheetBuilder({ value, storageKey }: EastChakraSheetBuilderProps) {
    const id = getSomeorUndefined(value.id);
    const keys = useMemo(() => sheetKeys(id), [id]);
    // The columns this viewer hides (SB36), kept under the builder's id: the
    // grid leaves them out, and the library's Columns tab shows and hides them.
    const { state: stored, setState: store } = usePersistedState<readonly string[]>(keys.columns, NONE_HIDDEN);
    const hidden = useMemo(() => hiddenOf(stored), [stored]);
    const onToggleColumn = useCallback((key: string) => {
        store((was) => {
            const off = [...hiddenOf(was)];
            return off.some((k) => stringEqual(k, key)) ? off.filter((k) => !stringEqual(k, key)) : [...off, key];
        });
    }, [store]);
    // What the builder takes over from the sheet's parts: its grid fills main, its errors are banners (SB21, SB23), and it hides what the viewer hid.
    const host = useMemo((): SheetHost => ({ fill: true, historyError: false, hidden }), [hidden]);
    return (
        <SheetProvider value={value.sheet} storageKey={`${storageKey}.sheet`} host={host}>
            <SheetBuilderFrame value={value} keys={keys} hidden={hidden} onToggleColumn={onToggleColumn} />
        </SheetProvider>
    );
}, (prev, next) => payloadEquivalent(prev.value, next.value) && prev.storageKey === next.storageKey);

/** Props of {@link SheetBuilderFrame}. */
interface SheetBuilderFrameProps {
    /** The payload, decoded. */
    value: SheetBuilderValue;
    /** The names the builder keeps its viewer's state under. */
    keys: SheetKeys;
    /** The columns this viewer hides. */
    hidden: ReadonlySet<string>;
    /** Hides a column, or shows it again. */
    onToggleColumn: (key: string) => void;
}

/** The frame, its regions holding the sheet's parts. */
function SheetBuilderFrame({ value, keys, hidden, onToggleColumn }: SheetBuilderFrameProps) {
    const words = useSheetWords();
    const { m } = words;
    const items = useSheetToolbarItems();
    const toolbarRef = useSheetToolbarRef();
    const footer = useSheetFooter();
    const { session, onAction } = useSheetHistory();
    const saved = useLastSave(value.history, words);
    const library = useSheetLibrary({ value, keys, hidden, onToggleColumn, words });
    const inspector = useSheetInspector(words);
    // An issue's place: its row's key, or on a grouped sheet its line in its group.
    const where = useCallback((issue: EditIssue) => (issue.entry === "" || issue.row.type === "none" ? issue.entry
        : m.rowRef({ line: true, number: words.number(Number(issue.row.value) + 1), title: issue.entry, noun: m.groupNoun() })), [m, words]);
    const readIssue = useCallback((message: string) => issueText(message, words), [words]);
    const missing = getSomeorUndefined(value.missing);
    const banners = (
        <>
            <SessionBanners session={session} words={words} onAction={onAction} where={where} issueText={readIssue} />
            {missing !== undefined && (
                <Box data-sheet-banner="missing">
                    <BannerView status="neutral" title={m.entryMissing({ key: missing })} />
                </Box>
            )}
        </>
    );
    return (
        <BuilderFrame
            storageKey={keys.frame}
            toolbar={items}
            toolbarRef={toolbarRef}
            banners={banners}
            start={library}
            end={inspector}
            footer={<SheetFooter {...footer} saved={saved} />}
        >
            <SheetRoot>
                <SheetGrid />
            </SheetRoot>
        </BuilderFrame>
    );
}

implementUIComponent(SheetBuilderComponent, EastChakraSheetBuilder);
