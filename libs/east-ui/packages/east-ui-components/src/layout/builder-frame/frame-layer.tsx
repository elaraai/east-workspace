/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a menu or a Select's list opens in a phone's frame (ruled 4 Nov 2026: no
 * desktop-style popover on a phone): a view over the whole builder, in the
 * frame's overlay slot, its head ← and its name, its rows 44 tall. The menu or
 * the Select is the same one a wider frame floats, keeping its keys, its
 * dismissal and its items; only where it draws changes. Outside a phone's
 * frame it floats, as it does elsewhere.
 *
 * Every row's words and its styles are its host's, and the view's look is the
 * `builderFrame` recipe's `overlay` and `frameView`'s head.
 *
 * @packageDocumentation
 */

import { createContext, useContext, useMemo, type ComponentProps, type ReactNode } from "react";
import { Box, chakra, Menu as ChakraMenu, Portal, Select as ChakraSelect } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft } from "@fortawesome/free-solid-svg-icons";
import { useSlotStyles } from "../../theme/slot-styles.js";

/** The phone's overlay slot for what a menu or a Select's list opens, while the frame is a phone's; `null` otherwise. */
export const FramePhoneLayer = createContext<HTMLElement | null>(null);

/** The name of the field a control stands in: what a Select's view is headed with on a phone, where the Select names nothing itself. */
export const FrameFieldName = createContext<string | undefined>(undefined);

/** The view's head: ← and its name. */
function LayerHead({ label, onClose }: { label: string; onClose: () => void }) {
    const styles = useSlotStyles("frameView");
    return (
        <Box css={styles.head} data-frame-layer-head="">
            <chakra.button type="button" css={styles.back} aria-label="Back" data-frame-view-back="" onClick={onClose}>
                <FontAwesomeIcon icon={faArrowLeft} aria-hidden />
            </chakra.button>
            <Box as="span" css={styles.title}>{label}</Box>
        </Box>
    );
}

/** Props of {@link FrameMenuLayer}: the content's own, and the view's name. */
export type FrameMenuLayerProps = ComponentProps<typeof ChakraMenu.Content> & {
    /** The view's head on a phone: what the menu is for. */
    label: string;
    children?: ReactNode;
};

/**
 * A menu's positioner and content: floating, or on a phone a view over the builder.
 *
 * @param props - The view's name, and the content's props and items
 * @returns The menu's layer
 */
export function FrameMenuLayer({ label, children, ...content }: FrameMenuLayerProps) {
    const slot = useContext(FramePhoneLayer);
    const container = useMemo(() => ({ current: slot }), [slot]);
    if (slot === null) {
        return <Portal><ChakraMenu.Positioner><ChakraMenu.Content {...content}>{children}</ChakraMenu.Content></ChakraMenu.Positioner></Portal>;
    }
    return (
        <Portal container={container}>
            <ChakraMenu.Positioner data-frame-layer="" data-escape-layer="">
                <ChakraMenu.Content {...content} aria-label={label} data-frame-layer-content="">
                    <ChakraMenu.Context>{(menu) => <LayerHead label={label} onClose={() => menu.setOpen(false)} />}</ChakraMenu.Context>
                    {children}
                </ChakraMenu.Content>
            </ChakraMenu.Positioner>
        </Portal>
    );
}

/** Props of {@link FrameSelectLayer}. */
export interface FrameSelectLayerProps {
    /** The view's head on a phone: what is being chosen. */
    label: string;
    /** Draws the list in place, floating: inside a popover, whose list a portal would dismiss. Not on a phone. */
    inPlace?: boolean | undefined;
    children?: ReactNode;
}

/**
 * A Select's positioner and content: floating, or on a phone a view over the builder.
 *
 * @param props - The view's name, and the list's items
 * @returns The list's layer
 */
export function FrameSelectLayer({ label, inPlace = false, children }: FrameSelectLayerProps) {
    const slot = useContext(FramePhoneLayer);
    const container = useMemo(() => ({ current: slot }), [slot]);
    if (slot === null) {
        return <Portal disabled={inPlace}><ChakraSelect.Positioner><ChakraSelect.Content>{children}</ChakraSelect.Content></ChakraSelect.Positioner></Portal>;
    }
    return (
        <Portal container={container}>
            <ChakraSelect.Positioner data-frame-layer="" data-escape-layer="">
                <ChakraSelect.Content aria-label={label} data-frame-layer-content="">
                    <ChakraSelect.Context>{(select) => <LayerHead label={label} onClose={() => select.setOpen(false)} />}</ChakraSelect.Context>
                    {children}
                </ChakraSelect.Content>
            </ChakraSelect.Positioner>
        </Portal>
    );
}
