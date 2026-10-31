/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A zones target's preview (`Decision Queue Spec.md` P9, P21–P25): every
 * area of its record, read whole, drafts in place — tracked, so the read
 * landing draws it — as the change leaves it: the zones' key, each zone's
 * count before → after, over a tile an area at its place, at least twelve a
 * row, filled from its zone's colour, the areas the change moves taking their
 * new zone's fill and the glow, a depot its dot ({@link zonesPreview}).
 *
 * @packageDocumentation
 */

import { useCallback, type CSSProperties } from "react";
import { Box } from "@chakra-ui/react";
import { FloatType, StringType, equalFor } from "@elaraai/east";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import type { SlotStyles } from "@elaraai/east-ui-components/internal";
import { colorTokenCss } from "../../roster/model.js";
import { appliedRows, draftedRows, type DecisionTarget } from "../editing.js";
import type { DecisionQueueWords } from "../messages.js";
import { PreviewFailed, PreviewFrame, PreviewPending, leftBy, staleNames, useHeld, type PreviewProps } from "./frame.js";
import { ZONE_COLUMNS, zonesPreview, type ZoneAreaInput, type ZoneTile, type ZonesModel } from "./zones-model.js";

/** A zones target's kind, decoded. */
type ZonesKind = Extract<DecisionTarget["kind"], { type: "zones" }>["value"];

/** What the preview's read gives: the model, a read in flight, or nothing to draw. */
type ZonesRead =
    | { readonly state: "ready"; readonly model: ZonesModel; readonly names: readonly string[]; readonly marked: boolean }
    | { readonly state: "pending" }
    | { readonly state: "empty" };

const PENDING: ZonesRead = { state: "pending" };
const EMPTY: ZonesRead = { state: "empty" };
/** No drafted rows: a target with no record the queue writes. */
const NO_DRAFTED: ReadonlyMap<string, Uint8Array | undefined> = new Map();
/** The rows a zones placeholder draws. */
const PENDING_ROWS = 4;
const stringEqual = equalFor(StringType);
const sameCount = equalFor(FloatType);

/** Props of {@link ZonesPreview}. */
export interface ZonesPreviewProps extends PreviewProps {
    /** The target's zones kind. */
    readonly kind: ZonesKind;
}

/**
 * A zones target's preview (see the module docs).
 *
 * @param props - The case, its target and record, the rows its change leaves and the queue's editing ({@link ZonesPreviewProps})
 * @returns The preview
 */
export function ZonesPreview({ c, view, target, kind, record, rows, changed, schedule, words, styles, applied }: ZonesPreviewProps) {
    const option = view.option;
    const read = useCallback((): ZonesRead => {
        if (rows === "reading" || rows === "failed") return PENDING;
        const touched = new Map<string, Uint8Array | undefined>();
        let marked = true;
        if (rows === "ready" && changed.length > 0) {
            for (const row of changed) touched.set(row.key, leftBy(row));
        } else {
            // Stale (P21): the areas the proposal touched, as they stand. Changing nothing (P4): the areas the
            // recommendation touches, as they stand, unmarked.
            const stale = rows === "stale";
            const recommended = c.options[view.recommended];
            const theirs = !stale && recommended !== undefined && target.tags.some(tag => stringEqual(tag, recommended.change.tag));
            const o = theirs ? recommended : option;
            marked = false;
            if (o === undefined || record === undefined) return EMPTY;
            for (const key of target.touched(o.change.patch)) touched.set(key, undefined);
            if (theirs && appliedRows(schedule, target, record, recommended).state === "reading") return PENDING;
        }
        const all = kind.rows();
        if (all.type !== "some") return PENDING;
        const areas: ZoneAreaInput[] = [];
        // The queue's own drafts of the record — verdicts drafted before this one — in their place.
        const drafted = record === undefined ? NO_DRAFTED : draftedRows(schedule, record);
        for (const key of new Set([...all.value.keys(), ...touched.keys()])) {
            const standing = drafted.has(key) ? drafted.get(key) : all.value.get(key);
            const after = marked && touched.has(key) ? touched.get(key) : standing;
            const bytes = after ?? standing;
            if (bytes === undefined) continue;
            areas.push({
                key, before: standing === undefined ? undefined : kind.zone(standing, key), after: after === undefined ? undefined : kind.zone(after, key),
                x: kind.x(bytes, key), y: kind.y(bytes, key), depot: kind.depot.type === "some" && kind.depot.value(bytes, key),
            });
        }
        return { state: "ready", model: zonesPreview(areas, kind.zones.map(zone => zone.key), marked), names: [...touched.keys()], marked };
    }, [rows, changed, option, c.options, view.recommended, record, target, schedule, kind]);
    const { result: live } = useTrackedEvaluation(read);
    const result = useHeld(live, applied);
    const stale = rows === "stale";
    if (rows === "failed" || !result.ok) {
        if (!result.ok) console.error(`[DecisionQueue] case ${c.key}'s preview could not read its areas:`, result.error);
        return <PreviewFailed kind="zones" layout="zones" words={words} styles={styles} />;
    }
    const got = result.value;
    if (got.state === "pending") return <PreviewPending kind="zones" layout="zones" rows={PENDING_ROWS} cells={ZONE_COLUMNS} words={words} styles={styles} />;
    if (got.state === "empty") return <PreviewFrame kind="zones" layout="zones" label={option?.detail ?? ""} stale={stale} applied={applied} styles={styles} />;
    const { m } = words;
    const model = got.model;
    const zoneOf = (key: string) => kind.zones.find(zone => stringEqual(zone.key, key));
    const name = (key: string) => zoneOf(key)?.label ?? key;
    const label = stale ? m.previewStale({ names: staleNames(got.names, words) })
        : !got.marked ? m.previewUnchanged({ names: staleNames(got.names, words) ?? m.previewList({ items: got.names.slice(0, 1) }) })
        : m.previewZones({
            moves: model.moves.map(move => ({ n: words.number(move.n), one: move.n === 1, from: name(move.from), to: name(move.to) })),
            of: words.number(model.areas),
            counts: model.counts.filter(count => !sameCount(count.before, count.after))
                .map(count => ({ zone: name(count.zone), before: words.number(count.before), after: words.number(count.after) })),
        });
    const fill = (key: string): CSSProperties | undefined => {
        const zone = zoneOf(key);
        return zone === undefined ? undefined : { "--pv-zone": colorTokenCss(zone.color).fill } as CSSProperties;
    };
    return (
        <PreviewFrame kind="zones" layout="zones" label={label} stale={stale} applied={applied} styles={styles}>
            <Box css={styles.zones}>
                <Box css={styles.zoneKey}>
                    {model.counts.map(count => (
                        <Box as="span" key={count.zone} css={styles.zoneItem} style={fill(count.zone)} data-preview-row={name(count.zone)}>
                            <Box as="span" css={styles.swatch} />
                            <Box as="span" css={styles.zoneName}>{name(count.zone)}</Box>
                            <Box as="span" css={styles.zoneCount}>
                                {m.previewZoneCount({ before: words.number(count.before), after: words.number(count.after), same: sameCount(count.before, count.after) })}
                            </Box>
                        </Box>
                    ))}
                </Box>
                <Box css={styles.zoneTiles} style={{ "--pv-columns": model.columns } as CSSProperties}>
                    {model.tiles.map(tile => <Tile key={`${tile.x}.${tile.y}`} tile={tile} name={name} fill={fill} words={words} styles={styles} />)}
                </Box>
            </Box>
        </PreviewFrame>
    );
}

/** One tile (P9, P25): its area's zone's fill, the glow where the change moves it, a depot's dot, and its title. */
function Tile({ tile, name, fill, words, styles }: {
    readonly tile: ZoneTile; readonly name: (key: string) => string; readonly fill: (key: string) => CSSProperties | undefined;
    readonly words: DecisionQueueWords; readonly styles: SlotStyles;
}) {
    if (tile.empty) return <Box as="span" css={styles.zoneTile} data-empty="" />;
    const moved = tile.from !== undefined;
    return (
        <Box as="span" css={styles.zoneTile} style={fill(tile.zone)} data-preview-tile={tile.key} data-op={moved ? "chg" : undefined} data-fill={moved ? "own" : undefined}
            title={words.m.previewZoneTile({ name: tile.key, zone: name(tile.zone), from: moved ? name(tile.from!) : undefined, depot: tile.depot })}>
            {tile.depot && <Box as="span" css={styles.depot} />}
        </Box>
    );
}
