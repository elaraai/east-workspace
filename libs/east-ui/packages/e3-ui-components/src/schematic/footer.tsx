/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's footer (#1387, `Schematic Builder Spec.md` §6.3), on the
 * shared builder rail (`builder-footer.ts`): the counts (`counts.ts`) — each
 * item kind's items drawn of its rows (`Rack 5 of 7`: two are unplaced,
 * narrowed out or on a hidden layer), the zones drawn, the links drawn and the
 * nets drawn, each where the Schematic has a kind of them — and each record's
 * last save, as its commits say it. Each item is its own on the rail, so the
 * rail wraps item by item where main is narrow (`useRailWrap`). The changes
 * waiting on Save and the Save notice are the editing session's (#1388); why
 * a drop or an inspector edit was refused, the drops' and the inspector's
 * (#1390, #1391).
 *
 * A kind's rows are its record's: a kind read whole counts the rows its read
 * holds, and one read through its source of the slice counts its record's
 * total, which its source reads.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import { Box, type SystemStyleObject } from "@chakra-ui/react";
import { StringType, equalFor, type ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { useRailWrap } from "../shared/schedule/footer.js";
import type { SchematicCounts } from "./counts.js";
import type { SchematicValue } from "./data.js";
import type { SchematicWords } from "./messages.js";

type Styles = Record<string, SystemStyleObject>;

const stringEqual = equalFor(StringType);

/** A record's commits, newest first, as a kind's `history` reads them. */
type History = Extract<SchematicValue["items"][number]["history"], { type: "some" }>["value"];

/** A kind's record whose commits say when it was last saved: one bound with its patch door. */
export interface SchematicSavedRecord {
    /** The kind's slot. */
    readonly slot: string;
    /** The kind's name (`Rack`). */
    readonly name: string;
    /** Its record's commits, newest first. */
    readonly history: History;
}

/**
 * The kinds whose records say when they were last saved: each bound with its
 * patch door, whose commits it reads — in the Schematic's order of its sorts,
 * items, zones, links and nets.
 *
 * @param value - The payload
 * @returns Each such kind's record
 */
export function savedRecords(value: SchematicValue): SchematicSavedRecord[] {
    return [...value.items, ...value.zones, ...value.links, ...value.nets]
        .flatMap((kind) => (kind.history.type === "some" ? [{ slot: kind.key, name: kind.name, history: kind.history.value }] : []));
}

/** Props of {@link SchematicFooter}. */
export interface SchematicFooterProps {
    /** The `schematic` recipe's styles. */
    readonly styles: Styles;
    /** The Schematic's words. */
    readonly words: SchematicWords;
    /** What it counts. */
    readonly counts: SchematicCounts;
    /** How many rows each kind read whole holds, by its slot. */
    readonly rows: ReadonlyMap<string, number>;
    /** Each item kind's source of the slice, by its slot: whose record's total is the kind's rows. */
    readonly sources: ReadonlyMap<string, ValueTypeOf<RecordSliceBindType>>;
    /** The kinds' records whose commits say when each was last saved. */
    readonly records: readonly SchematicSavedRecord[];
}

/**
 * Renders the footer — see the module docs.
 *
 * @param props - What it counts, where each kind's rows are read from, and each record's commits
 * @returns The footer
 */
export function SchematicFooter({ styles, words, counts, rows, sources, records }: SchematicFooterProps) {
    // A kind read through its source: its record's total, as its source reads it; and each record's newest commit.
    // Each read on its own: one that fails leaves the others read.
    const read = useCallback(() => ({
        totals: new Map([...sources].map(([slot, part]) => {
            try {
                const total = part.total();
                return [slot, total.type === "some" ? Number(total.value) : undefined] as const;
            } catch {
                return [slot, undefined] as const;
            }
        })),
        saved: records.flatMap((record) => {
            try {
                const commits = record.history();
                const newest = commits.type === "some" ? commits.value[0] : undefined;
                return newest === undefined ? [] : [{ slot: record.slot, name: record.name, at: newest.at }];
            } catch {
                return [];
            }
        }),
    }), [sources, records]);
    const { result } = useTrackedEvaluation(read);
    const totals = result.ok ? result.value.totals : undefined;
    const saved = result.ok ? result.value.saved : undefined;
    // Each line, and what it is: a count by its kind's slot or its sort, or a record's last save by its kind's slot.
    const lines = useMemo((): { key: string; attribute: Record<string, string>; text: string }[] => {
        const today = words.date(new Date());
        return [
            ...counts.kinds.map((kind) => {
                const total = sources.has(kind.slot) ? totals?.get(kind.slot) : rows.get(kind.slot);
                return {
                    key: `count:${kind.slot}`,
                    attribute: { "data-schematic-count": kind.slot },
                    text: words.m.kindCount({
                        name: kind.name, drawn: { n: kind.drawn, count: words.number(kind.drawn) },
                        total: total === undefined ? undefined : { n: total, count: words.number(total) },
                    }),
                };
            }),
            ...(counts.zones === undefined ? [] : [{
                key: "count:zones", attribute: { "data-schematic-count": "zones" }, text: words.m.zoneCount({ n: counts.zones, count: words.number(counts.zones) }),
            }]),
            ...(counts.links === undefined ? [] : [{
                key: "count:links", attribute: { "data-schematic-count": "links" }, text: words.m.linkCount({ n: counts.links, count: words.number(counts.links) }),
            }]),
            ...(counts.nets === undefined ? [] : [{
                key: "count:nets", attribute: { "data-schematic-count": "nets" }, text: words.m.netCount({ n: counts.nets, count: words.number(counts.nets) }),
            }]),
            // Its time when it was today, its date and time otherwise, as the Flowchart's and the Plan's footers say it.
            ...(saved ?? []).map((save) => ({
                key: `saved:${save.slot}`,
                attribute: { "data-schematic-saved": save.slot },
                text: words.m.recordSaved({ name: save.name, when: stringEqual(words.date(save.at), today) ? words.time(save.at) : words.dateTime(save.at) }),
            })),
        ];
    }, [counts, rows, sources, totals, saved, words]);
    const ref = useRef<HTMLDivElement>(null);
    const wrap = useRailWrap(ref, lines.map((line) => line.text).join("\n"));
    return (
        <Box ref={ref} css={styles.footer} data-schematic-footer="" data-builder-narrow={wrap ? "" : undefined}>
            {lines.map((line) => <Box as="span" key={line.key} css={styles.footerItem} {...line.attribute}>{line.text}</Box>)}
        </Box>
    );
}
