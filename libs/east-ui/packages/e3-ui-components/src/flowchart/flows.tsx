/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flows tab (#1246, `Flowchart Builder Spec.md` decision 5, §8, FB13,
 * FB14) — every flow the flowchart holds, by name, as a `Library`, as the
 * query builder's Library tab lists the saved queries:
 *
 * - **a card** — the flow's name — the new one while its drafts rename it
 *   (#1250) — and under it its description, or with none its counts (`4
 *   lanes · 9 states · 11 transitions`); the open flow is placed; a flow
 *   whose drafts are not yet saved carries the Pending chip;
 * - **a click** opens it on the canvas;
 * - the `Library`'s own search, over names and descriptions;
 * - **"+ New flow"** under the cards, where the flowchart edits: the shared
 *   `NamePopover` hangs from it, refuses a name the flowchart holds with the
 *   reason, and hands a new one to the flowchart, which opens it;
 * - **no flow at all** — the shared empty state saying so (FB28), with no
 *   button and no foot: main's empty state carries "+ New flow" (§7).
 *
 * `NoFlows` is that empty state: the tab's, and main's over flows by name with
 * none (`Flowchart Builder Spec.md` §7), which alone carries "+ New flow".
 * Every icon is Font Awesome's solid set; every style is the `flowchart`
 * recipe's or the shared parts'.
 *
 * Over a record its slice's `flows` source pages (#1346), the tab is the
 * shared paged Library (`PagedFlowsTab`): the flows the rail narrows the
 * record to, a window at a time, each card the flow as its drafts stand; while
 * the rail leaves it none, the shared empty state says so with the rail's
 * Clear filters for the `flows` source alone; and its search box finds a flow
 * within the narrowing, by the fields the source lists in `search`, the tab's
 * own — never the rail's, nor any count's. New flows not yet saved sit above
 * the list, whatever the narrowing. Its count is the frame's
 * ({@link FlowsCountReader}).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { StringType, equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType, RecordSliceWhereType } from "@elaraai/east-ui/internal";
import {
    EastChakraLibrary, EmptyStateView, getSomeorUndefined, useSliceReactivity, useTrackedEvaluation,
    type LibraryEmpty, type LibraryItemValue, type LibraryNarrowing, type LibraryValue,
} from "@elaraai/east-ui-components";
import { LibraryCard, PagedLibrary, type PagedLibrarySearch } from "@elaraai/east-ui-components/internal";
import type { FlowchartPagedRecord } from "./window.js";
import { draftedEntry, type FlowSessions } from "./session.js";
import { NamePopover } from "../shared/name-popover.js";
import type { FlowchartWords } from "./messages.js";
import type { FlowchartFlowValue } from "./model.js";

type Styles = Record<string, SystemStyleObject>;

const nameEqual = equalFor(StringType);

/** A flow's card in the Flows tab: its name, the name its drafts give it, the flow as its drafts stand, and whether it has drafts. */
export interface FlowCard {
    /** The flow's name: its key, and its session's — what a click on its card opens. */
    readonly name: string;
    /** The name its card shows: the one its drafts give it — a rename drafted, its new one (#1250) — else its name. */
    readonly label: string;
    /** The flow, as its drafts stand. */
    readonly flow: FlowchartFlowValue;
    /** Whether its drafts are not yet saved. */
    readonly pending: boolean;
}

/** What "+ New flow" needs: the names the flowchart holds, and what a new name does. */
export interface NewFlowProps {
    /** Every name the flowchart holds: its flows, and its new flows not yet saved. */
    readonly taken: ReadonlySet<string>;
    /** Starts a flow of a new name. */
    readonly onCreate: (name: string) => void | Promise<string | undefined>;
}

/** The flows' cards fill the pane and scroll there. */
const FILL = some({ height: some("fill"), maxHeight: none, virtualization: some(true), columns: none, mediaPlacement: none, mediaSize: none });

/** A flow's icon, on its card and in the empty state: Font Awesome's solid set. */
const FLOW_ICON = "diagram-project";

/**
 * A flow's card, as the Library draws it.
 *
 * @param card - The flow, and whether it has drafts
 * @param placed - Whether it is the open flow
 * @param words - The flowchart's words
 * @returns The card
 */
export function flowItem(card: FlowCard, placed: boolean, words: FlowchartWords): LibraryItemValue {
    const m = words.m;
    const description = getSomeorUndefined(card.flow.description);
    const count = (n: number) => ({ n, count: words.number(n) });
    const line = description ?? m.flowCounts({
        lanes: count(card.flow.lanes.length), states: count(card.flow.states.length), transitions: count(card.flow.links.length),
    });
    return {
        key: card.name,
        label: card.label,
        sublabel: some(line),
        icon: some(FLOW_ICON),
        status: card.pending ? some({ label: m.flowPending(), tone: variant("info", null), ring: false }) : none,
        trailing: none,
        draggable: false,
        filtered: false,
        placed,
        media: none,
        avatar: none,
        byline: none,
        action: none,
        // The tab's search reads names and descriptions (FB13).
        search: some(description === undefined ? card.label : `${card.label} ${description}`),
        groups: new Map(),
        facets: new Map(),
        dims: new Map(),
    };
}

/**
 * "+ New flow" (FB14): the button, and the shared name popover hanging from
 * it — a name the flowchart holds refused there, with the reason; a new one
 * handed to the flowchart.
 *
 * @param props - The names held, what a new name does, the recipe's styles and the words
 * @returns The button, and the popover while open
 */
export function NewFlow({ taken, onCreate, styles, words }: NewFlowProps & { readonly styles: Styles; readonly words: FlowchartWords }) {
    const m = words.m;
    const [open, setOpen] = useState(false);
    return (
        <NamePopover
            open={open}
            onOpenChange={setOpen}
            trigger={
                <chakra.button type="button" css={styles.newFlow} data-flowchart-new-flow="">
                    <FontAwesomeIcon icon={faPlus} aria-hidden />
                    {m.newFlow()}
                </chakra.button>
            }
            label={m.newFlow()}
            placeholder={m.flowName()}
            initial=""
            taken={taken}
            missing={m.flowNameMissing()}
            nameTaken={(name) => m.flowNameTaken({ name })}
            confirm={m.createFlow()}
            cancel={m.cancel()}
            onConfirm={async (name) => {
                return (await onCreate(name)) ?? undefined;
            }}
        />
    );
}

/**
 * The flowchart with no flow: the shared empty state — the Flows tab's, which
 * only says so (FB28), and main's over flows by name with none, with "+ New
 * flow" in it where the flowchart edits (§7).
 *
 * @param props - "+ New flow", given to main's where the flowchart edits; the recipe's styles and the words
 * @returns The empty state
 */
export function NoFlows({ newFlow, styles, words }: { readonly newFlow: NewFlowProps | undefined; readonly styles: Styles; readonly words: FlowchartWords }) {
    const m = words.m;
    return (
        <Box css={styles.noFlows} data-flowchart-no-flows="">
            <EmptyStateView
                icon={{ prefix: "fas", name: FLOW_ICON }}
                title={m.flowsEmpty()}
                description={m.flowsEmptyHint({ canAdd: newFlow !== undefined })}
                actions={newFlow === undefined ? undefined : <NewFlow {...newFlow} styles={styles} words={words} />}
            />
        </Box>
    );
}

/** Props of {@link FlowsTab}. */
export interface FlowsTabProps {
    /** Every flow the flowchart holds, in name order. */
    readonly cards: readonly FlowCard[];
    /** The open flow's name. */
    readonly open: string | undefined;
    /** Opens a flow. */
    readonly onOpen: (name: string) => void;
    /** "+ New flow" under the cards, where the flowchart edits. An empty tab has none: main's empty state carries it. */
    readonly newFlow: NewFlowProps | undefined;
    /** The tab's library's id. */
    readonly id: string;
    /** Where the library keeps its state. */
    readonly storageKey: string;
    /** The `flowchart` recipe's styles. */
    readonly styles: Styles;
    /** The flowchart's words. */
    readonly words: FlowchartWords;
}

/**
 * The Flows tab — see the module docs.
 *
 * @param props - The flows, the open one, what a click and a new name do, and where the library keeps its state
 * @returns The tab's body
 */
export function FlowsTab({ cards, open, onOpen, newFlow, id, storageKey, styles, words }: FlowsTabProps) {
    const m = words.m;
    const value = useMemo((): LibraryValue => ({
        id,
        hint: none,
        items: cards.map((card) => flowItem(card, open !== undefined && nameEqual(card.name, open), words)),
        groupOptions: [],
        groupSummaries: new Map(),
        dimOptions: [],
        defaultDimensions: [],
        filterOptions: [],
        searchable: true,
        noun: some({ singular: m.flowNoun({ n: 1 }), plural: m.flowNoun({ n: 2 }) }),
        addLabel: none,
        onAdd: none,
        onCardClick: some((key: string) => { onOpen(key); return null; }),
        slice: none,
        style: FILL,
        variant: none,
        layout: none,
        toolbar: true,
    }), [id, cards, open, onOpen, words, m]);
    // No flow: the tab says so, and no more (FB28) — main's empty state carries "+ New flow" (§7).
    if (cards.length === 0) return <NoFlows newFlow={undefined} styles={styles} words={words} />;
    return (
        <Box css={styles.flowsTab} data-flowchart-flows="">
            <Box css={styles.flowsList}>
                <EastChakraLibrary value={value} storageKey={storageKey} />
            </Box>
            {newFlow !== undefined && (
                <Box css={styles.flowsFoot}>
                    <NewFlow {...newFlow} styles={styles} words={words} />
                </Box>
            )}
        </Box>
    );
}

/** The slice's `flows` source's part, decoded: what narrows the Flows tab (#1346). */
type FlowsPart = ValueTypeOf<RecordSliceBindType>;

/** A row of the paged Flows tab: a flow, by its name — the record's key. */
type FlowRowValue = { readonly name: string; readonly flow: FlowchartFlowValue };

/**
 * The record's paged flow list, as the rail narrows it (#1346): drafts
 * overlaid by the flows' original names; the rail's empty state and Clear
 * filters while it narrows; the tab's own search within it.
 *
 * @param props - The paged record, the `flows` source's part, the sessions, the new flows not yet saved, and the tab's props
 * @returns The tab's body
 */
export function PagedFlowsTab({ source, part, sessions, fresh, ...props }: Omit<FlowsTabProps, "cards"> & {
    source: FlowchartPagedRecord;
    /** The slice's `flows` source's part: its narrowing, its Clear filters, and the search's reads within it. */
    part: FlowsPart | undefined;
    sessions: FlowSessions;
    fresh: readonly FlowCard[];
}) {
    const { id, styles, words, open, onOpen, newFlow } = props;
    const m = words.m;
    const libraryStyles = useSlotRecipe({ key: "library" })() as Styles;
    // While the rail narrows the flows: what the tab says when that leaves it none, and the `flows` source's own Clear filters.
    useSliceReactivity(part?.key);
    const narrows = part !== undefined && part.read().where.size > 0;
    const narrowing = useMemo((): LibraryNarrowing | undefined => (part === undefined || !narrows ? undefined : {
        empty: { title: m.flowsFiltered({ part: "title" }), description: m.flowsFiltered({ part: "hint" }) },
        onClear: () => { part.clearAll(); },
    }), [part, narrows, m]);
    // The tab's own search (#1340, ruling 11): the part's choices, and a page of the flows a narrowing of the tab's own holds.
    const search = useMemo((): PagedLibrarySearch<FlowRowValue> | undefined => (part === undefined ? undefined : {
        part, page: (where: ValueTypeOf<RecordSliceWhereType>, offset: bigint, limit: bigint) => source.search(where, offset, limit),
    }), [part, source]);
    const empty = useMemo((): LibraryEmpty => ({ title: m.flowsEmpty(), description: m.flowsEmptyHint({ canAdd: false }) }), [m]);
    const noun = useMemo(() => ({ singular: m.flowNoun({ n: 1 }), plural: m.flowNoun({ n: 2 }) }), [m]);
    return <Box css={styles.flowsTab} data-flowchart-flows="">
        {fresh.length > 0 && <Box css={styles.flowsDrafts}>
            {fresh.map(card => <LibraryCard key={card.name} libraryId={id} item={flowItem(card, card.name === open, words)}
                dimOrder={[]} activeDims={[]} filtered={false} styles={libraryStyles} onCardClick={onOpen} onCardEnter={undefined} />)}
        </Box>}
        <Box css={styles.flowsList}>
            <PagedLibrary source={source.window} id={id} onOpen={onOpen} empty={empty} narrowing={narrowing} search={search} noun={noun} item={row => {
                const session = sessions.get(row.name);
                const pending = (session?.pending ?? 0) > 0;
                const draft = pending && session !== undefined ? draftedEntry(session, row.name) : undefined;
                return flowItem({ name: row.name, label: draft?.name ?? row.name, flow: draft?.flow ?? row.flow, pending },
                    open !== undefined && nameEqual(row.name, open), words);
            }} />
        </Box>
        {newFlow !== undefined && <Box css={styles.flowsFoot}><NewFlow {...newFlow} styles={styles} words={words} /></Box>}
    </Box>;
}

/** What the paged Flows tab counts (#1346): the flows the rail shows, every flow the record holds, and whether the rail narrows them. */
export interface FlowsCount {
    /** The flows the rail shows. */
    readonly shown: number;
    /** Every flow the record holds. */
    readonly total: number;
    /** Whether a choice of the rail narrows them. */
    readonly narrowing: boolean;
}

/**
 * The paged Flows tab's count (#1346), read where it renders nothing: the
 * `flows` source's exact narrowed count and the record's total, handed to the
 * frame only when they move — a tracked read in the frame would draw the
 * whole frame again at every settle. `undefined` while a count it needs is read.
 *
 * @param props - The `flows` source's part, and where the count goes
 * @returns Nothing: the count is handed on
 */
export function FlowsCountReader({ part, onCount }: { part: FlowsPart; onCount: (count: FlowsCount | undefined) => void }) {
    useSliceReactivity(part.key);
    const read = useCallback((): FlowsCount | undefined => {
        const total = part.total();
        if (total.type === "none") return undefined;
        const narrowing = part.read().where.size > 0;
        if (!narrowing) return { shown: Number(total.value), total: Number(total.value), narrowing };
        const count = part.count();
        return count.type === "none" ? undefined : { shown: Number(count.value), total: Number(total.value), narrowing };
    }, [part]);
    const { result } = useTrackedEvaluation(read);
    const count = result.ok ? result.value : undefined;
    // Handed on by what it counts, so a read that settles the same count draws nothing again.
    const shown = count?.shown, total = count?.total, narrowing = count?.narrowing;
    useEffect(() => {
        onCount(shown === undefined || total === undefined || narrowing === undefined ? undefined : { shown, total, narrowing });
    }, [shown, total, narrowing, onCount]);
    return null;
}
