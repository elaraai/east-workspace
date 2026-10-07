/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flows tab (#1246, `Flowchart Builder Spec.md` decision 5, §8, FB13,
 * FB14) — every flow the flowchart holds, by name, as a `Library`, as the
 * query builder's Library tab lists the saved queries:
 *
 * - **a card** — the flow's name, and under it its description, or with none
 *   its counts (`4 lanes · 9 states · 11 transitions`); the open flow is
 *   placed; a flow whose drafts are not yet applied carries the Pending chip;
 * - **a click** opens it on the canvas;
 * - the `Library`'s own search, over names and descriptions;
 * - **"+ New flow"** under the cards, where the flowchart edits: the shared
 *   `NamePopover` hangs from it, refuses a name the flowchart holds with the
 *   reason, and hands a new one to the flowchart, which opens it;
 * - **no flow at all** — the shared empty state saying so (FB28), with no
 *   button and no foot: main's empty state carries "+ New flow" (§7).
 *
 * `NoFlows` is that empty state: the tab's, and main's over a record with no
 * flow (`Flowchart Builder Spec.md` §7), which alone carries "+ New flow".
 * Every icon is Font Awesome's solid set; every style is the `flowchart`
 * recipe's or the shared parts'.
 *
 * @packageDocumentation
 */

import { useMemo, useState } from "react";
import { Box, chakra, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { StringType, equalFor, none, some, variant } from "@elaraai/east";
import { EastChakraLibrary, EmptyStateView, getSomeorUndefined, type LibraryItemValue, type LibraryValue } from "@elaraai/east-ui-components";
import { NamePopover } from "../shared/name-popover.js";
import type { FlowchartWords } from "./messages.js";
import type { FlowchartFlowValue } from "./model.js";

type Styles = Record<string, SystemStyleObject>;

const nameEqual = equalFor(StringType);

/** A flow's card in the Flows tab: its name, the flow as its drafts stand, and whether it has drafts. */
export interface FlowCard {
    /** The flow's name. */
    readonly name: string;
    /** The flow, as its drafts stand. */
    readonly flow: FlowchartFlowValue;
    /** Whether its drafts are not yet applied. */
    readonly pending: boolean;
}

/** What "+ New flow" needs: the names the flowchart holds, and what a new name does. */
export interface NewFlowProps {
    /** Every name the flowchart holds: its flows, and its new flows not yet applied. */
    readonly taken: ReadonlySet<string>;
    /** Starts a flow of a new name. */
    readonly onCreate: (name: string) => void;
}

/** The flows' cards fill the pane and scroll there, every card mounted. */
const FILL = some({ height: some("fill"), maxHeight: none, virtualization: some(false), columns: none, mediaPlacement: none, mediaSize: none });

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
        label: card.name,
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
        search: some(description === undefined ? card.name : `${card.name} ${description}`),
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
                onCreate(name);
                return undefined;
            }}
        />
    );
}

/**
 * The flowchart with no flow: the shared empty state — the Flows tab's, which
 * only says so (FB28), and main's over a record of no flow, with "+ New flow"
 * in it where the flowchart edits (§7).
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
