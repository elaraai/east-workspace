/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `StudioInspector` — the builder's inspector (#996), the body of its pane
 * after the canvas, under the pane's tab row. It draws the selected placement
 * East computed — its name and key, what it reads (each path printed as e3
 * prints a keypath), its description, its layout — and sends every layout
 * edit through `onRequest`, which asks the canvas for it; the canvas takes it
 * as one gesture of the page's session, and the placement comes back drawn
 * anew.
 *
 * Its layout is the `studioInspector` recipe's; its controls are the theme's
 * shared ones — the brand `stepper` for the span, the numeric `input` for the
 * row, the `select` for the height — its chevron and check Font Awesome's
 * (#1263) — and the `seg` strip for the alignment.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import {
    Box, chakra, createListCollection, Portal, Select as ChakraSelect, useRecipe, useSlotRecipe, type SystemStyleObject,
} from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faArrowsToDot, faArrowsUpDown, faArrowsUpToLine, faCheck, faChevronDown, faLock, faMinus, faPlus, faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { pathToString } from "@elaraai/e3-types";
import { StudioInspectorPayloadType } from "@elaraai/e3-ui/internal";
import { useFormatters } from "@elaraai/east-ui-components";

import { useStudioMessages, type StudioMessages } from "./messages.js";

type Styles = Record<string, SystemStyleObject>;

/** The inspector, as the builder draws it. */
type StudioInspectorValue = ValueTypeOf<typeof StudioInspectorPayloadType>;
/** The selected placement, as East computed it. */
type Selection = Extract<StudioInspectorValue["selection"], { type: "some" }>["value"];
/** A change asked of the canvas. */
type Change = Parameters<StudioInspectorValue["onRequest"]>[0]["change"];
/** Where a placement sits in a taller row. */
type Align = Selection["layout"]["align"]["type"];

/** The least span the canvas leaves a tile — the stepper's floor. */
const LEAST_SPAN = 2;
/** The heights the Height select offers, in px, after Auto. */
const HEIGHTS = [160, 240, 320, 400, 480];
/** The alignments, in the strip's order, with their icons. */
const ALIGNS = [
    { align: "top", icon: faArrowsUpToLine, name: (m: StudioMessages) => m.alignTop() },
    { align: "center", icon: faArrowsToDot, name: (m: StudioMessages) => m.alignCenter() },
    { align: "stretch", icon: faArrowsUpDown, name: (m: StudioMessages) => m.alignStretch() },
] as const;

/** Props of {@link StudioInspector}. */
export interface StudioInspectorProps {
    /** The selected placement, and where a layout edit goes. */
    value: StudioInspectorValue;
}

/**
 * The placement's row, as a field: Enter or leaving it asks for the row
 * typed; Esc puts the row back; ↑ / ↓ step to the next row or the one before.
 */
function RowField({ row, onRow, css, id }: { row: number; onRow: (row: number) => void; css: SystemStyleObject[]; id: string }) {
    const [text, setText] = useState(String(row));
    useEffect(() => { setText(String(row)); }, [row]);
    const commit = () => {
        const asked = Number.parseInt(text, 10);
        if (!Number.isInteger(asked) || asked < 1 || asked === row) {
            setText(String(row));
            return;
        }
        onRow(asked);
    };
    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            commit();
        } else if (e.key === "Escape") {
            e.preventDefault();
            setText(String(row));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            onRow(row + 1);
        } else if (e.key === "ArrowDown" && row > 1) {
            e.preventDefault();
            onRow(row - 1);
        }
    };
    return (
        <chakra.input
            id={id}
            css={css}
            value={text}
            inputMode="numeric"
            autoComplete="off"
            data-inspector-row=""
            onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ""))}
            onBlur={commit}
            onKeyDown={onKeyDown}
        />
    );
}

/**
 * Renders the builder's inspector body — see the module docs.
 *
 * @param props - The selected placement, and where a layout edit goes
 * @returns The inspector's body
 */
export const StudioInspector = memo(function StudioInspector({ value }: StudioInspectorProps) {
    const styles = useSlotRecipe({ key: "studioInspector" })() as Styles;
    const stepper = useSlotRecipe({ key: "stepper" })({ tone: "brand", size: "md" }) as Styles;
    const seg = useSlotRecipe({ key: "seg" })() as Styles;
    const input = useRecipe({ key: "input" })({ variant: "numeric", size: "sm" }) as SystemStyleObject;
    const m = useStudioMessages();
    const words = useFormatters();
    const rowId = useId();
    const selection = value.selection.type === "some" ? value.selection.value : undefined;
    const onRequest = value.onRequest;
    const key = selection?.key;
    const ask = useCallback((change: Change) => {
        if (key === undefined) return;
        try {
            onRequest({ key, change });
        } catch (err) {
            console.error("[Studio.Builder] the inspector's layout request failed:", err);
        }
    }, [key, onRequest]);

    const height = selection !== undefined && selection.layout.height.type === "some" ? Number(selection.layout.height.value) : undefined;
    // Auto and the presets — and a height a drag left between them, where it is.
    // Each item carries its height, so a pick is never read back from its text.
    const heights = useMemo(() => createListCollection({
        items: [
            { value: "auto", label: m.auto(), px: undefined },
            ...[...new Set([...HEIGHTS, ...(height !== undefined ? [height] : [])])].sort((a, b) => a - b)
                .map((px) => ({ value: String(px), label: m.px({ px: words.bare(px) }), px })),
        ],
    }), [height, m, words]);

    if (selection === undefined) {
        return (
            <Box css={styles.root} data-studio-inspector="">
                <Box css={styles.empty} data-inspector="empty">
                    <Box as="span" css={styles.emptyTitle}>{m.nothingSelected()}</Box>
                    <Box as="span" css={styles.emptyHint}>{m.nothingSelectedHint()}</Box>
                </Box>
            </Box>
        );
    }

    const layout = selection.layout;
    const span = Number(layout.span);
    const most = Number(layout.most);
    const description = selection.description.type === "some" ? selection.description.value : undefined;
    const aligned: Align = layout.align.type;
    const heightKey = height === undefined ? "auto" : String(height);

    return (
        <Box css={styles.root} data-studio-inspector="">
            <Box css={styles.selection} data-inspector="selection">
                <Box as="span" css={styles.eyebrow}>{m.selectedComponent()}</Box>
                <Box as="span" css={styles.name} data-inspector-name="">{selection.name}</Box>
                <Box as="span" css={styles.meta} data-inspector-meta="">{selection.component}</Box>
                {selection.changed && (
                    <Box as="span" css={styles.warning} data-inspector-changed="">
                        <FontAwesomeIcon icon={faTriangleExclamation} />
                        {m.logicChanged()}
                    </Box>
                )}
            </Box>
            <Box css={styles.data} data-inspector="data">
                <Box as="span" css={styles.eyebrow}>{m.data()}</Box>
                {selection.reads.length > 0 ? (
                    <Box as="ul" css={styles.reads} aria-label={m.data()}>
                        {selection.reads.map((path) => {
                            const keypath = pathToString(path);
                            return <Box as="li" key={keypath} css={styles.read}>{keypath}</Box>;
                        })}
                    </Box>
                ) : (
                    <Box as="span" css={styles.noReads}>{m.readsNothing()}</Box>
                )}
            </Box>
            <Box css={styles.config} data-inspector="config">
                <Box css={styles.configHead}>
                    <Box as="span" css={styles.eyebrow}>{m.configuration()}</Box>
                    <Box as="span" css={styles.lockNote}>
                        <FontAwesomeIcon icon={faLock} />
                        {m.fixedByDeveloper()}
                    </Box>
                </Box>
                <Box as="p" css={styles.description} data-empty={description === undefined ? "" : undefined}>
                    {description ?? m.noDescription()}
                </Box>
            </Box>
            <Box css={styles.layout} data-inspector="layout">
                <Box as="span" css={styles.eyebrow}>{m.layout()}</Box>
                <Box css={styles.field}>
                    <Box as="span" css={styles.fieldLabel}>{m.columnSpan()}</Box>
                    <Box css={stepper.root} role="group" aria-label={m.columnSpan()}>
                        <chakra.button type="button" css={stepper.button} aria-label={m.decreaseSpan()} title={m.decreaseSpan()}
                            disabled={span <= LEAST_SPAN} onClick={() => ask(variant("span", BigInt(span - 1)))}>
                            <FontAwesomeIcon icon={faMinus} />
                        </chakra.button>
                        <Box as="output" css={stepper.value} data-inspector-span="">{m.spanOf({ span: words.number(span) })}</Box>
                        <chakra.button type="button" css={stepper.button} aria-label={m.increaseSpan()} title={m.increaseSpan()}
                            disabled={span >= most} onClick={() => ask(variant("span", BigInt(span + 1)))}>
                            <FontAwesomeIcon icon={faPlus} />
                        </chakra.button>
                    </Box>
                </Box>
                <Box css={styles.field}>
                    <chakra.label css={styles.fieldLabel} htmlFor={rowId}>{m.row()}</chakra.label>
                    <RowField row={Number(layout.row)} onRow={(row) => ask(variant("row", BigInt(row)))} css={[input, styles.rowField!]} id={rowId} />
                </Box>
                <Box css={styles.field}>
                    <Box as="span" css={styles.fieldLabel}>{m.height()}</Box>
                    <ChakraSelect.Root
                        collection={heights}
                        value={[heightKey]}
                        size="sm"
                        variant="numeric"
                        css={styles.heightField}
                        onValueChange={(details) => {
                            const picked = heights.items.find((item) => item.value === details.value[0]);
                            if (picked === undefined || picked.value === heightKey) return;
                            const px = picked.px;
                            queueMicrotask(() => ask(variant("height", px === undefined ? none : some(BigInt(px)))));
                        }}
                    >
                        <ChakraSelect.HiddenSelect />
                        <ChakraSelect.Control>
                            <ChakraSelect.Trigger aria-label={m.height()} data-inspector-height="">
                                <ChakraSelect.ValueText />
                            </ChakraSelect.Trigger>
                            <ChakraSelect.IndicatorGroup>
                                <ChakraSelect.Indicator><FontAwesomeIcon icon={faChevronDown} /></ChakraSelect.Indicator>
                            </ChakraSelect.IndicatorGroup>
                        </ChakraSelect.Control>
                        <Portal>
                            <ChakraSelect.Positioner>
                                <ChakraSelect.Content>
                                    {heights.items.map((item) => (
                                        <ChakraSelect.Item key={item.value} item={item}>
                                            {item.label}
                                            <ChakraSelect.ItemIndicator><FontAwesomeIcon icon={faCheck} /></ChakraSelect.ItemIndicator>
                                        </ChakraSelect.Item>
                                    ))}
                                </ChakraSelect.Content>
                            </ChakraSelect.Positioner>
                        </Portal>
                    </ChakraSelect.Root>
                </Box>
                <Box css={styles.field}>
                    <Box as="span" css={styles.fieldLabel}>{m.align()}</Box>
                    <Box css={seg.root} role="group" aria-label={m.align()}>
                        {ALIGNS.map(({ align, icon, name }) => (
                            <chakra.button key={align} type="button" css={seg.item} data-state={aligned === align ? "on" : "off"}
                                aria-pressed={aligned === align} aria-label={name(m)} title={name(m)}
                                onClick={() => ask(variant("align", variant(align, null)))}>
                                <FontAwesomeIcon icon={icon} />
                            </chakra.button>
                        ))}
                    </Box>
                </Box>
            </Box>
            <Box css={styles.footer} data-inspector="footer">
                <FontAwesomeIcon icon={faLock} />
                {m.published()}
            </Box>
        </Box>
    );
});
