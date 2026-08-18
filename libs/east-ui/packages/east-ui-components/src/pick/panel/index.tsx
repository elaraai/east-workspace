/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo } from "react";
import { Box, chakra, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEye, faEyeSlash } from "@fortawesome/free-solid-svg-icons";
import { type ValueTypeOf } from "@elaraai/east";
import { Pick } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { toFontAwesomeIcon } from "../../display/icon";
import { useSliceReactivity } from "../../slice/use-slice-reactivity";

/** The decoded `PickPanel` arm — DERIVED from the East type, never mirrored. */
export type PickPanelValue = ValueTypeOf<typeof Pick.Types.Panel>;

/** One row's descriptor, as the panel reads it. */
type PickItemValue = ValueTypeOf<typeof Pick.Types.Item>;

export interface EastChakraPickPanelProps {
    value: PickPanelValue;
}

/**
 * Renders a `Pick.Panel` — the library of a component's declared things.
 *
 * @remarks
 * The panel knows nothing about what it is listing. It reads `items`
 * (`id · title · subtitle · icon · count · narrowed`), draws a row each, and
 * writes the hidden set. That is what lets one component serve a Plan's row
 * series, a Table's columns and a Chart's layers without a line of per-adopter
 * code — the author supplies the noun through `title`.
 *
 * Three things it borrows deliberately from `Slice.Legend`, because they are
 * the same problem:
 *
 * - `useSliceReactivity(pick.key)` — the hook is key-generic, not slice-
 *   specific, so the panel is self-driving: a write repaints it whether or not
 *   the enclosing `Reactive.Root` happened to read the pick.
 * - The handler reads LIVE state before writing. A second click landing before
 *   the first re-render commits must compose with it, not overwrite it — a
 *   render-time snapshot would drop the earlier toggle.
 * - The switched-off row dims as ONE rule on the row, never per part.
 *
 * `memo(…, () => false)` matches the slice surfaces: the value carries East
 * closures, and East compares every function as equal, so a structural
 * comparator would report "unchanged" across a real state change.
 */
export const EastChakraPickPanel = memo(function EastChakraPickPanel({ value }: EastChakraPickPanelProps) {
    const { pick, title } = value;
    useSliceReactivity(pick.key);

    const frame = useSlotRecipe({ key: "sliceFrame" })();
    const styles = useSlotRecipe({ key: "pickPanel" })();

    const hidden = new Set(pick.state.read());
    const items = pick.items;
    const shownCount = items.filter((i: PickItemValue) => !hidden.has(i.id)).length;

    // Read live, then write: two clicks inside one frame must compose.
    const toggle = (id: string) => {
        const live = new Set(pick.state.read());
        if (live.has(id)) live.delete(id); else live.add(id);
        pick.state.write([...live]);
    };

    return (
        <Box css={frame.root} data-slot="pickPanel">
            <Box css={frame.header}>
                <Box as="span" css={frame.eyebrow}>{title}</Box>
                <Box as="span" css={styles.headMeta}>
                    {`${shownCount} of ${items.length}`}
                </Box>
            </Box>
            {items.map((item: PickItemValue) => {
                const on = !hidden.has(item.id);
                const icon = getSomeorUndefined(item.icon);
                const count = getSomeorUndefined(item.count);
                return (
                    <chakra.button
                        key={item.id}
                        type="button"
                        css={styles.row}
                        data-on={on ? "true" : "false"}
                        aria-pressed={on}
                        aria-label={`Toggle ${item.title}`}
                        onClick={() => toggle(item.id)}
                    >
                        <Box as="span" css={styles.kind}>
                            {icon !== undefined && <FontAwesomeIcon {...toFontAwesomeIcon(icon)} />}
                        </Box>
                        <Box as="span" css={styles.text}>
                            <Box as="span" css={styles.label}>{item.title}</Box>
                            {getSomeorUndefined(item.subtitle) !== undefined && (
                                <Box as="span" css={styles.sub}>{getSomeorUndefined(item.subtitle)}</Box>
                            )}
                        </Box>
                        {count !== undefined && (
                            <Box
                                as="span"
                                css={styles.count}
                                data-zero={count === 0n ? "" : undefined}
                                data-narrowed={item.narrowed ? "" : undefined}
                            >
                                {`${count}`}
                            </Box>
                        )}
                        <Box as="span" css={styles.eye} data-on={on ? "true" : "false"}>
                            <FontAwesomeIcon icon={on ? faEye : faEyeSlash} />
                        </Box>
                    </chakra.button>
                );
            })}
        </Box>
    );
}, () => false);
