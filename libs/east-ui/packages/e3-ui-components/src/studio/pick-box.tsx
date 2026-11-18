/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Configure field's picker (#1672, #1673): a box that says what is chosen
 * — its icon, its words, a caret — and opens the shared Chooser in a popover
 * hanging from it: a visual's source, what its click does, the visual it
 * follows and the fields that match them.
 *
 * @packageDocumentation
 */

import { useState } from "react";
import { Box, chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconProp } from "@fortawesome/fontawesome-svg-core";
import { faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { SliceEditPopover } from "@elaraai/east-ui-components";
import { Chooser, type ChooserSection } from "@elaraai/east-ui-components/internal";

/** Props of {@link PickBox}. */
export interface PickBoxProps {
    /** What it picks: its popover's head, and its box's name before what is chosen. */
    readonly label: string;
    /** What is chosen, in words. */
    readonly said: string;
    /** An icon before the words; none unless given. */
    readonly icon?: IconProp | undefined;
    /** The choices. */
    readonly sections: readonly ChooserSection[];
    /** What the chooser's search says while empty. */
    readonly placeholder: string;
    /** The box's data attributes: what a test and a style find it by. */
    readonly data?: Readonly<Record<`data-${string}`, string | undefined>> | undefined;
    /** Told the choice's key, once the popover has closed. */
    readonly onChoose: (key: string) => void;
}

/**
 * A Configure field's picker — see the module docs.
 *
 * @param props - What it picks, what is chosen, the choices and what a choice does
 * @returns The box, and its popover while open
 */
export function PickBox({ label, said, icon, sections, placeholder, data, onChoose }: PickBoxProps) {
    const styles = useSlotRecipe({ key: "studioInspector" })() as Record<string, SystemStyleObject>;
    const [open, setOpen] = useState(false);
    return (
        <SliceEditPopover open={open} onOpenChange={setOpen} label={label} flush
            trigger={(
                <chakra.button type="button" css={styles.box} aria-label={`${label}: ${said}`} {...data}>
                    {icon !== undefined && <Box as="span" css={styles.boxIcon} aria-hidden><FontAwesomeIcon icon={icon} /></Box>}
                    <Box as="span" css={styles.boxName}>{said}</Box>
                    <Box as="span" css={styles.boxCaret} aria-hidden><FontAwesomeIcon icon={faChevronDown} /></Box>
                </chakra.button>
            )}>
            <Chooser sections={[...sections]} placeholder={placeholder} onChoose={(key) => {
                setOpen(false);
                onChoose(key);
            }} />
        </SliceEditPopover>
    );
}
