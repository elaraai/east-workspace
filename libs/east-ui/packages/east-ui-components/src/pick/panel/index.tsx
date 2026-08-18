/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useState } from "react";
import { Box, chakra, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEye, faEyeSlash, faMagnifyingGlass, faXmark } from "@fortawesome/free-solid-svg-icons";
import { type ValueTypeOf } from "@elaraai/east";
import { Pick } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { toFontAwesomeIcon } from "../../display/icon";
import { useSliceReactivity } from "../../slice/use-slice-reactivity";
import { useSliceDensity } from "../../slice/density";

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
    // At `editor` density this panel is INSIDE the terminal surface — a
    // `SliceEditPopover`, which brings its own head, border and close — so it
    // drops its own frame rather than drawing a second set. That decision rides
    // the shared density context, not a prop of its own: it is the same call
    // `SliceEditPopover` makes about nesting, and one mechanism means the panel
    // is right in ANY editor surface, not only the one call site that knew to
    // pass a flag. Standalone the context defaults to `focused`, so the frame
    // stands.
    const density = useSliceDensity();
    useSliceReactivity(pick.key);

    const frame = useSlotRecipe({ key: "sliceFrame" })();
    const styles = useSlotRecipe({ key: "pickPanel" })({ surface: density === "editor" ? "editor" : "framed" });

    const hidden = new Set(pick.state.read());
    const items = pick.items;
    const shownCount = items.filter((i: PickItemValue) => !hidden.has(i.id)).length;

    // Filtering the LIST, not the canvas. A library search answers "where is
    // the one I want" — it must not change which series are on screen, so it
    // never touches the hidden set. Purely local: nothing to persist, and a
    // query surviving a reload would hide most of the library on arrival.
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase();
    const listed = q === ""
        ? items
        : items.filter((i: PickItemValue) => {
            const sub = getSomeorUndefined(i.subtitle) ?? "";
            return i.title.toLowerCase().includes(q) || sub.toLowerCase().includes(q);
        });

    // Ids must be UNIQUE — the state addresses items by id, so two entries
    // sharing one are a single switch wearing two labels: toggling either hides
    // both, and a persisted id cannot say which was meant. Nothing can resolve
    // that for the author (dropping one would silently remove a series that is
    // still on the canvas, since the FEED filters the item list, not this one),
    // so it is reported rather than papered over.
    if (process.env.NODE_ENV !== "production") {
        const seen = new Set<string>();
        for (const i of items as ReadonlyArray<PickItemValue>) {
            if (seen.has(i.id)) {
                console.error(
                    `[Pick.Panel] duplicate item id "${i.id}" — ids address the hidden set, so these ` +
                    `entries share one switch and toggle together. Give each a distinct key.`,
                );
                break;
            }
            seen.add(i.id);
        }
    }

    // Read live, then write: two clicks inside one frame must compose.
    const toggle = (id: string) => {
        const live = new Set(pick.state.read());
        if (live.has(id)) live.delete(id); else live.add(id);
        pick.state.write([...live]);
    };

    // Always present, not gated on a length threshold: a library is a thing you
    // search, and a control that appears once the data grows past some number
    // is a surprise rather than a discovery.
    const search = (
        <Box css={styles.search} data-slot="pickSearch">
            <Box as="span" css={frame.searchPill}>
                <FontAwesomeIcon icon={faMagnifyingGlass} style={{ fontSize: "10px" }} />
                <chakra.input
                    css={styles.searchInput}
                    value={query}
                    placeholder="Search series"
                    aria-label="Search series"
                    onChange={(e) => setQuery(e.currentTarget.value)}
                />
                {q !== "" && (
                    <chakra.button type="button" css={frame.searchClear}
                        aria-label="Clear search" onClick={() => setQuery("")}>
                        <FontAwesomeIcon icon={faXmark} style={{ fontSize: "10px" }} />
                    </chakra.button>
                )}
            </Box>
        </Box>
    );

    const rows = (
        <>
            {search}
            {listed.length === 0 && (
                <Box css={styles.empty} data-slot="pickEmpty">{`No series match "${query.trim()}"`}</Box>
            )}
            {listed.map((item: PickItemValue, i: number) => {
                const on = !hidden.has(item.id);
                const icon = getSomeorUndefined(item.icon);
                const count = getSomeorUndefined(item.count);
                return (
                    <chakra.button
                        // Position, not id: a duplicate id is an author error
                        // the panel reports rather than crashes on, and React
                        // must still reconcile correctly while it stands — the
                        // list re-renders on every search keystroke.
                        key={`${item.id}#${i}`}
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
        </>
    );

    if (density === "editor") {
        return <Box data-slot="pickPanel" data-density="editor">{rows}</Box>;
    }
    return (
        <Box css={frame.root} data-slot="pickPanel" data-density={density}>
            <Box css={frame.header}>
                <Box as="span" css={frame.eyebrow}>{title}</Box>
                <Box as="span" css={styles.headMeta}>{`${shownCount} of ${items.length}`}</Box>
            </Box>
            {rows}
        </Box>
    );
}, () => false);
