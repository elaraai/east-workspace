/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `ChipMenu` — a toolbar's folded chip (#1229): ONE chip whose menu holds the
 * controls a row short of room folds into it, as the SnapGrid editor's View
 * chip holds its zoom and its design widths, and Studio's and the query
 * builder's ⋯ hold their actions. The chip is the menu's trigger, drawn as the
 * review's menu chip is: the `chip` recipe, an icon and, when it discloses a
 * choice, the caret — a 44px touch target on a coarse pointer by its halo, its
 * size kept (#346, #1221). In a frame's eyebrow it is `bare`: the design
 * system's small ghost icon button, 24 × 24 with no border or fill (#1671,
 * TIL-2). The menu is the theme's; its items are the host's, each doing what
 * the control it stands for does.
 *
 * @packageDocumentation
 */

import { type ReactNode } from "react";
import { chakra, Menu as ChakraMenu, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown, type IconDefinition } from "@fortawesome/free-solid-svg-icons";
import { coarseHitArea } from "../style/hit-area.js";
import { FrameMenuLayer } from "../layout/builder-frame/frame-layer.js";

/** Props of {@link ChipMenu}. */
export interface ChipMenuProps {
    /** The chip's accessible name, and its tooltip. */
    label: string;
    /** Its icon. */
    icon: IconDefinition;
    /** Whether the chip draws the disclosure caret after its icon — for a menu that holds a choice. */
    caret?: boolean | undefined;
    /** Whether the trigger is a bare icon button — 24 × 24, no border or fill — as a frame's eyebrow holds its menu. */
    bare?: boolean | undefined;
    /** The chip's own data attribute, set empty — `data-snap-grid-view` — for its host's tests. */
    data?: `data-${string}` | undefined;
    /** What picking an item does, by the item's value. */
    onSelect?: ((value: string) => void) | undefined;
    /** The menu's items: the theme's `Menu.Item`s, a radio group, a separator. */
    children: ReactNode;
}

/**
 * Renders the chip and its menu — see the module docs.
 *
 * @param props - The chip's name, icon and caret, and the menu's items
 * @returns The chip, and its menu while open
 */
export function ChipMenu({ label, icon, caret = false, bare = false, data, onSelect, children }: ChipMenuProps) {
    const chip = useRecipe({ key: "chip" });
    const iconButton = useRecipe({ key: "iconButton" });
    const own: Record<string, string> = data === undefined ? {} : { [data]: "" };
    return (
        <ChakraMenu.Root {...(onSelect !== undefined && { onSelect: (d: { value: string }) => onSelect(d.value) })}>
            <ChakraMenu.Trigger asChild>
                <chakra.button type="button" css={bare ? iconButton({ variant: "ghost", size: "2xs" }) : [chip({ tone: "neutral" }), coarseHitArea({ position: true })]}
                    aria-label={label} title={label} {...(bare ? {} : { "data-icon-alone": "" })} {...own}>
                    <FontAwesomeIcon icon={icon} {...(bare ? {} : { "data-chip-icon": "" })} />
                    {caret && <FontAwesomeIcon icon={faCaretDown} data-chip-caret="" />}
                </chakra.button>
            </ChakraMenu.Trigger>
            <FrameMenuLayer label={label}>{children}</FrameMenuLayer>
        </ChakraMenu.Root>
    );
}
