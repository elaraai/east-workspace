/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraQueryBuilder` — the renderer of the `QueryBuilder` extension
 * declared in `@elaraai/e3-ui` (#935): the query builder, built in the browser
 * from its interface — the saved queries record bound with its patch, the data
 * sources it may read, and its name.
 *
 * As Studio's builder is the canvas's, it is:
 * - **the record**, read where the builder renders and again when it moves;
 *   a failed read is a banner;
 * - **the root**, each bound data source a root field, by its name
 *   ({@link useQueryRoot});
 * - **the open query**, the UI store's under the builder's key, which the
 *   query library writes when it opens a query; it begins as a new query on
 *   the first bound data source;
 * - **the editing session**, one per open query ({@link useQuerySession}):
 *   every gesture of the surfaces is one transaction, which the history item
 *   in the one toolbar undoes, redoes and discards, and Apply — the builder's
 *   Save — commits the query as one patch on the record, once it is finished
 *   and checks;
 * - **the layout**: the one toolbar (#936: Visual · jq, the history item,
 *   Copy jq, Save… and Run); the pane, a `DockPane` with the tabs Query,
 *   Datasets and Library, its open tab and its collapse the builder's to
 *   drive; the results beside it; and the status line under both.
 *
 * The Query tab (#936) edits the open query ({@link useQueryEditor}), its
 * slots' autocomplete hanging inside the builder; Save… names and describes it
 * in the save popover, and saves it through the session's Apply. ⌘/Ctrl ⏎
 * anywhere in the builder runs it. The jq view's editor (#937), the results
 * (#938), and the Datasets and Library tabs (#939) fill the rest. The builder
 * fills its host and draws no border around itself.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Box, Button, useSlotRecipe } from "@chakra-ui/react";
import { StringType, equalFor, equivalentFor, variant, type ValueTypeOf, type option } from "@elaraai/east";
import { QueryBuilderComponent, QueryBuilderPayloadType, queryKeys } from "@elaraai/e3-ui/internal";
import {
    BannerView, DockPane, EmptyStateView, Toolbar, historyShortcut, historyToolbarItem, implementUIComponent, sessionErrorText, usePersistedState,
    useTrackedEvaluation,
    type EditIssue, type EditSession, type EditingWords,
} from "@elaraai/east-ui-components";
import { useE3ConfigOptional } from "../platform/e3-config.js";
import { SlotAutocomplete } from "./autocomplete.js";
import { useQueryCall, useQueryRoot, useQueryRun, useQuerySummaries } from "./hooks.js";
import { describeQuery, type QueryWords } from "./model/words.js";
import type { QueryRoot } from "./one-shot.js";
import { useOpenQuery, type QueryOpen } from "./open-query.js";
import { usePartStyles, type Styles } from "./parts.js";
import { QueryTabPanel } from "./query-tab.js";
import { QuerySavePopover } from "./save-popover.js";
import { entriesQuery, queryEntries, savedOffers, type QueryEntry, type SavedQueries } from "./session.js";
import { QueryStatusLine, type QuerySaveLine } from "./status-line.js";
import { queryToolbarItems } from "./toolbar.js";
import { useQueryEditor } from "./use-query-editor.js";
import { useQuerySession, type QuerySessionState } from "./use-query-session.js";
import { useQueryEditingWords, useQueryWords } from "./words.js";

/** The renderer's payload, decoded. */
type QueryBuilderValue = ValueTypeOf<typeof QueryBuilderComponent.schema>;

/** The payload's equivalence: its data, and its functions by their IR and what they capture. */
const payloadEquivalent = equivalentFor(QueryBuilderPayloadType);
const nameEqual = equalFor(StringType);

/** How long "Saved" keeps the success ink after a save. */
const SAVED_MS = 1800;

/** A tab of the pane. */
export type QueryTab = "query" | "datasets" | "library";

/** Where an issue the history item goes to is: its step, and its slot. */
export interface QueryFocus {
    /** The step's id, or `$query` for the query as a whole. */
    readonly entry: string;
    /** The slot, when the issue is on one. */
    readonly slot: string | undefined;
}

/** Props of {@link EastChakraQueryBuilder}. */
export interface EastChakraQueryBuilderProps {
    /** The payload, decoded. */
    value: QueryBuilderValue;
    /** The structural storage key. */
    storageKey: string;
}

/**
 * Why the open query cannot be saved now, in the history item's words: the
 * first issue — a problem, a step not finished, the source's refusal — else
 * the session's error, else its state: drafts gone stale under a change of the
 * record, or another save of the query still running.
 */
function refusalOf(session: EditSession<QueryEntry>, words: EditingWords): string {
    const readiness = session.readiness;
    const issues = readiness.type === "ready" ? session.issues : readiness.value;
    if (issues.length > 0) return issues[0]!.message;
    if (session.error !== undefined) return sessionErrorText(session.error, words);
    if (session.stale) return words.m.historyStatus({ status: "stale" });
    return words.m.historyStatus({ status: session.status === "idle" ? "applying" : session.status });
}

/** Whether a key press is typed into a field, whose own undo it is. */
function inField(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

/**
 * Renders the query builder — see the module docs.
 *
 * @param props - The payload and its storage key
 * @returns The builder
 */
export const EastChakraQueryBuilder = memo(function EastChakraQueryBuilder({ value, storageKey }: EastChakraQueryBuilderProps) {
    const words = useQueryWords();
    const m = words.messages;
    const { queries: handle, datasets } = value;
    const id = value.id.type === "some" ? value.id.value : undefined;
    const keys = useMemo(() => queryKeys(id), [id]);

    // The record, read where the builder renders, and again when it moves.
    const read = useCallback(() => handle.read(), [handle]);
    const { result } = useTrackedEvaluation(read);
    const record = result.ok ? result.value : undefined;

    // The root: each bound data source, by its name.
    const root = useQueryRoot(datasets, words);

    // The open query — a new query on the first data source until one is opened.
    const firstSource = datasets[0]?.name ?? "";
    const first = useMemo((): QueryOpen => variant("new", { id: "first", source: firstSource }), [firstSource]);
    const [open, writeOpen] = useOpenQuery(keys.query, first);
    const session = useQuerySession({ handle, record, root, open, writeOpen, storageKey: `${storageKey}.query`, words });

    if (!result.ok) {
        const message = result.error instanceof Error ? result.error.message : String(result.error);
        return <BannerView status="error" title={m.savedUnreadable({ message })} />;
    }
    if (typeof root === "string") return <BannerView status="error" title={root} />;
    if (session.entries === undefined || record === undefined) {
        const name = open.type === "saved" ? open.value : "";
        return <EmptyStateView icon={{ prefix: "fas", name: "magnifying-glass" }} title={m.queryGone({ name })} description={m.queryGoneHint()} />;
    }
    return (
        <QueryBuilderView session={session} entries={session.entries} record={record} root={root}
            writeOpen={writeOpen} words={words} storageKey={storageKey} />
    );
}, (prev, next) => payloadEquivalent(prev.value, next.value) && prev.storageKey === next.storageKey);

/** Props of {@link QueryBuilderView}. */
interface QueryBuilderViewProps {
    /** The open query's session. */
    readonly session: QuerySessionState;
    /** The query's entries as the drafts stand. */
    readonly entries: readonly QueryEntry[];
    /** The saved queries. */
    readonly record: SavedQueries;
    /** The root. */
    readonly root: QueryRoot;
    /** Opens another query. */
    readonly writeOpen: (next: QueryOpen) => void;
    /** The words. */
    readonly words: QueryWords;
    /** The structural storage key. */
    readonly storageKey: string;
}

/** The builder over a query it can edit: the toolbar, the pane, the results and the status line. */
function QueryBuilderView({ session: state, entries, record, root, writeOpen, words, storageKey }: QueryBuilderViewProps) {
    const ps = usePartStyles(words);
    const { styles } = ps;
    const seg = useSlotRecipe({ key: "seg" })() as Styles;
    const resultStyles = useSlotRecipe({ key: "queryResults" })() as Styles;
    const editingWords = useQueryEditingWords();
    const m = words.messages;
    const { session, sourceId, onAction, naming, setNaming, base } = state;
    const workspace = useE3ConfigOptional()?.workspace;
    const [element, setElement] = useState<HTMLDivElement | null>(null);
    const bounds = useCallback(() => element, [element]);

    // ── The pane: its open tab and its collapse, the builder's to drive ──
    const [tab, setTab] = useState<QueryTab>("query");
    const [focus, setFocus] = useState<QueryFocus | undefined>(undefined);
    const { state: pane, setState: setPane } = usePersistedState<{ collapsed: boolean }>(`${storageKey}.pane.collapsed`, { collapsed: false });
    const shown = useRef(sourceId);
    useEffect(() => {
        // Opening or starting a query opens the Query tab.
        if (shown.current === sourceId) return;
        shown.current = sourceId;
        setTab("query");
        setFocus(undefined);
    }, [sourceId]);
    const onTabChange = useCallback((key: string) => {
        if (key === "query" || key === "datasets" || key === "library") setTab(key);
    }, []);
    const onCollapsedChange = useCallback((collapsed: boolean) => setPane({ collapsed }), [setPane]);
    const onShowQuery = useCallback(() => {
        setTab("query");
        setPane({ collapsed: false });
    }, [setPane]);

    // ── Runs and summaries: one-shot calls ──────────────────────────────
    const call = useQueryCall();
    const { state: run, run: runProgram } = useQueryRun(root, call);
    const summaries = useQuerySummaries(root, call);
    const saved = useMemo(() => savedOffers(record, root), [record, root]);
    const onOpenSaved = useCallback((name: string) => writeOpen(variant("saved", name)), [writeOpen]);

    // ── Editing the open query ──────────────────────────────────────────
    const editor = useQueryEditor({
        entries, gesture: state.gesture, version: state.version, root, words, summaries, saved, onOpenSaved, onShowQuery, bounds, sourceId,
    });
    const onRun = useCallback(() => runProgram(editor.program), [runProgram, editor.program]);

    // ── The history item, and the keys ──────────────────────────────────
    const onIssue = useCallback((issue: EditIssue) => {
        onShowQuery();
        setFocus({ entry: issue.entry, slot: issue.field.type === "some" ? issue.field.value : undefined });
    }, [onShowQuery]);
    useEffect(() => {
        if (focus === undefined || element === null) return;
        for (const card of element.querySelectorAll<HTMLElement>("[data-step-id]")) {
            if (card.getAttribute("data-step-id") === focus.entry) card.scrollIntoView?.({ block: "nearest" });
        }
    }, [focus, element]);
    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented) return;
        // ⌘/Ctrl ⏎ runs, anywhere in the builder — a field too.
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            onRun();
            return;
        }
        if (inField(event.target)) return;
        const action = historyShortcut(event);
        if (action === undefined) return;
        event.preventDefault();
        onAction(action);
    }, [onRun, onAction]);

    // ── Saving ──────────────────────────────────────────────────────────
    const taken = useMemo(() => {
        const names = new Set<string>();
        for (const name of record.keys()) {
            if (base?.saved === undefined || !nameEqual(name, base.saved.name)) names.add(name);
        }
        return names;
    }, [record, base]);
    const generated = useMemo(() => (editor.checked === undefined ? "" : describeQuery(editor.query, editor.checked, words)),
        [editor.query, editor.checked, words]);
    const { leaveJq } = editor;
    const { current, gesture } = state;
    const onSave = useCallback(async (name: string, description: option<string>): Promise<string | undefined> => {
        // The jq as typed first, then the name and the description: one gesture each, on the drafts as they stand.
        leaveJq();
        const now = current();
        if (now === undefined) return undefined;
        const { header, query } = entriesQuery(now);
        gesture(queryEntries({ ...header, name, description }, query.steps), "typed", m.nameGesture());
        // Nothing to save closes the popover; drafts that cannot be saved say why, and keep it open.
        if (session.pending > 0 && !session.canApply) return refusalOf(session, editingWords);
        await session.apply();
        switch (session.status) {
            case "rejected": case "conflict": case "unknown": return refusalOf(session, editingWords);
            default: return undefined;
        }
    }, [leaveJq, current, gesture, session, editingWords, m]);
    const trigger = useMemo(() => <Button size="sm" variant="outline" data-query-save-open="">{m.saveAs()}</Button>, [m]);
    const savePopover = (
        <QuerySavePopover open={naming} onOpenChange={setNaming} trigger={trigger}
            name={editor.header.name} taken={taken} description={editor.header.description} generated={generated} onSave={onSave} />
    );

    // ── The save state: Saved for a moment after a save, then quiet ─────
    const [fresh, setFresh] = useState(false);
    useEffect(() => {
        let was = session.status;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const unsubscribe = session.subscribe(() => {
            if (was === "reconciling" && session.status === "idle") {
                setFresh(true);
                clearTimeout(timer);
                timer = setTimeout(() => setFresh(false), SAVED_MS);
            }
            was = session.status;
        });
        return () => {
            unsubscribe();
            clearTimeout(timer);
        };
    }, [session]);
    const saveState: QuerySaveLine["state"] = base?.saved === undefined ? "new" : session.pending > 0 ? "unsaved" : "saved";
    const save: QuerySaveLine = { state: saveState, fresh: fresh && saveState === "saved", word: m.saveState({ state: saveState }) };

    // ── The layout ──────────────────────────────────────────────────────
    const toolbar = queryToolbarItems({
        view: editor.view,
        onView: editor.setView,
        history: historyToolbarItem({ session, words: editingWords, editing: false, onIssue, onAction }),
        copyText: () => editor.program,
        save: savePopover,
        saving: naming,
        running: run.status === "running",
        onRun,
        words,
        styles,
        seg,
    });
    const tabs = (["query", "datasets", "library"] as const).map((key) => ({
        key,
        label: m.tab({ tab: key }),
        body: key === "query"
            ? <QueryTabPanel editor={editor} ps={ps} workspace={workspace} focus={focus?.entry} />
            : <Box css={styles.tab} data-query-tab={key} />,
    }));
    const popover = editor.popover;
    return (
        <Box ref={setElement} css={styles.root} data-query-builder="" data-query-open={sourceId} data-query-naming={naming ? "" : undefined}
            data-query-focus={focus === undefined ? undefined : focus.entry} onKeyDown={onKeyDown}>
            <Box css={styles.toolbar} data-slot="toolbar">
                <Toolbar items={toolbar} />
            </Box>
            <Box css={styles.body}>
                <DockPane
                    storageKey={`${storageKey}.pane`}
                    icon="diagram-project"
                    label={m.pane()}
                    badge={words.formatters.number(editor.query.steps.length)}
                    side="start"
                    surface="shell"
                    expandedSize={editor.view === "jq" ? "min(640px, 52%)" : "min(480px, 52%)"}
                    railSize="44px"
                    collapsed={pane.collapsed}
                    onCollapsedChange={onCollapsedChange}
                    tabs={tabs}
                    tab={tab}
                    onTabChange={onTabChange}
                />
                <Box css={styles.results} data-query-results="">
                    <Box css={resultStyles.root}>
                        <Box css={resultStyles.body} />
                        <Box css={resultStyles.footer} />
                    </Box>
                </Box>
            </Box>
            <QueryStatusLine check={editor.check} gives={editor.gives} save={save} name={editor.header.name} />
            {popover !== undefined && element !== null && (
                <SlotAutocomplete key={popover.generation} anchor={popover.slot.anchor} bounds={element}
                    label={popover.label} placeholder={popover.placeholder} hint={popover.hint} empty={popover.empty} keys={popover.keys}
                    items={popover.items} text={popover.text} onText={popover.onText} initialActive={popover.initialActive}
                    onPick={popover.onPick} onClose={popover.onClose} />
            )}
        </Box>
    );
}

implementUIComponent(QueryBuilderComponent, EastChakraQueryBuilder);
