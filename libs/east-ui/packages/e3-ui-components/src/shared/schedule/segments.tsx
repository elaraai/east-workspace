/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Accessible segment controls shared by Plan and Calendar toolbars. */
import { useMemo, type KeyboardEvent } from "react";
import { Box, chakra, Menu as ChakraMenu, Portal, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown } from "@fortawesome/free-solid-svg-icons";
import { coarseHitArea, radioGroupKey } from "@elaraai/east-ui-components/internal";
type Styles = Record<string, Record<string, unknown>>;

/** A segment strip's props — shared by the strip and its one-chip menu. */
interface SegProps<K extends string> {
    /** What the strip picks — its radio group's (the menu's) accessible name. */
    label: string;
    /** Which strip it is, as `data-plan-seg` (`data-plan-segmenu`) says. */
    name: string;
    /** Host name for DOM measurements. */
    scope?: string;
    /** The segments, in order. */
    items: ReadonlyArray<{ key: K; label: string; disabled?: boolean | undefined; hint?: string | undefined }>;
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
 */
export function Seg<K extends string>({ label, name, scope = "plan", items, active, onPick }: SegProps<K>) {
    const seg = useSlotRecipe({ key: "seg" });
    const ss = useMemo(() => seg({}) as unknown as Styles, [seg]);
    const stop = items.some((it) => it.key === active && !it.disabled) ? active : items.find(it => !it.disabled)?.key;
    // The radio group's keys (shared with the Sheet's context switch): handled, so the canvas's own keys skip them.
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        radioGroupKey(e, (j) => {
            const it = items[j];
            if (it !== undefined && !it.disabled && it.key !== active) onPick(it.key);
        });
    };
    return (
        <Box css={ss.root} data-slot="seg" {...{ [`data-${scope}-seg`]: name }} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
            {items.map((it) => (
                <chakra.button key={it.key} type="button" css={ss.item} role="radio"
                    disabled={it.disabled} title={it.hint} aria-checked={it.key === active} tabIndex={it.key === stop ? 0 : -1}
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
 * caret, Font Awesome's (#1263), opening a menu of every segment; picking one
 * does what the strip's press does. The toolbar's segments take this form
 * once the row is short of room.
 */
export function SegMenu<K extends string>({ label, name, scope = "plan", items, active, onPick }: SegProps<K>) {
    const chip = useRecipe({ key: "chip" });
    const current = items.find((it) => it.key === active);
    return (
        <ChakraMenu.Root onSelect={(d) => {
            const it = items.find((x) => x.key === d.value);
            if (it !== undefined && !it.disabled) onPick(it.key);
        }}>
            <ChakraMenu.Trigger asChild>
                {/* A 44px touch target on a coarse pointer, by its halo: the row keeps its height (#346, #1221). */}
                <chakra.button type="button" css={[chip({ tone: "neutral", numeric: true }), coarseHitArea({ position: true })]} data-slot="segMenu"
                    {...{ [`data-${scope}-segmenu`]: name }} aria-label={label}>
                    {current?.label ?? active}
                    <FontAwesomeIcon icon={faCaretDown} data-chip-caret="" />
                </chakra.button>
            </ChakraMenu.Trigger>
            <Portal>
                <ChakraMenu.Positioner>
                    <ChakraMenu.Content>
                        {items.map((it) => (
                            <ChakraMenu.Item key={it.key} value={it.key} disabled={it.disabled} title={it.hint}>{it.label}</ChakraMenu.Item>
                        ))}
                    </ChakraMenu.Content>
                </ChakraMenu.Positioner>
            </Portal>
        </ChakraMenu.Root>
    );
}
