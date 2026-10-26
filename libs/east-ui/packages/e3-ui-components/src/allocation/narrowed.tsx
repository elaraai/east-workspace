/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the narrowing shows (#1336, #1339, #1372): the board reads each source
 * of its `Slice.bindRecords` itself — the lanes, the resources and the
 * arrivals, each under the slot the app names it by (the bin kind's
 * `resource.of`, its `parts.of`, and `arrivals`) — through the shared source
 * visibility, and a source with nothing chosen reads no page and hides
 * nothing. Fits, checks and totals never see it.
 *
 * @packageDocumentation
 */

import { Box, Button } from "@chakra-ui/react";
import { SortedMap, StringType, StructType, compareFor, printFor, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceWhereType, type RecordSliceBindType } from "@elaraai/east-ui/internal";
import { EmptyStateView } from "@elaraai/east-ui-components";
import { sourcePart, useSourceVisibility, type KeyVisibility } from "../shared/schedule/visibility.js";
import type { AllocationStyles, AllocationValue } from "./model.js";
import { one } from "./nouns.js";

/** No choice of a source's: what a source the slice does not have narrows by. */
const NO_CHOICES: ValueTypeOf<typeof RecordSliceWhereType> = new SortedMap([], compareFor(StringType));
const printNarrowing = printFor(StructType({ bins: StringType, lanes: RecordSliceWhereType, resources: RecordSliceWhereType, arrivals: RecordSliceWhereType }));

/** A narrowed source's role: what its rows are on the board. */
export type NarrowedSource = "lanes" | "resources" | "arrivals";

/** The noun a source's rows are. */
const NOUN = { lanes: "lane", resources: "resource", arrivals: "arrival" } as const;

/**
 * The slot the slice names a source by: the lanes' and the resources' the bin
 * kind's own (`resource.of`, `parts.of`), the arrivals' `arrivals`.
 *
 * @param value - The payload
 * @param source - The source's role
 * @returns Its name in the slice
 */
export function narrowingSlot(value: AllocationValue, source: NarrowedSource): string {
    return source === "lanes" ? value.bin.lanes : source === "resources" ? value.bin.parts : "arrivals";
}

/**
 * A source's part of the board's narrowing, if the slice has one.
 *
 * @param value - The payload
 * @param source - The source's role
 * @returns Its record Slice's controls
 */
export function narrowingPart(value: AllocationValue, source: NarrowedSource): ValueTypeOf<RecordSliceBindType> | undefined {
    return sourcePart(value.slice.type === "some" ? value.slice.value : undefined, narrowingSlot(value, source));
}

/**
 * The board's narrowing, as text (#1398): the bins' own choices, apart from
 * the day the board writes into their range, and the lanes', the resources'
 * and the arrivals' — what a view keeps its place across.
 *
 * @param value - The payload
 * @param binChoices - The bins' own source's choices, printed (`binChoicesOf`)
 * @returns The narrowing, printed
 */
export function narrowingText(value: AllocationValue, binChoices: string): string {
    const where = (source: NarrowedSource) => narrowingPart(value, source)?.read().where ?? NO_CHOICES;
    return printNarrowing({ bins: binChoices, lanes: where("lanes"), resources: where("resources"), arrivals: where("arrivals") });
}

/**
 * Which of a source's rows show: its narrowed keys while a choice narrows it,
 * every row — and no read — while none does.
 *
 * @param value - The payload
 * @param source - The source's role
 * @param rows - Every row of it, in order
 * @returns The keys to show, and the narrowing's state
 */
export function useNarrowed(value: AllocationValue, source: NarrowedSource, rows: readonly { key: string }[]): KeyVisibility {
    const noun = value.labels[NOUN[source]];
    return useSourceVisibility(value.slice.type === "some" ? value.slice.value : undefined, narrowingSlot(value, source), value.narrowed[source], rows,
        { changed: `${noun.one} results changed; retry the narrowing.`, failed: `Could not load ${one(noun)} results` });
}

/**
 * The narrowing left nothing to show: the shared empty state, and Clear filters.
 *
 * @param props - The recipe's styles, and the narrowing's Clear all, if there is one
 * @returns The empty state
 */
export function NarrowedEmpty({ styles, clear }: { styles: AllocationStyles; clear: (() => void) | undefined }) {
    return <Box css={styles.narrowedEmpty} data-allocation-narrowed-empty="">
        <EmptyStateView size="sm" icon={{ prefix: "fas", name: "filter" }} title="No rows match the filters"
            description="Change or clear the filters to see more rows."
            actions={clear === undefined ? undefined : <Button size="xs" variant="outline" onClick={clear}>Clear filters</Button>} />
    </Box>;
}
