/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A list's tile (#1671, LST-1, LST-2): {@link listModel}'s rows, each a
 * two-line row — its name, its caption under it, its values with their units
 * at the end — and, with the ranking bar on, a square 4px bar under its
 * line, its first value against the largest of every item; a page of its
 * items at a time (#1667), with where the page stands and the Pagination in
 * its foot past one page; and, when its first N holds fewer items than its
 * source has, a line that says how many of how many. Where its visual's
 * click does something a row is a button, which tells the group it stands
 * for; a selected row is `--paper-3` (LST-3).
 *
 * @packageDocumentation
 */

import { Fragment, useCallback } from "react";
import { Box } from "@chakra-ui/react";
import { variant } from "@elaraai/east";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import type { PrintSource, PrintState } from "../../query/visual/print.js";
import { useQueryWords } from "../../query/words.js";
import { useStudioMessages } from "../messages.js";
import { rowClickProps, useVisualClicks } from "./clicks.js";
import { listModel, type ListView } from "./list-rows.js";
import { VisualMeta } from "./meta.js";
import { SourceFailed } from "./notes.js";
import { VisualGroupsFoot, usePagedModel, type PageModelOf } from "./paging.js";
import type { Visual, VisualSource } from "./values.js";

/** Props of {@link ListVisual}: the list, its source, the page's state, and where its pager keeps its state. */
export interface ListVisualProps {
    /** The visual: a list. */
    readonly visual: Visual;
    /** The list. */
    readonly list: ListView;
    /** Its source, as the surface lists it. */
    readonly source: VisualSource;
    /** Its source, as the printer reads it. */
    readonly read: PrintSource;
    /** The page's state, as its programs read it. */
    readonly state: PrintState;
    /** Where its pager keeps its state. */
    readonly storageKey: string;
}

/**
 * A list's tile: a page of its rows, where the page stands, and what it holds
 * of how many.
 *
 * @param props - The list, its source, the page's state and where its pager keeps its state
 * @returns The tile's body; nothing until its program answers
 */
export function ListVisual({ visual, list, source, read, state, storageKey }: ListVisualProps) {
    const m = useStudioMessages();
    const words = useQueryWords();
    const styles = useSlotStyles("studioVisual");
    const modelOf = useCallback<PageModelOf<ReturnType<typeof listModel>>>((asks, answers, offset) => listModel(list, asks, answers, source, words, m, offset),
        [list, source, words, m]);
    const { drawn, waiting, failed, offset, setPage } = usePagedModel(visual, read, state, modelOf);
    // A row is a button where its visual's click does something: it tells the group it stands for (LST-3).
    const clicks = useVisualClicks();
    if (failed !== undefined) return <SourceFailed source={source.name} message={failed.message} retry={failed.retry} />;
    if (drawn === undefined) return null;
    return (
        <Box css={styles.root} data-studio-list="" data-waiting={waiting ? "" : undefined}>
            <VisualMeta view={variant("list", list)} source={source} shown={drawn.shown} />
            <Box css={styles.list}>
                {drawn.rows.map((row, i) => (
                    <Box key={i} css={styles.listRow} data-studio-list-row="" data-bar={drawn.bar ? "" : undefined} data-caption={row.caption !== undefined ? "" : undefined}
                        {...rowClickProps(clicks, row.clicked)}>
                        <Box css={styles.listLine}>
                            <Box css={styles.listText}>
                                <Box as="span" css={styles.listName} data-studio-list-name="">{row.name}</Box>
                                {row.caption !== undefined && <Box as="span" css={styles.listCaption} data-studio-list-caption="">{row.caption}</Box>}
                            </Box>
                            {row.values.map((value, v) => (
                                <Fragment key={v}>
                                    <Box as="span" css={styles.listValue} data-studio-list-value="">{value.text}</Box>
                                    {value.unit !== undefined && <Box as="span" css={styles.listUnit}>{value.unit}</Box>}
                                </Fragment>
                            ))}
                        </Box>
                        {drawn.bar && (
                            <Box css={styles.listBar} data-studio-list-bar="">
                                <Box css={styles.listBarFill} style={{ width: `${(row.share ?? 0) * 100}%` }} />
                            </Box>
                        )}
                    </Box>
                ))}
            </Box>
            <VisualGroupsFoot place={drawn.place} shown={drawn.shown} offset={offset} onPage={setPage} storageKey={storageKey} />
        </Box>
    );
}
