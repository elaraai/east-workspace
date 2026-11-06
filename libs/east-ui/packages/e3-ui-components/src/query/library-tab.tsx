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
import { Box, chakra } from "@chakra-ui/react";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { StringType, equalFor, none, some, variant } from "@elaraai/east";
import { SavedQueryType } from "@elaraai/e3-ui/internal";
import { BannerView, EastChakraLibrary, type LibraryItemValue, type LibraryValue } from "@elaraai/east-ui-components";
import { queryAbout, type QueryAbout } from "./about.js";
import type { QueryRoot } from "./one-shot.js";
import type { QueryOpen } from "./open-query.js";
import type { PartStyles } from "./parts.js";
import type { SavedQueries, SavedQuery } from "./session.js";

const nameEqual = equalFor(StringType);
const runEqual = equalFor(SavedQueryType);

/** Props of {@link LibraryTab}. */
/** What a card takes of a phone's width beside its description: the list's 16 each side, the card's 12 each side and its rule, the tile and its gap, the trailing glyph and its gap. */
const PHONE_CARD_INSET = 32 + 24 + 2 + 36 + 12 + 24;

let measuring: CanvasRenderingContext2D | null | undefined;

/**
 * A description as two lines at most, ending on a whole word and `…` (QP36): what
 * a line clamp cannot do, which cuts where the room ends.
 *
 * @param text - The description
 * @param width - The room each line has, px
 * @returns The text to show
 */
function twoLines(text: string, width: number): string {
    if (measuring === undefined) measuring = document.createElement("canvas").getContext("2d");
    if (measuring === null) return text;
    const probe = document.createElement("span");
    probe.style.fontFamily = "var(--chakra-fonts-body)";
    document.body.appendChild(probe);
    measuring.font = `400 12.5px ${getComputedStyle(probe).fontFamily}`;
    probe.remove();
    const context = measuring;
    const fits = (line: string) => context.measureText(line).width <= width;
    const words = text.split(" ");
    let line = "";
    let lines = 1;
    for (let i = 0; i < words.length; i++) {
        const next = line === "" ? words[i]! : `${line} ${words[i]!}`;
        if (fits(next)) { line = next; continue; }
        if (lines === 2) {
            // The room for the ellipsis, in whole words.
            let last = i;
            while (last > 0 && !fits(`${words.slice(last - countOnLine(words, last, line), last).join(" ")}…`)) last -= 1;
            return `${words.slice(0, last).join(" ")}…`;
        }
        lines = 2;
        line = words[i]!;
    }
    return text;
}

/** How many of the words before an index stand on the line. */
function countOnLine(words: readonly string[], end: number, line: string): number {
    let count = 0;
    let at = line.length;
    for (let i = end - 1; i >= 0 && at > 0; i--) { at -= words[i]!.length + 1; count += 1; }
    return count;
}

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
    /** A phone's builder's width: each description two lines at most, ending on a whole word (QP36). */
    readonly phoneWidth?: number | undefined;
}

/**
 * Renders the Library tab — see the module docs.
 *
 * @param props - The saved queries, the recent runs, the root, the open query and what a click does ({@link LibraryTabProps})
 * @returns The tab's notice, and its library
 */
export const LibraryTab = memo(function LibraryTab({ record, recent, root, open, onOpenSaved, onOpenRun, id, ps, storageKey, phoneWidth }: LibraryTabProps) {
    const { styles, words } = ps;
    const m = words.messages;
    const phone = useSlotStyles("queryPhone");
    const [notice, setNotice] = useState<string | undefined>(undefined);

    // What each query is — the data source it starts from, its description, why it can't open here — once per record, run list and root.
    const about = useCallback((saved: SavedQuery): QueryAbout => queryAbout(saved, root, words), [root, words]);

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
            sublabel: about.description === undefined ? none : some(phoneWidth === undefined ? about.description : twoLines(about.description, phoneWidth - PHONE_CARD_INSET)),
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
    }, [runList, savedList, isOpenRun, isOpenSaved, onCardClick, id, m, phoneWidth]);

    // A search that hides every query, on a phone (QP37): the × glyph, what it looked for, a checklist and the way back.
    const noMatchView = useCallback((query: string, clear: () => void) => (
        <Box css={phone.noMatch} data-library-empty="" data-query-no-match="">
            <Box as="span" css={phone.emptyGlyph} aria-hidden>×</Box>
            <Box css={phone.emptyTitle}>{m.noMatch({ text: query })}</Box>
            <Box as="ul" css={phone.emptyList}><li>{m.checkSpelling()}.</li><li>{m.clearSearchEvery()}</li></Box>
            <chakra.button type="button" css={phone.emptyLink} onClick={clear}>{m.clearTheSearch()} →</chakra.button>
        </Box>
    ), [m, phone]);
    return (
        <>
            {notice !== undefined && (
                <Box css={styles.notices} data-query-library-notice="">
                    <BannerView status="warning" title={notice} dismissible onDismiss={() => setNotice(undefined)} />
                </Box>
            )}
            <EastChakraLibrary value={value} storageKey={storageKey} noMatchView={phoneWidth === undefined ? undefined : noMatchView} />
        </>
    );
});
