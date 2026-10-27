/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Chooser of the paged resource kind's resources (#1424): the shared key
 * search over the kind's own resources, in their key order, through its own
 * paged read — its key search places a typed key, and its windows label the
 * matches the box lists — never every resource listed. The box names the
 * resource chosen; a pick sets it. Every resource Chooser of the Calendar's
 * that offers the paged kind draws it in a field's place (`FieldForm`'s
 * `renderControl`): the placement's resource, an event's reference field to
 * the kind, and the bulk edit's resource. The frame gives it the paged kind
 * through {@link CalendarChooserContext}, with the name of a resource by its
 * key: its row's label once a window the frame holds has it, else its key.
 *
 * It leaves out what the kind's source of the slice hides, as the Calendar's
 * other Choosers leave out what the rail hides (ruled 27 Oct 2026): which of
 * each page it lists the source's choices hold is asked of e3 — one request a
 * page, the membership read the hidden pick reads (`recordSliceWithinAt`) —
 * and the rest are dropped, but the resource the field holds, an event's own,
 * which stays offered whatever the choices hide. A step onto a resource they
 * hide picks nothing. It searches the kind whole by key, as it always has, so
 * its count is the kind's.
 *
 * @packageDocumentation
 */

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { StringType, equalFor, toEastTypeValue, type EastTypeValue, type ValueTypeOf } from "@elaraai/east";
import type { FieldSpecValue } from "@elaraai/east-ui";
import type { DatasetKeyMatchRange, DatasetKeyQuery, RecordSliceBindType } from "@elaraai/east-ui/internal";
import { DatasetKeySearch, useSliceReactivity } from "@elaraai/east-ui-components";
import { awaitTracked, recordSliceWithinAt, toSeekQuery } from "@elaraai/east-ui-components/internal";
import type { CalendarPagedValue } from "./pages.js";

/** A resource's key is a String: what the box parses a typed key as. */
const KEY_TYPE: EastTypeValue = toEastTypeValue(StringType);
/** An empty box lists the first of the kind's resources. */
const BROWSE: DatasetKeyQuery = { prefix: "" };
const keyEqual = equalFor(StringType);

/** The paged resource kind, as the Calendar's Choosers search it. */
export interface CalendarChooser {
    /** The paged kind, as the payload carries it: its own key search and windows. */
    readonly paged: CalendarPagedValue;
    /** Its name, as running text writes it: `presses`. */
    readonly noun: string;
    /** A resource's name by its key: its row's label once a window the frame holds has it, else its key. */
    readonly nameOf: (key: string) => string;
    /**
     * The kind's source of the slice, named after its slot: its Choosers leave out what its choices hide; `undefined`
     * with none, every resource offered.
     */
    readonly part?: ValueTypeOf<RecordSliceBindType> | undefined;
}

/** The paged kind the Calendar's Choosers search; `undefined` with none paged. */
export const CalendarChooserContext = createContext<CalendarChooser | undefined>(undefined);

/**
 * The Chooser of the paged kind's resources (see the module docs).
 *
 * @param props - The paged kind; the resource chosen, by its key — `undefined` for none; what a pick sets; and whether it takes none
 * @returns The key search, or the chosen resource's name, read only
 */
export function PagedChooser({ chooser, chosen, onPick, readOnly = false }: {
    chooser: CalendarChooser; chosen: string | undefined; onPick: (key: string) => void; readOnly?: boolean;
}): ReactNode {
    const { paged, noun, nameOf, part } = chooser;
    // The source's choices, followed as they move: the box lists its lines again by them.
    const moved = useSliceReactivity(part?.key);
    const find = useCallback(async (query: DatasetKeyQuery): Promise<DatasetKeyMatchRange> => {
        if (paged.seek.type !== "some") return { found: false, row: 0, count: 0 };
        const seek = paged.seek.value;
        const at = await awaitTracked(() => seek(toSeekQuery(query)));
        return { found: at.found, row: Number(at.row), count: Number(at.count) };
    }, [paged]);
    /**
     * Which of the kind's own resources `[row, row + limit)`, in their key order — its source's record's own rows — the
     * source's choices hold, asked of e3 over that page in one request; `undefined` while the source chooses nothing.
     */
    const heldAt = useCallback(async (row: number, limit: number): Promise<readonly boolean[] | undefined> => {
        const where = part?.read().where;
        if (part === undefined || where === undefined || where.size === 0) return undefined;
        return awaitTracked(() => recordSliceWithinAt(part, where, BigInt(row), BigInt(limit)));
    }, [part]);
    /** Whether the Chooser offers a resource: one the source's choices hold, or the field's own. */
    const offered = useCallback((key: string, held: boolean | undefined) => held !== false || (chosen !== undefined && keyEqual(key, chosen)), [chosen]);
    const listRange = useCallback(async (row: number, limit: number) => {
        const [rows, held] = await Promise.all([awaitTracked(() => paged.entries(BigInt(row), BigInt(limit))), heldAt(row, limit)]);
        return rows.flatMap((r, i) => offered(r.key, held?.[i])
            ? [{ row: row + i, label: r.meta.type === "some" ? `${r.label} · ${r.meta.value}` : r.label, text: r.label }] : []);
    }, [paged, heldAt, offered]);
    const jump = useCallback((row: number) => {
        void Promise.all([awaitTracked(() => paged.entries(BigInt(row), 1n)), heldAt(row, 1)])
            .then(([[picked], held]) => { if (picked !== undefined && offered(picked.key, held?.[0])) onPick(picked.key); })
            .catch((error: unknown) => { console.error("[Calendar] the resource picked could not be read:", error); });
    }, [paged, heldAt, offered, onPick]);
    const name = chosen === undefined ? "Unassigned" : nameOf(chosen);
    if (readOnly) return <Box data-calendar-chooser="" data-readonly="">{name}</Box>;
    return <Box data-calendar-chooser="">
        <DatasetKeySearch keyType={KEY_TYPE} label={name} onFind={find} onListRange={listRange} onJump={jump} browseQuery={BROWSE} relist={moved}
            noMatchesText={`No ${noun} with that key. Search by a key's start.`} />
    </Box>;
}

/**
 * The control a Calendar form draws for a field that chooses one of the paged
 * kind's resources: the Chooser over the kind's own resources.
 *
 * @param chooser - The paged kind, when one pages
 * @param spec - The field
 * @param chooses - Whether the field chooses one of the paged kind's resources
 * @param chosen - The resource it holds, by its key; `undefined` for none
 * @param onPick - What a pick sets, by the resource's key
 * @param readOnly - Whether the form takes no edit
 * @returns The Chooser; `undefined` for a field the form draws itself
 */
export function pagedControl(chooser: CalendarChooser | undefined, spec: FieldSpecValue, chooses: (spec: FieldSpecValue) => boolean,
    chosen: string | undefined, onPick: (key: string) => void, readOnly: boolean): ReactNode | undefined {
    if (chooser === undefined || !chooses(spec)) return undefined;
    return <PagedChooser chooser={chooser} chosen={chosen} onPick={onPick} readOnly={readOnly} />;
}

/**
 * The Calendar's paged kind, for its Choosers.
 *
 * @returns The paged kind, when one pages
 */
export function useCalendarChooser(): CalendarChooser | undefined {
    return useContext(CalendarChooserContext);
}
