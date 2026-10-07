/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A builder toolbar's segment strip, and the one chip it folds into (#632,
 * #952): the Plan's grain and resolution, and the Flowchart's LR · TD
 * (#1245). The strip is a radio group on the `seg` recipe, one tab stop on the
 * checked segment; folded, it is one chip naming the checked segment, whose
 * menu holds every segment. On a coarse pointer a segment is a 44px target by
 * its halo on the block axis, never taking a tap meant for the segment beside
 * it, and the chip by its halo; neither grows the row (#346, #1221).
 *
 * Each host names its strips by a data attribute of its own (`data-plan-seg`,
 * `data-flowchart-seg`), which its tests and visual invariants read.
 *
 * @packageDocumentation
 */

import { useMemo, type KeyboardEvent } from "react";
import { Box, chakra, Menu as ChakraMenu, Portal, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { coarseHitArea, radioGroupKey } from "@elaraai/east-ui-components/internal";

type Styles = Record<string, Record<string, unknown>>;

/** A segment strip's props — shared by the strip and its one-chip menu. */
export interface SegProps<K extends string> {
    /** What the strip picks — its radio group's (the menu's) accessible name. */
    label: string;
    /** Which strip it is: the value of the host's data attribute. */
    name: string;
    /** The host's data attribute naming the strip (`data-plan-seg`), set to `name`. */
    data: `data-${string}`;
    /** The segments, in order. */
    items: ReadonlyArray<{ key: K; label: string }>;
    /** The checked segment's key — any other string checks none. */
    active: string;
    /** Picks a segment. */
    onPick: (key: K) => void;
}

/**
 * The compact chrome segment strip (`seg` recipe) — a radio group (#632).
 * It is ONE tab stop, on the checked segment (the first while none is);
 * ← / → and Home / End move between the segments and pick the one they land
 * on, as the WAI-ARIA radio group pattern has it, and a click, Enter or Space
 * picks the one it is on.
 *
 * @param props - The strip's name, its segments, the checked one and what a pick does
 * @returns The strip
 */
export function Seg<K extends string>({ label, name, data, items, active, onPick }: SegProps<K>) {
    const seg = useSlotRecipe({ key: "seg" });
    const ss = useMemo(() => seg({}) as unknown as Styles, [seg]);
    const stop = items.some((it) => it.key === active) ? active : items[0]?.key;
    // The radio group's keys (shared with the Sheet's context switch): handled, so a canvas's own keys skip them.
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        radioGroupKey(e, (j) => {
            const it = items[j];
            if (it !== undefined && it.key !== active) onPick(it.key);
        });
    };
    const own: Record<string, string> = { [data]: name };
    return (
        <Box css={ss.root} data-slot="seg" {...own} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
            {items.map((it) => (
                <chakra.button key={it.key} type="button" css={ss.item} role="radio"
                    aria-checked={it.key === active} tabIndex={it.key === stop ? 0 : -1}
                    data-state={it.key === active ? "on" : undefined}
                    onClick={() => onPick(it.key)}>
                    {it.label}
                </chakra.button>
            ))}
        </Box>
    );
}

/**
 * A segment strip folded into one chip (#952) — the checked segment and a
 * caret, opening a menu of every segment; picking one does what the strip's
 * press does. A toolbar's segments take this form once the row is short of
 * room.
 *
 * @param props - The strip's name, its segments, the checked one and what a pick does
 * @returns The chip, and its menu while open
 */
export function SegMenu<K extends string>({ label, name, data, items, active, onPick }: SegProps<K>) {
    const chip = useRecipe({ key: "chip" });
    const current = items.find((it) => it.key === active);
    const own: Record<string, string> = { [data]: name };
    return (
        <ChakraMenu.Root onSelect={(d) => {
            const it = items.find((x) => x.key === d.value);
            if (it !== undefined) onPick(it.key);
        }}>
            <ChakraMenu.Trigger asChild>
                {/* A 44px touch target on a coarse pointer, by its halo: the row keeps its height (#346, #1221). */}
                <chakra.button type="button" css={[chip({ tone: "neutral", numeric: true }), coarseHitArea({ position: true })]} data-slot="segMenu"
                    {...own} aria-label={label}>
                    {current?.label ?? active}
                    <Box as="span" data-chip-caret="">{"▾"}</Box>
                </chakra.button>
            </ChakraMenu.Trigger>
            <Portal>
                <ChakraMenu.Positioner>
                    <ChakraMenu.Content>
                        {items.map((it) => (
                            <ChakraMenu.Item key={it.key} value={it.key}>{it.label}</ChakraMenu.Item>
                        ))}
                    </ChakraMenu.Content>
                </ChakraMenu.Positioner>
            </Portal>
        </ChakraMenu.Root>
    );
}
