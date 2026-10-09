/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraSheet` — the renderer of the `Sheet` extension declared in
 * `@elaraai/e3-ui` (#1216, `Sheet Builder Spec.md` §7, §8, SB18–SB24): the
 * one Sheet, laid out in `BuilderFrame` wherever it is used. There is no
 * other Sheet: no layout without the frame, and no toolbar but its one.
 *
 * The payload's `sheet` is the grid's root whole, and `SheetProvider` builds
 * its one shared state from it — the store, the editing session, the lens
 * and the selection. The frame places the sheet's parts in its regions:
 *
 * - **the toolbar** — the sheet's items (`useSheetToolbarItems`) on the
 *   frame's one folding row, in §7.1's order: the view tabs, the context
 *   switch, the match count, the key search, the slice's rail, the scope
 *   badge, and the history item, which leaves its error to the banners. ⌘F
 *   in the grid reaches the key search in it — its box, or, folded to its
 *   icon, the box in its popover (#1221) — else the rail's search box. A sheet
 *   with none of them — read only, with no slice and no key search — has no
 *   toolbar;
 * - **the banners** — the session's (`SessionBanners`): an Apply's conflict,
 *   naming its rows and who changed the record last; a refusal, with its
 *   reason; an unknown outcome and a failed confirmation read, each with
 *   Retry; the out-of-date notice, with Discard — and last, an `entry` the
 *   record does not hold;
 * - **the library**, the start pane, when the sheet is given one — its tabs
 *   the ones `library` lists, and no pane when it lists none (#1186, SB59) —
 *   and **the inspector**, the end pane, when the sheet is given one —
 *   Details for what is selected, its every field through the pane's form or
 *   the author's own Details, and the batch's Issues (#1188): `BuilderFrame`'s
 *   panes, whose open tab and collapsed state persist under the sheet's
 *   `name`. The library's Columns tab hides columns from the grid, per viewer,
 *   under the sheet's `name` too (SB36); a sheet whose library lists no
 *   Columns tab hides none;
 * - **main** — the grid, filling the room the panes leave and scrolling its
 *   own rows, the strip docked under it;
 * - **the footer** — the sheet's, and over a record its last save, from the
 *   record's commits, which the inspector also says with who made it.
 *
 * ⌘Z undoes and ⇧⌘Z or ⌘Y redoes from anywhere in the frame — a pane, the
 * toolbar — as the history item does (#1185, SB26): the grid answers its own,
 * and a field being typed into keeps its own undo.
 *
 * The sheet takes drops (#1187, SB38–SB40, SB44, SB45, SB61) on its own
 * surface (`sheetKeys(name).surface`): the Rows tab's templates, and the
 * cards of every author's tab that declares a `drop` — each card's cells the
 * patch it sets — while its rows' grips move rows, lines and groups.
 *
 * The sheet fills its parent and draws no border.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo, type KeyboardEvent } from "react";
import { Box } from "@chakra-ui/react";
import { StringType, equalFor, equivalentFor, none, some, type ValueTypeOf } from "@elaraai/east";
import { SheetComponent, SheetPayloadType, sheetKeys } from "@elaraai/e3-ui/internal";
import {
    BannerView, BuilderFrame, SessionBanners, getSomeorUndefined, historyShortcut, implementUIComponent, typedInto, usePersistedState, useTrackedEvaluation,
    type EditIssue,
} from "@elaraai/east-ui-components";
import type { SheetDropCard, SheetDropHost, SheetDropTemplate } from "../drop.js";
import { SheetFooter } from "../Footer.js";
import { SheetGrid, SheetProvider, SheetRoot, useSheetFooter, useSheetHistory, useSheetToolbarItems, useSheetToolbarRef, type SheetHost } from "../index.js";
import { todayUtc } from "../parse/date.js";
import { issueText, useSheetWords, type SheetWords } from "../words.js";
import { useSheetInspector, type SheetLastCommit } from "./inspector.js";
import { tabLibrary, templatesLibrary, useSheetLibrary } from "./library.js";

/** The renderer's payload, decoded. */
export type SheetValue = ValueTypeOf<typeof SheetPayloadType>;

/** The names the sheet keeps its viewer's state under. */
type SheetKeys = ReturnType<typeof sheetKeys>;

/** The payload's equivalence: its data, and its functions by their IR and what they capture. */
const payloadEquivalent = equivalentFor(SheetPayloadType);
const stringEqual = equalFor(StringType);

/** No column hidden: what a viewer who has hidden none keeps. */
const NONE_HIDDEN: readonly string[] = [];

/** No column hidden, as the grid reads it. */
const NO_COLUMN_HIDDEN: ReadonlySet<string> = new Set();

/**
 * What the sheet takes dropped (#1187): on its surface, the Rows tab's
 * templates — each seeded as `newRow`'s or `newGroup`'s seed with its fields
 * over them — and the cards of every author's tab that declares a `drop`,
 * each card's cells the patch it sets.
 *
 * @param value - The payload
 * @param keys - The sheet's keys
 * @returns The sheet's drop host
 */
function dropHostOf(value: SheetValue, keys: SheetKeys): SheetDropHost {
    const listsRows = value.library.some((tab) => tab.type === "rows");
    const templates = new Map(value.templates.map((t): [string, SheetDropTemplate] => [t.key, {
        name: t.name,
        kind: t.seed.type,
        seeds: t.seed.type === "row" ? { newRow: some(t.seed.value) } : { newGroup: some(t.seed.value) },
    }]));
    const tabs = new Map(value.library.flatMap((tab) => (tab.type === "tab" && tab.value.drop.type === "some"
        ? [[tabLibrary(keys, tab.value), {
            lands: tab.value.drop.value.type,
            cards: new Map(tab.value.cards.map((card): [string, SheetDropCard] => [card.key, { label: card.label, sets: card.sets }])),
        }] as const]
        : [])));
    return { surface: keys.surface, templates: listsRows ? { library: templatesLibrary(keys), byKey: templates } : undefined, tabs };
}

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

/** Props of {@link EastChakraSheet}. */
export interface EastChakraSheetProps {
    /** The payload, decoded. */
    value: SheetValue;
    /** The structural storage key. */
    storageKey: string;
}

/**
 * The record's last commit (SB22, SB51): its newest commit's time, as the
 * day's time when it was today and in full otherwise, and who made it.
 *
 * @param history - The payload's `history`: over a record, its commits, newest first; `none` over `data`
 * @param words - The sheet's words
 * @returns The last commit, or `undefined` over `data`, while the commits are unread, or when there are none
 */
function useLastCommit(history: SheetValue["history"], words: SheetWords): SheetLastCommit | undefined {
    const commits = getSomeorUndefined(history);
    // Read where the sheet renders, and again when the record moves.
    const read = useCallback(() => (commits === undefined ? none : commits()), [commits]);
    const { result } = useTrackedEvaluation(read);
    const last = result.ok && result.value.type === "some" ? result.value.value[0] : undefined;
    const when = last === undefined ? undefined : stringEqual(words.date(last.at), words.date(todayUtc())) ? words.time(last.at) : words.dateTime(last.at);
    const by = last?.actor;
    // Held by its words: a render that reads the same commit hands the inspector the same one.
    return useMemo(() => (when === undefined || by === undefined ? undefined : { when, by }), [when, by]);
}

/**
 * Renders the Sheet — see the module docs.
 *
 * @param props - The payload and its storage key
 * @returns The sheet, in its frame
 */
export const EastChakraSheet = memo(function EastChakraSheet({ value, storageKey }: EastChakraSheetProps) {
    const name = getSomeorUndefined(value.name);
    const keys = useMemo(() => sheetKeys(name), [name]);
    // The columns this viewer hides (SB36), kept under the sheet's name: the
    // grid leaves them out, and the library's Columns tab shows and hides them.
    // A sheet without that tab hides none — nothing on it could show them
    // again, and another sheet under the same name may have hidden them.
    const { state: stored, setState: store } = usePersistedState<readonly string[]>(keys.columns, NONE_HIDDEN);
    const listsColumns = value.library.some((tab) => tab.type === "columns");
    const hidden = useMemo(() => (listsColumns ? hiddenOf(stored) : NO_COLUMN_HIDDEN), [listsColumns, stored]);
    const onToggleColumn = useCallback((key: string) => {
        store((was) => {
            const off = [...hiddenOf(was)];
            return off.some((k) => stringEqual(k, key)) ? off.filter((k) => !stringEqual(k, key)) : [...off, key];
        });
    }, [store]);
    // What the sheet takes dropped: its templates and its author's cards, on its own surface (#1187).
    const drop = useMemo(() => dropHostOf(value, keys), [value, keys]);
    // What the frame hands the parts: the columns the viewer hid, and the drops the sheet takes.
    const host = useMemo((): SheetHost => ({ hidden, drop }), [hidden, drop]);
    return (
        <SheetProvider value={value.sheet} storageKey={storageKey} host={host}>
            <SheetFrame value={value} keys={keys} hidden={hidden} onToggleColumn={onToggleColumn} />
        </SheetProvider>
    );
}, (prev, next) => payloadEquivalent(prev.value, next.value) && prev.storageKey === next.storageKey);

/** Props of {@link SheetFrame}. */
interface SheetFrameProps {
    /** The payload, decoded. */
    value: SheetValue;
    /** The names the sheet keeps its viewer's state under. */
    keys: SheetKeys;
    /** The columns this viewer hides. */
    hidden: ReadonlySet<string>;
    /** Hides a column, or shows it again. */
    onToggleColumn: (key: string) => void;
}

/** The frame, its regions holding the sheet's parts. */
function SheetFrame({ value, keys, hidden, onToggleColumn }: SheetFrameProps) {
    const words = useSheetWords();
    const { m } = words;
    const items = useSheetToolbarItems();
    const toolbarRef = useSheetToolbarRef();
    const footer = useSheetFooter();
    const { session, onAction } = useSheetHistory();
    const lastCommit = useLastCommit(value.history, words);
    const saved = lastCommit === undefined ? undefined : m.savedAt({ when: lastCommit.when });
    const library = useSheetLibrary({ value, keys, hidden, onToggleColumn, words });
    const inspector = useSheetInspector({ value, keys, words, hidden, lastCommit });
    // An issue's place: its row's key, or on a grouped sheet its line in its group.
    const where = useCallback((issue: EditIssue) => (issue.entry === "" || issue.row.type === "none" ? issue.entry
        : m.rowRef({ line: true, number: words.number(Number(issue.row.value) + 1), title: issue.entry, noun: m.groupNoun() })), [m, words]);
    const readIssue = useCallback((message: string) => issueText(message, words), [words]);
    // The history keys from anywhere in the frame (SB26): the grid's own it has answered already.
    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || typedInto(event.target)) return;
        const action = historyShortcut(event);
        if (action === undefined) return;
        event.preventDefault();
        onAction(action);
    }, [onAction]);
    const missing = getSomeorUndefined(value.missing);
    // A sheet with no control to show — read only, no slice, no key search — draws no toolbar.
    const toolbar = items.some((item) => item !== undefined && item !== false) ? items : undefined;
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
            toolbar={toolbar}
            toolbarRef={toolbarRef}
            banners={banners}
            start={library}
            end={inspector}
            footer={<SheetFooter {...footer} saved={saved} />}
            onKeyDown={onKeyDown}
        >
            <SheetRoot>
                <SheetGrid />
            </SheetRoot>
        </BuilderFrame>
    );
}

implementUIComponent(SheetComponent, EastChakraSheet);
