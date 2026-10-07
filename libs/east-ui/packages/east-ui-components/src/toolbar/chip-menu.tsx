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
 * size kept (#346, #1221). The menu is the theme's; its items are the host's,
 * each doing what the control it stands for does.
 *
 * @packageDocumentation
 */

import { type ReactNode } from "react";
import { Box, chakra, Menu as ChakraMenu, Portal, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { type IconDefinition } from "@fortawesome/free-solid-svg-icons";
import { coarseHitArea } from "../style/hit-area.js";

/** Props of {@link ChipMenu}. */
export interface ChipMenuProps {
    /** The chip's accessible name, and its tooltip. */
    label: string;
    /** Its icon. */
    icon: IconDefinition;
    /** Whether the chip draws the disclosure caret after its icon — for a menu that holds a choice. */
    caret?: boolean | undefined;
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
export function ChipMenu({ label, icon, caret = false, data, onSelect, children }: ChipMenuProps) {
    const chip = useRecipe({ key: "chip" });
    const own: Record<string, string> = data === undefined ? {} : { [data]: "" };
    return (
        <ChakraMenu.Root {...(onSelect !== undefined && { onSelect: (d: { value: string }) => onSelect(d.value) })}>
            <ChakraMenu.Trigger asChild>
                <chakra.button type="button" css={[chip({ tone: "neutral", numeric: true }), coarseHitArea({ position: true })]}
                    aria-label={label} title={label} {...own}>
                    <FontAwesomeIcon icon={icon} data-chip-icon="" />
                    {caret && <Box as="span" data-chip-caret="">{"▾"}</Box>}
                </chakra.button>
            </ChakraMenu.Trigger>
            <Portal>
                <ChakraMenu.Positioner>
                    <ChakraMenu.Content>{children}</ChakraMenu.Content>
                </ChakraMenu.Positioner>
            </Portal>
        </ChakraMenu.Root>
    );
}
