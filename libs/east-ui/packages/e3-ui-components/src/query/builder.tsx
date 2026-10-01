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
 * This is its shell, as Studio's builder is the canvas's:
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
 * - **the layout**: the one toolbar; the pane, a `DockPane` with the tabs
 *   Query, Datasets and Library, its open tab the builder's to drive; the
 *   results beside it; and the status line under both.
 *
 * The surfaces fill it: the Query tab, the toolbar's items and the status
 * line (#936), the jq view (#937), the results (#938), and the Datasets and
 * Library tabs (#939). The builder fills its host and draws no border around
 * itself.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Box, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { equivalentFor, variant, type ValueTypeOf } from "@elaraai/east";
import { QueryBuilderComponent, QueryBuilderPayloadType, queryKeys } from "@elaraai/e3-ui/internal";
import {
    BannerView, DockPane, EmptyStateView, Toolbar, historyShortcut, historyToolbarItem, implementUIComponent, useTrackedEvaluation,
    type EditIssue, type ToolbarItem,
} from "@elaraai/east-ui-components";
import { useQueryRoot } from "./hooks.js";
import { useOpenQuery, type QueryOpen } from "./open-query.js";
import { entriesQuery } from "./session.js";
import { useQuerySession } from "./use-query-session.js";
import { useQueryEditingWords, useQueryWords } from "./words.js";

type Styles = Record<string, SystemStyleObject>;

/** The renderer's payload, decoded. */
type QueryBuilderValue = ValueTypeOf<typeof QueryBuilderComponent.schema>;

/** The payload's equivalence: its data, and its functions by their IR and what they capture. */
const payloadEquivalent = equivalentFor(QueryBuilderPayloadType);

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
    const styles = useSlotRecipe({ key: "queryBuilder" })() as Styles;
    const resultStyles = useSlotRecipe({ key: "queryResults" })() as Styles;
    const words = useQueryWords();
    const editingWords = useQueryEditingWords();
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
    const query = useQuerySession({ handle, record, root, open, writeOpen, storageKey: `${storageKey}.query`, words });
    const { session, sourceId, entries, onAction, naming } = query;

    // ── The pane's open tab, the builder's to drive ─────────────────────
    const [tab, setTab] = useState<QueryTab>("query");
    const [focus, setFocus] = useState<QueryFocus | undefined>(undefined);
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

    // ── The history item, and its keys ──────────────────────────────────
    const onIssue = useCallback((issue: EditIssue) => {
        setTab("query");
        setFocus({ entry: issue.entry, slot: issue.field.type === "some" ? issue.field.value : undefined });
    }, []);
    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (inField(event.target)) return;
        const action = historyShortcut(event);
        if (action === undefined) return;
        event.preventDefault();
        onAction(action);
    }, [onAction]);
    const toolbar: ReadonlyArray<ToolbarItem> = [
        historyToolbarItem({ session, words: editingWords, editing: false, onIssue, onAction }),
    ];

    if (!result.ok) {
        const message = result.error instanceof Error ? result.error.message : String(result.error);
        return <BannerView status="error" title={m.savedUnreadable({ message })} />;
    }
    if (typeof root === "string") return <BannerView status="error" title={root} />;
    if (entries === undefined) {
        const name = open.type === "saved" ? open.value : "";
        return <EmptyStateView icon={{ prefix: "fas", name: "magnifying-glass" }} title={m.queryGone({ name })} description={m.queryGoneHint()} />;
    }
    const steps = entriesQuery(entries).query.steps;
    const tabs = (["query", "datasets", "library"] as const).map((key) => ({
        key,
        label: m.tab({ tab: key }),
        body: <Box css={styles.tab} data-query-tab={key} />,
    }));
    return (
        <Box css={styles.root} data-query-builder="" data-query-open={sourceId} data-query-naming={naming ? "" : undefined}
            data-query-focus={focus === undefined ? undefined : focus.entry} onKeyDown={onKeyDown}>
            <Box css={styles.toolbar} data-slot="toolbar">
                <Toolbar items={toolbar} />
            </Box>
            <Box css={styles.body}>
                <DockPane
                    storageKey={`${storageKey}.pane`}
                    icon="diagram-project"
                    label={m.pane()}
                    badge={words.formatters.number(steps.length)}
                    side="start"
                    surface="shell"
                    expandedSize="min(480px, 52%)"
                    railSize="44px"
                    persist="local"
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
            <Box css={styles.status} data-query-status="" />
        </Box>
    );
}, (prev, next) => payloadEquivalent(prev.value, next.value) && prev.storageKey === next.storageKey);

implementUIComponent(QueryBuilderComponent, EastChakraQueryBuilder);
