/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The builder's first row on a phone (`Studio Mobile Spec.md` ST1–ST5): the
 * page's status, Save as template while it fits (from 372 px), Preview and
 * Publish, each a 32 box in a 44 target; below 372 Save as template leaves the
 * row for ⋯, which goes straight to its view — a phone has no menu of one.
 *
 * @packageDocumentation
 */

import { memo, useLayoutEffect, useRef, useState } from "react";
import { Box, chakra, VisuallyHidden } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEllipsis } from "@fortawesome/free-solid-svg-icons";
import { useContainerWidth } from "@elaraai/east-ui-components";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { useStudioMessages } from "./messages.js";
import { StudioSaveTemplate, type StudioSaveTemplateProps } from "./save-template.js";

/** The narrowest frame whose first row holds Save as template (ST3). */
const TEMPLATE_INLINE_FROM = 372;

/** Props of {@link StudioPhoneBar}. */
export interface StudioPhoneBarProps {
    /** The page's status: its word and its tone. */
    readonly status: { readonly label: string; readonly tone: string } | undefined;
    /** Save as template. */
    readonly saveTemplate: StudioSaveTemplateProps["value"];
    /** The project. */
    readonly project: string;
    /** Opens the preview on Page (ST5). */
    readonly onPreview: () => void;
    /** Opens the preview on Changes (ST5). */
    readonly onPublish: () => void;
}

/**
 * The first row — see the module docs.
 *
 * @param props - The status, and what the buttons do
 * @returns The row
 */
export const StudioPhoneBar = memo(function StudioPhoneBar({ status, saveTemplate, project, onPreview, onPublish }: StudioPhoneBarProps) {
    const styles = useSlotStyles("studioPhone");
    const m = useStudioMessages();
    // The row's own width, the frame's whatever holds it. Unmeasured, the narrow form: nothing to cut.
    const barRef = useRef<HTMLDivElement | null>(null);
    const width = useContainerWidth(barRef);
    // Past the width's own rule (ST3), a status too long for the row gives way: Save as template goes to ⋯, then the
    // status keeps its dot, its word whole or not at all (ST39). Measured before paint, again as the width or the word moves.
    const [gave, setGave] = useState(0);
    const label = status?.label;
    useLayoutEffect(() => { setGave(0); }, [width, label]);
    useLayoutEffect(() => {
        const bar = barRef.current;
        if (bar !== null && gave < 2 && bar.scrollWidth > bar.clientWidth + 0.5) setGave(gave + 1);
    }, [gave, width, label]);
    const inline = width >= TEMPLATE_INLINE_FROM && gave === 0;
    const trigger = inline
        ? <chakra.button type="button" css={styles.target} disabled={!saveTemplate.enabled} data-studio-save-template=""><Box as="span" css={styles.box}>{m.saveAsTemplate()}</Box></chakra.button>
        : <chakra.button type="button" css={styles.more} disabled={!saveTemplate.enabled} aria-label={m.saveAsTemplate()} data-studio-more=""><FontAwesomeIcon icon={faEllipsis} /></chakra.button>;
    const template = <StudioSaveTemplate value={saveTemplate} phoneTrigger={trigger} project={project} />;
    return (
        <Box ref={barRef} css={styles.bar} data-studio-phone-bar="" data-ends-more={inline ? undefined : ""}>
            {status !== undefined && (
                <Box as="span" css={styles.status} data-studio-status={status.tone}>
                    <Box as="span" css={styles.statusDot} data-tone={status.tone} aria-hidden />{gave < 2 ? status.label : <VisuallyHidden>{status.label}</VisuallyHidden>}
                </Box>
            )}
            {inline && template}
            <chakra.button type="button" css={styles.target} data-studio-preview="" onClick={onPreview}><Box as="span" css={styles.box}>{m.preview()}</Box></chakra.button>
            <chakra.button type="button" css={styles.target} data-studio-open-publish="" onClick={onPublish}><Box as="span" css={styles.box}>{m.publish()}</Box></chakra.button>
            {!inline && template}
        </Box>
    );
});
