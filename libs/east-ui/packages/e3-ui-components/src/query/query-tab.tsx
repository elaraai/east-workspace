/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The pane's Query tab (#936) — the open query as steps, or as jq
 * (`Query Editor Spec.md` §4.2, §4.3, §4.8):
 *
 * - **visual**: the notices — what just happened, as dismissible banners —
 *   then the steps' scroller: the source's card, and after it and after every
 *   step its shape line; "Add a step to narrow, reshape or total the rows, or
 *   start from a saved query." while there are none; and the foot, with Add a
 *   step at the end and Quick add;
 * - **jq**: the note, while visual steps are left out or the jq does not
 *   parse, then the jq as typed, filling the tab. Leaving it is one gesture.
 *   (The jq view's highlighting, completions and problems panel are #937's.)
 *
 * What it draws and does is {@link useQueryEditor}'s.
 *
 * @packageDocumentation
 */

import { Fragment, memo } from "react";
import { Box, chakra, useSlotRecipe } from "@chakra-ui/react";
import { BannerView } from "@elaraai/east-ui-components";
import { QueryFoot } from "./foot.js";
import type { PartStyles, Styles } from "./parts.js";
import { ShapeLineView } from "./shape-line.js";
import { SourceCardView } from "./source.js";
import { StepCard } from "./step-card.js";
import type { QueryEditor } from "./use-query-editor.js";

/** Props of {@link QueryTabPanel}. */
export interface QueryTabPanelProps {
    /** Editing the open query: what the tab draws, and does. */
    readonly editor: QueryEditor;
    /** The parts' styles, and the words. */
    readonly ps: PartStyles;
    /** The workspace the data sources are read in, when the builder knows it. */
    readonly workspace: string | undefined;
    /** The step an issue the history item went to is on. */
    readonly focus: string | undefined;
}

/**
 * Renders the Query tab — see the module docs.
 *
 * @param props - The editor, the styles, the workspace and the focus ({@link QueryTabPanelProps})
 * @returns The tab
 */
export const QueryTabPanel = memo(function QueryTabPanel({ editor, ps, workspace, focus }: QueryTabPanelProps) {
    const { styles, words } = ps;
    const m = words.messages;
    const jq = useSlotRecipe({ key: "jqEditor" })() as Styles;
    if (editor.view === "jq") {
        return (
            <Box css={styles.tab} data-query-tab="query" data-mode="jq">
                {editor.jqNote !== undefined && (
                    <Box css={styles.notices}><BannerView status="warning" title={editor.jqNote} /></Box>
                )}
                <Box css={jq.root}>
                    <Box css={jq.editor}>
                        <Box css={jq.code}>
                            <chakra.textarea css={jq.input} value={editor.jqText} aria-label={m.jqLabel()} spellCheck={false}
                                data-query-jq="" onChange={(event) => editor.onJqText(event.target.value)} onBlur={editor.leaveJq} />
                        </Box>
                    </Box>
                </Box>
            </Box>
        );
    }
    const { source, cards, actions } = editor;
    return (
        <Box css={styles.tab} data-query-tab="query" data-mode="visual">
            <Box css={styles.notices}>
                {editor.notices.map((notice) => (
                    <BannerView key={notice.id} status="info" title={notice.text} dismissible onDismiss={() => editor.dismiss(notice.id)} />
                ))}
            </Box>
            <Box css={styles.steps} role="group" aria-label={m.stepsLabel()} data-query-steps="">
                {source !== undefined && (
                    <>
                        <SourceCardView card={source} source={editor.query.source} workspace={workspace} ps={ps} />
                        <ShapeLineView shape={source.shape} at={0} ps={ps} onSlot={actions.onSlot} />
                    </>
                )}
                {cards.map((card) => (
                    <Fragment key={card.stepId}>
                        <StepCard card={card} count={cards.length} focused={focus === card.stepId} ps={ps} actions={actions} />
                        <ShapeLineView shape={card.shape} at={card.index + 1} ps={ps} onSlot={actions.onSlot} />
                    </Fragment>
                ))}
                {cards.length === 0 && <Box as="p" css={styles.empty} data-query-empty="">{m.noSteps()}</Box>}
            </Box>
            <QueryFoot options={editor.quick} ps={ps} onSlot={actions.onSlot} onQuick={editor.onQuick} />
        </Box>
    );
});
