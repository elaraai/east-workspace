/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The pane's Library tab (#939, `Query Editor Spec.md` §4.10) — this viewer's
 * recent runs and the saved queries, as a `Library`, as Studio's Pages tab is
 * one of the project's pages:
 *
 * - **groups**: Recent, the most recent first; then the saved queries by the
 *   data source they start from — "From orders" — each by name;
 * - **an item**: its name, and under it its description — the author's, else
 *   the sentence generated from its steps; the open query is placed;
 * - **a click** opens it: a saved query as itself; a recent run as the saved
 *   query of its name when there is one, else as a new query begun as the run;
 * - **a query whose data sources aren't bound here**, by name and by path,
 *   carries its reason, trailing, in the warning tone, and a click on it says
 *   so in a notice at the top of the tab instead of opening;
 * - the `Library`'s own search, over names and descriptions.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo, useState } from "react";
import { Box } from "@chakra-ui/react";
import { StringType, equalFor, none, some, variant } from "@elaraai/east";
import { SavedQueryType } from "@elaraai/e3-ui/internal";
import { BannerView, EastChakraLibrary, type LibraryItemValue, type LibraryValue } from "@elaraai/east-ui-components";
import { describeQuery } from "./model/words.js";
import type { QueryRoot } from "./one-shot.js";
import type { QueryOpen } from "./open-query.js";
import type { PartStyles } from "./parts.js";
import { entriesQuery, rootRefusal, savedEntries, type SavedQueries, type SavedQuery } from "./session.js";
import { checkSteps } from "./steps/check.js";

const nameEqual = equalFor(StringType);
const runEqual = equalFor(SavedQueryType);

/** What the tab knows of a query: the data source it starts from, its description, and why it can't open here. */
interface QueryAbout {
    readonly source: string;
    readonly description: string | undefined;
    readonly refusal: string | undefined;
}

/** Props of {@link LibraryTab}. */
export interface LibraryTabProps {
    /** The saved queries. */
    readonly record: SavedQueries;
    /** This viewer's recent runs, the most recent first. */
    readonly recent: readonly SavedQuery[];
    /** The root the builder's data sources make. */
    readonly root: QueryRoot;
    /** The open query. */
    readonly open: QueryOpen;
    /** Opens a saved query. */
    readonly onOpenSaved: (name: string) => void;
    /** Opens a recent run never saved, as a new query begun as it. */
    readonly onOpenRun: (run: SavedQuery) => void;
    /** The tab's library's id. */
    readonly id: string;
    /** The parts' styles, and the words. */
    readonly ps: PartStyles;
    /** Where the library keeps its state. */
    readonly storageKey: string;
}

/**
 * Renders the Library tab — see the module docs.
 *
 * @param props - The saved queries, the recent runs, the root, the open query and what a click does ({@link LibraryTabProps})
 * @returns The tab's notice, and its library
 */
export const LibraryTab = memo(function LibraryTab({ record, recent, root, open, onOpenSaved, onOpenRun, id, ps, storageKey }: LibraryTabProps) {
    const { styles, words } = ps;
    const m = words.messages;
    const [notice, setNotice] = useState<string | undefined>(undefined);

    // What each query is, once per record, run list and root.
    const about = useMemo(() => {
        return (saved: SavedQuery): QueryAbout => {
            const refusal = rootRefusal(saved, root, words);
            const authored = saved.description.type === "some" ? saved.description.value : undefined;
            const { header, query } = entriesQuery(savedEntries(saved, root.type));
            if (header.jq.type === "some") return { source: saved.root[0]?.name ?? "", description: authored, refusal };
            const generated = authored === undefined ? describeQuery(query, checkSteps(query, root.type), words) : "";
            return { source: query.source, description: authored ?? (generated === "" ? undefined : generated), refusal };
        };
    }, [root, words]);

    const savedList = useMemo(() => [...record.values()].map((saved) => ({ saved, about: about(saved) })), [record, about]);
    const runList = useMemo(() => recent.map((run) => ({ run, about: about(run) })), [recent, about]);

    const isOpenSaved = useCallback((name: string) => open.type === "saved" && nameEqual(open.value, name), [open]);
    // A run is the same run whenever it ran: running it again remembers it anew, as the recent list does.
    const isOpenRun = useCallback((run: SavedQuery) => open.type === "new" && open.value.from.type === "some"
        && runEqual({ ...open.value.from.value, saved_at: run.saved_at }, run), [open]);

    const onCardClick = useCallback((key: string) => {
        const [kind, rest] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
        if (kind === "saved") {
            const entry = savedList.find((s) => nameEqual(s.saved.name, rest));
            if (entry === undefined) return;
            if (entry.about.refusal !== undefined) setNotice(entry.about.refusal);
            else onOpenSaved(entry.saved.name);
            return;
        }
        const entry = runList[Number(rest)];
        if (entry === undefined) return;
        // A run of a saved query opens the query as it is saved now.
        const saved = savedList.find((s) => nameEqual(s.saved.name, entry.run.name));
        const refusal = saved?.about.refusal ?? entry.about.refusal;
        if (refusal !== undefined) setNotice(refusal);
        else if (saved !== undefined) onOpenSaved(saved.saved.name);
        else onOpenRun(entry.run);
    }, [savedList, runList, onOpenSaved, onOpenRun]);

    const value = useMemo((): LibraryValue => {
        const item = (key: string, name: string, about: QueryAbout, group: string, icon: string, placed: boolean): LibraryItemValue => ({
            key,
            label: name,
            sublabel: about.description === undefined ? none : some(about.description),
            icon: some(icon),
            status: none,
            trailing: about.refusal === undefined ? none : some({ icon: "triangle-exclamation", label: about.refusal, tone: some(variant("warning", null)) }),
            draggable: false,
            filtered: false,
            placed,
            media: none,
            avatar: none,
            byline: none,
            action: none,
            search: some(about.description === undefined ? name : `${name} ${about.description}`),
            groups: new Map([["group", group]]),
            facets: new Map(),
            dims: new Map(),
        });
        const runs = runList.map(({ run, about }, i) => {
            const saved = savedList.find((s) => nameEqual(s.saved.name, run.name));
            return item(`recent:${i}`, run.name, saved?.about ?? about, m.recentGroup(), "clock-rotate-left", saved === undefined ? isOpenRun(run) : isOpenSaved(run.name));
        });
        // The saved queries by the data source they start from, each by name; the record is in name order.
        const sources = [...new Set(savedList.map((s) => s.about.source))].sort();
        const saved = sources.flatMap((source) => savedList.filter((s) => s.about.source === source)
            .map((s) => item(`saved:${s.saved.name}`, s.saved.name, s.about, m.fromDatasetGroup({ dataset: source }), "diagram-project", isOpenSaved(s.saved.name))));
        return {
            id,
            hint: none,
            items: [...runs, ...saved],
            groupOptions: [{ key: "group", label: m.tab({ tab: "library" }) }],
            groupSummaries: new Map(),
            dimOptions: [],
            defaultDimensions: [],
            filterOptions: [],
            searchable: true,
            noun: some({ singular: m.savedNoun({ n: 1 }), plural: m.savedNoun({ n: 2 }) }),
            addLabel: none,
            onAdd: none,
            onCardClick: some((key: string) => { onCardClick(key); return null; }),
            slice: none,
            style: some({ height: some("fill"), maxHeight: none, virtualization: some(false), columns: none, mediaPlacement: none, mediaSize: none }),
            variant: none,
            layout: none,
            toolbar: true,
        };
    }, [runList, savedList, isOpenRun, isOpenSaved, onCardClick, id, m]);

    return (
        <>
            {notice !== undefined && (
                <Box css={styles.notices} data-query-library-notice="">
                    <BannerView status="warning" title={notice} dismissible onDismiss={() => setNotice(undefined)} />
                </Box>
            )}
            <EastChakraLibrary value={value} storageKey={storageKey} />
        </>
    );
});
