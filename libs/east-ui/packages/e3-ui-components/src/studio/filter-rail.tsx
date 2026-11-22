/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Studio page's filter rail (#1673): a page's filters as chips — a reader's,
 * on a page and in the builder's Preview, or the page's starting filters over
 * the builder's canvas — each its condition in short words, `Region: NSW +1`,
 * and whole on its hover — each dataset's chips together after its name, said
 * once, the datasets in the order the surface lists them (ruled 19 November
 * 2026); a `+ FILTER` chip; and each chip's editor: the query builder's
 * condition rows over its source (`./filter-editor.tsx`), a draft its
 * popover's foot commits (ruled 22 November 2026): Add filter adds a new one,
 * Apply changes one — or, every condition of it removed, removes it — and
 * Cancel, the popover's × and Esc leave the page as it was. Each commit is one
 * of the filters' gestures — added, changed, removed, cleared
 * (`./page-filters.tsx`); what a draft commits is the filters' rule
 * (`draftEdit`).
 *
 * It is a model for the rail both it and Slice draw (`useSliceRailItems`, on
 * the rail engine): its one affordance is the filters, whose chips fold one
 * at a time into `+N more`, then into the rail's summary chip, then — on a
 * phone — its Filters button and view. The chips are the shared row
 * (`SliceFilterChips`); the filters' rules are `query/visual/filters.ts`'s.
 * A filter the rail adds is the reader's; one a visual's click made stays
 * that visual's as it is edited, which goes on marking what it holds (#1673).
 *
 * @packageDocumentation
 */

import { useMemo, useState, type ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { faFilter } from "@fortawesome/free-solid-svg-icons";
import { none, printJq, type JqNode, type ValueTypeOf } from "@elaraai/east";
import type { StudioCellType, StudioSourceType } from "@elaraai/e3-ui/internal";
import { useFormatters, type ToolbarItem } from "@elaraai/east-ui-components";
import {
    SliceChoiceGroup, SliceFilterChips, useSliceDensity, useSliceRailItems, useSlotStyles, type SliceFilterChip, type SliceRailModel,
} from "@elaraai/east-ui-components/internal";
import { useVisualRoot } from "../query/visual/answers.js";
import { draftEdit, filterChip, type ConditionDraft } from "../query/visual/filters.js";
import type { PrintSource } from "../query/visual/print.js";
import { printSourceOf } from "../query/visual/source.js";
import { useQueryWords } from "../query/words.js";
import { FilterConditions } from "./filter-editor.js";
import { useStudioMessages } from "./messages.js";
import type { PageFilters } from "./page-filters.js";

/** A listed source, decoded. */
type Source = ValueTypeOf<typeof StudioSourceType>;
/** One placement, decoded. */
type Cell = ValueTypeOf<typeof StudioCellType>;

/**
 * The sources a layout's visuals read, by key, each once, in the order the
 * layout first reads them: what its page's filters may be on.
 *
 * @param cells - The layout's placements
 * @returns The keys
 */
export function sourcesRead(cells: readonly Cell[]): string[] {
    const keys: string[] = [];
    for (const cell of cells) {
        if (cell.content.type === "visual" && !keys.includes(cell.content.value.source)) keys.push(cell.content.value.source);
    }
    return keys;
}

/** The rail's one cluster: the page's filters. */
const CLUSTERS = [{ key: "studio-filters", kinds: ["filter"] }] as const;

/** A source the rail filters: as the surface lists it, and as the printer reads it. */
interface Filtered {
    readonly source: Source;
    readonly read: PrintSource;
}

/** What a filter's editor tells the row of chips: the source its filter is on, and what its rows say as they stand. */
interface FilterDraft {
    readonly source: string;
    readonly draft: ConditionDraft;
}

/** A new filter's rows as they open: one empty row. */
const EMPTY_ROW: ConditionDraft = { kind: "unfinished" };

/** A filter's editor: its condition rows over its source, a draft told after every edit; a new one's open on its field's list. */
function FilterEditor({ id, where, read, onDraft }: { id: string; where: JqNode | undefined; read: PrintSource; onDraft: (draft: ConditionDraft) => void }) {
    const root = useVisualRoot();
    // A page whose sources cannot be queried has no rows to edit a condition over.
    return root === undefined ? null : <FilterConditions id={id} where={where} read={read} root={root} onDraft={onDraft} autoOpen={where === undefined} />;
}

/** Props of {@link NewFilter}. */
interface NewFilterProps {
    /** The sources a filter may be on. */
    readonly sources: readonly Filtered[];
    /** Told the filter as it is drafted: the source picked, and what its rows say. */
    readonly tell: (draft: FilterDraft) => void;
}

/**
 * A new filter's editor: its source, chosen where the page reads more than
 * one, then its condition rows. Nothing is added by them: the popover's Add
 * filter adds what they say, once a condition is finished.
 */
function NewFilter({ sources, tell }: NewFilterProps) {
    const m = useStudioMessages();
    const [picked, setPicked] = useState(sources[0]?.source.key);
    const on = sources.find((held) => held.source.key === picked) ?? sources[0];
    if (on === undefined) return null;
    return (
        <>
            {sources.length > 1 && (
                <Box role="group" aria-label={m.filterSource()} data-studio-filter-source="">
                    <SliceChoiceGroup
                        choices={sources.map((held) => ({ id: held.source.key, label: held.source.name, active: held.source.key === on.source.key }))}
                        // Another source starts another filter: the rows begin again over its fields, an empty row.
                        onPick={(key) => { setPicked(key); tell({ source: key, draft: EMPTY_ROW }); }} />
                </Box>
            )}
            <FilterEditor key={on.source.key} id={`new:${on.source.key}`} where={undefined} read={on.read} onDraft={(draft) => tell({ source: on.source.key, draft })} />
        </>
    );
}

/** Props of {@link StudioFilterChips}. */
interface StudioFilterChipsProps {
    /** The sources the page's visuals read. */
    readonly sources: readonly Filtered[];
    /** The page's filters, and their setter. */
    readonly page: PageFilters;
    /** How many trailing chips the toolbar folds into `+N more`. */
    readonly foldChips: number | undefined;
}

/** The page's filters as the shared row of chips, in the rail's density: each dataset's together, after its name. */
function StudioFilterChips({ sources, page, foldChips }: StudioFilterChipsProps) {
    const m = useStudioMessages();
    const words = useQueryWords();
    const density = useSliceDensity();
    const edit = useSlotStyles("sliceEdit");
    const chips = page.filters.map((filter, i): SliceFilterChip<FilterDraft> => {
        const on = sources.find((held) => held.source.key === filter.source);
        // Short on the chip — `Region: NSW +1` — and whole on its hover (#1673); its dataset named before its group.
        const jq = printJq(filter.where).text;
        const said = on === undefined ? { words: jq, whole: jq } : filterChip(filter.where, on.read, words);
        const name = on?.source.name ?? filter.source;
        return {
            label: said.words,
            whole: said.whole,
            group: { key: filter.source, label: name },
            editLabel: m.filterOf({ source: name }),
            editor: (_close, tell): ReactNode => (on === undefined
                ? <Box as="span" css={edit.hint} data-studio-filter-gone="">{m.filterSourceGone({ source: filter.source })}</Box>
                : <FilterEditor id={`${i}:${filter.source}`} where={filter.where} read={on.read} onDraft={(draft) => tell({ source: filter.source, draft })} />),
            // Apply: the filter is what its rows say — or, every condition of it removed, it goes, as its Remove filter does.
            apply: (told) => {
                const commit = draftEdit(told?.draft, filter.where);
                if (commit === undefined) return undefined;
                return commit.kind === "remove" ? () => page.remove(i) : () => page.change(i, { ...filter, where: commit.where });
            },
        };
    });
    // A filter's rows are a draft its popover's foot commits: Add filter, Apply. The datasets in the surface's order. A new
    // filter's editor names the dataset it will be on, as a chip's names its own; where the page reads several, its choice
    // of them heads the editor and names the one picked.
    const only = sources.length === 1 ? sources[0] : undefined;
    return (
        <SliceFilterChips<FilterDraft> chips={chips} density={density} foldChips={foldChips} groups={sources.map((held) => held.source.key)} rows
            onRemove={(i) => page.remove(i)} onClear={() => page.clear()}
            add={(_close, tell) => <NewFilter sources={sources} tell={tell} />}
            addApply={(told) => {
                const commit = draftEdit(told?.draft, undefined);
                return told === undefined || commit?.kind !== "set" ? undefined : () => page.add({ source: told.source, where: commit.where, from: none });
            }}
            addLabel={only === undefined ? undefined : m.addFilterOf({ source: only.source.name })} />
    );
}

/**
 * A page's filter rail, as items of a toolbar row over its grid: a reader's
 * filters, on a published page and in the builder's Preview; the page's
 * starting filters, over the builder's canvas.
 *
 * @param held - The filters, and their edits
 * @param sources - The sources the surface lists
 * @param used - The keys of the sources the page's visuals read: what a filter may be on
 * @param label - What the rail is called where it folds to its summary chip, and on its hover: `Filters` when omitted
 * @returns The rail's items; none for a page whose visuals read no source the surface can filter
 */
export function useStudioFilterItems(held: PageFilters, sources: readonly Source[], used: readonly string[], label?: string): ToolbarItem[] {
    const m = useStudioMessages();
    const f = useFormatters();
    const filtered = useMemo(() => sources.flatMap((source): Filtered[] => {
        const read = used.includes(source.key) ? printSourceOf(source) : undefined;
        return read === undefined ? [] : [{ source, read }];
    }), [sources, used]);
    const model = useMemo((): SliceRailModel | undefined => {
        if (filtered.length === 0) return undefined;
        const n = held.filters.length;
        return {
            // The chips are remeasured as the filters change: their count and their words.
            version: held.filters,
            activeCount: n,
            filterChips: n,
            describe: (kind) => ({ kind, icon: faFilter, label: label ?? m.filters(), text: m.filtersSet({ n, count: f.number(n) }), active: n > 0 }),
            render: (_kind, _index, foldChips) => <StudioFilterChips sources={filtered} page={held} foldChips={foldChips} />,
            clear: () => held.clear(),
        };
    }, [filtered, held, label, m, f]);
    return useSliceRailItems(model, CLUSTERS);
}
