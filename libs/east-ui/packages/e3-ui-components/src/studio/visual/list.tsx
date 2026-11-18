/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A list's tile (#1671, LST-1, LST-2): {@link listModel}'s rows, each a
 * two-line row — its name, its caption under it, its values with their units
 * at the end — and, with the ranking bar on, a square 4px bar under its
 * line, its first value against the largest; and, when it holds
 * fewer items than its source has, a line that says how many of how many.
 *
 * @packageDocumentation
 */

import { Fragment, useMemo } from "react";
import { Box } from "@chakra-ui/react";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { useQueryWords } from "../../query/words.js";
import { useStudioMessages } from "../messages.js";
import { listModel, type ListView } from "./list-rows.js";
import { ShownNote } from "./notes.js";
import type { VisualAsked } from "./values.js";

/** Props of {@link ListVisual}: the list, its answers and its source. */
export interface ListVisualProps extends VisualAsked {
    /** The list. */
    readonly list: ListView;
}

/**
 * A list's tile: its rows, and what it holds of how many.
 *
 * @param props - The list, its answers and its source
 * @returns The tile's body; nothing when its program did not answer
 */
export function ListVisual({ list, asks, answers, source }: ListVisualProps) {
    const m = useStudioMessages();
    const words = useQueryWords();
    const styles = useSlotStyles("studioVisual");
    const model = useMemo(() => listModel(list, asks, answers, source, words, m), [list, asks, answers, source, words, m]);
    if (model === undefined) return null;
    return (
        <Box css={styles.root} data-studio-list="">
            <Box css={styles.list}>
                {model.rows.map((row, i) => (
                    <Box key={i} css={styles.listRow} data-studio-list-row="" data-bar={model.bar ? "" : undefined} data-caption={row.caption !== undefined ? "" : undefined}>
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
                        {model.bar && (
                            <Box css={styles.listBar} data-studio-list-bar="">
                                <Box css={styles.listBarFill} style={{ width: `${(row.share ?? 0) * 100}%` }} />
                            </Box>
                        )}
                    </Box>
                ))}
            </Box>
            {model.shown !== undefined && (
                <Box css={styles.foot}>
                    <ShownNote shown={model.shown} />
                </Box>
            )}
        </Box>
    );
}
