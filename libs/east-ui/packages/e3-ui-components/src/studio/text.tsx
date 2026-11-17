/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `StudioText` — a page's text block (#1669): its heading over its
 * paragraphs, with no frame. Its paragraphs are e3-ui's East
 * (`textParagraphs`: a blank line starts a new one), its styles the
 * `studioText` recipe's.
 *
 * @packageDocumentation
 */

import { memo, useMemo } from "react";
import { Box } from "@chakra-ui/react";
import type { ValueTypeOf } from "@elaraai/east";
import type { StudioTextType } from "@elaraai/e3-ui/internal";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";

import { studioEast } from "./studio-east.js";

/** Props of {@link StudioText}. */
export interface StudioTextProps {
    /** The text block: its heading and its text. */
    text: ValueTypeOf<typeof StudioTextType>;
}

/**
 * Renders a text block — see the module docs.
 *
 * @param props - The text block
 * @returns Its heading over its paragraphs
 */
export const StudioText = memo(function StudioText({ text }: StudioTextProps) {
    const styles = useSlotStyles("studioText");
    const east = studioEast();
    const paragraphs = useMemo(() => east.textParagraphs(text.body), [east, text.body]);
    return (
        <Box css={styles.root} data-studio-text="">
            {text.heading.type === "some" && <Box as="h3" css={styles.heading} data-studio-text-heading="">{text.heading.value}</Box>}
            {paragraphs.map((paragraph, at) => <Box as="p" key={at} css={styles.paragraph} data-studio-text-paragraph="">{paragraph}</Box>)}
        </Box>
    );
});
