/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The SnapGrid editing canvas's toolbar (#995, #1229): the value's start
 * items, the host's start items, the grid chip and the time the source last
 * confirmed an Apply; then the width readout, the zoom, the history item, the
 * design widths and the value's and the host's end items — on a phone, the
 * host's items and the history alone. A row short of room folds them on one
 * ladder: the grid chip, the readout and the saved time go, the widths fold to
 * their icons, then the zoom folds into one View chip as the widths hide — its
 * menu holding Zoom out, the zoom and Zoom in, then the widths as a choice of
 * one — and last of the canvas's own steps the value's start items go; a
 * host's own items fold from {@link SNAP_GRID_HOST_RANK}, and the history
 * item last. The canvas (`./editor.tsx`) holds the design width and the zoom.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { Box, chakra, Menu as ChakraMenu, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { faCheck, faEye, faMinus, faPlus } from "@fortawesome/free-solid-svg-icons";
import { some, type ValueTypeOf } from "@elaraai/east";
import type { SnapGrid } from "@elaraai/east-ui/internal";
import { EastChakraComponent } from "../../component";
import { getSomeorUndefined } from "../../utils";
import { parseCssSize } from "../../style/parse-size.js";
import type { ToolbarItem } from "../../toolbar/index.js";
import { ChipMenu } from "../../toolbar/chip-menu.js";
import type { SnapGridWords } from "./messages.js";
import type { SnapGridEditorValue } from "./index.js";
import type { SnapGridStyles } from "./editor-cells.js";

/** The design width and zoom a host holds — the bound `view`'s value. */
export type ViewState = ValueTypeOf<typeof SnapGrid.Types.ViewState>;

/** The zoom's range and step. */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.1;

/**
 * The fold order of the canvas's own toolbar items (#995, #1229), lowest
 * first: the grid chip, then the width readout, then the saved time, then the
 * widths to their icons; then the zoom into the View chip with the widths
 * hidden into its menu, one bundle; then the value's start items. A host's own
 * items fold after them, from {@link SNAP_GRID_HOST_RANK}, and the history
 * item after all, at its own rank.
 */
const RANK_GRID = 10;
const RANK_READOUT = 20;
const RANK_SAVED = 30;
const RANK_WIDTHS = 40;
const RANK_VIEW = 50;
const RANK_START = 60;

/** The first rank a host's own toolbar items fold at — after every step of the canvas's own, before the history item's. */
export const SNAP_GRID_HOST_RANK = 70;

/** The zoom's fold into the View chip and the widths' into its menu: one bundle, applied together. */
const VIEW_BUNDLE = "snap-grid.view";

/** A row of toolbar items, as a host gives them: an item, or nothing where it has none. */
type ToolbarItems = ReadonlyArray<ToolbarItem | false | null | undefined>;

/** What the canvas's toolbar is drawn from. */
export interface CanvasToolbarOptions {
    /** The canvas's value: its start and end items, and its design widths. */
    readonly value: SnapGridEditorValue;
    /** The canvas's storage key prefix. */
    readonly storageKey: string;
    /** The canvas's words. */
    readonly words: SnapGridWords;
    /** The canvas's slot styles. */
    readonly styles: SnapGridStyles;
    /** Whether the canvas draws its phone form. */
    readonly phone: boolean;
    /** The design width and the zoom, as the host or the canvas holds them. */
    readonly view: ViewState;
    /** Sets them. */
    readonly setView: (next: ViewState) => void;
    /** The design width the grid lays out at, as CSS. */
    readonly width: string | undefined;
    /** That width in whole px, where it is one. */
    readonly widthPx: number | undefined;
    /** The zoom. */
    readonly zoom: number;
    /** When the source last confirmed an Apply. */
    readonly savedAt: Date | undefined;
    /** The history item. */
    readonly history: ToolbarItem;
    /** The host's own items, as React: before the canvas's, and after them. */
    readonly toolbar: { start?: ToolbarItems | undefined; end?: ToolbarItems | undefined } | undefined;
    /** Items a host adds before the history item. */
    readonly toolbarItems: ToolbarItems | undefined;
}

/**
 * The canvas's toolbar items, in their order — see the module docs.
 *
 * @param o - What the toolbar is drawn from
 * @returns The items
 */
export function useCanvasToolbar(o: CanvasToolbarOptions): ToolbarItems {
    const { value, storageKey, words, styles, phone, view, setView, width, widthPx, zoom, savedAt, history, toolbar, toolbarItems } = o;
    const m = words.m;
    // The toolbar's zoom and design widths are the shared stepper and seg strip.
    const stepperRecipe = useSlotRecipe({ key: "stepper" });
    const stepper = useMemo(() => stepperRecipe({ tone: "neutral", size: "sm" }) as SnapGridStyles, [stepperRecipe]);
    const segRecipe = useSlotRecipe({ key: "seg" });
    const seg = useMemo(() => segRecipe() as SnapGridStyles, [segRecipe]);
    // The View chip's menu is the theme's: its items' leading icons and its group labels.
    const menuRecipe = useSlotRecipe({ key: "menu" });
    const menu = useMemo(() => menuRecipe() as SnapGridStyles, [menuRecipe]);
    const zoomTo = (to: number) => setView({ width: view.width, zoom: some(Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, to)) * 10) / 10) });

    const zoomControl = (
        <Box css={stepper.root} role="group" aria-label={m.zoomLabel()} data-snap-grid-zoom="">
            <chakra.button type="button" css={stepper.button} aria-label={m.zoomOut()} title={m.zoomOut()}
                disabled={zoom <= ZOOM_MIN} onClick={() => zoomTo(zoom - ZOOM_STEP)}>
                <FontAwesomeIcon icon={faMinus} />
            </chakra.button>
            <Box as="output" css={stepper.value}>{words.percent(zoom)}</Box>
            <chakra.button type="button" css={stepper.button} aria-label={m.zoomIn()} title={m.zoomIn()}
                disabled={zoom >= ZOOM_MAX} onClick={() => zoomTo(zoom + ZOOM_STEP)}>
                <FontAwesomeIcon icon={faPlus} />
            </chakra.button>
        </Box>
    );
    const widthsGroup = (iconsOnly: boolean) => (
        <Box css={seg.root} role="group" aria-label={m.widthsLabel()} data-snap-grid-widths="">
            {value.widths.map((preset, i) => {
                const icon = getSomeorUndefined(preset.icon);
                const pressed = parseCssSize(preset.width) === width;
                return (
                    <chakra.button key={i} type="button" css={seg.item} data-state={pressed ? "on" : "off"} aria-pressed={pressed}
                        {...(iconsOnly ? { "aria-label": preset.label, title: preset.label } : {})}
                        onClick={() => setView({ width: some(preset.width), zoom: view.zoom })}>
                        {/* The strip's icon: before the words, or alone — at the segment's middle by the strip's rule. */}
                        {icon !== undefined && <FontAwesomeIcon icon={["fas", icon as IconName]} aria-hidden {...(iconsOnly ? {} : { "data-seg-icon": "" })} />}
                        {(!iconsOnly || icon === undefined) && <span>{preset.label}</span>}
                    </chakra.button>
                );
            })}
        </Box>
    );
    // The zoom and the widths folded into one chip (#1229): Zoom out, the zoom
    // and Zoom in — which leave the menu open — then the widths as a choice of one.
    const openWidth = String(value.widths.findIndex((preset) => parseCssSize(preset.width) === width));
    const viewChip = (
        <ChipMenu label={m.viewLabel()} icon={faEye} caret data="data-snap-grid-view" onSelect={(picked) => {
            if (picked === "zoom-out") zoomTo(zoom - ZOOM_STEP);
            else if (picked === "zoom-in") zoomTo(zoom + ZOOM_STEP);
        }}>
            <ChakraMenu.Item value="zoom-out" closeOnSelect={false} disabled={zoom <= ZOOM_MIN}>
                <Box as="span" css={menu.itemIndicator}><FontAwesomeIcon icon={faMinus} /></Box>
                {m.zoomOut()}
            </ChakraMenu.Item>
            <Box css={menu.itemGroupLabel} aria-live="polite" data-snap-grid-view-zoom="">{words.percent(zoom)}</Box>
            <ChakraMenu.Item value="zoom-in" closeOnSelect={false} disabled={zoom >= ZOOM_MAX}>
                <Box as="span" css={menu.itemIndicator}><FontAwesomeIcon icon={faPlus} /></Box>
                {m.zoomIn()}
            </ChakraMenu.Item>
            {value.widths.length > 0 && (
                <>
                    <ChakraMenu.Separator />
                    <Box css={menu.itemGroupLabel}>{m.widthsLabel()}</Box>
                    <ChakraMenu.RadioItemGroup value={openWidth} onValueChange={(d) => {
                        const preset = value.widths[Number(d.value)];
                        if (preset !== undefined) setView({ width: some(preset.width), zoom: view.zoom });
                    }}>
                        {value.widths.map((preset, i) => (
                            <ChakraMenu.RadioItem key={i} value={String(i)}>
                                <Box as="span" css={menu.itemIndicator}>{String(i) === openWidth && <FontAwesomeIcon icon={faCheck} />}</Box>
                                {preset.label}
                            </ChakraMenu.RadioItem>
                        ))}
                    </ChakraMenu.RadioItemGroup>
                </>
            )}
        </ChipMenu>
    );
    return phone ? [
        // A phone's: no grid chip, no zoom, no widths, the canvas being drawn at the frame's width (D3); the history its second row's.
        ...(toolbar?.start ?? []),
        ...(toolbarItems ?? []),
        history,
        ...(toolbar?.end ?? []),
    ] : [
        // The value's start items go last of the canvas's own steps (#1229).
        ...value.toolbar.start.map((node, i): ToolbarItem => ({
            key: `start-${i}`, side: "start", rank: RANK_START,
            forms: [<EastChakraComponent value={node} storageKey={`${storageKey}.toolbar.start.${i}`} />, null],
        })),
        ...(toolbar?.start ?? []),
        { key: "grid", side: "start", forms: [<Box as="span" css={styles.chip} data-snap-grid-chip="">{m.gridChip()}</Box>, null], rank: RANK_GRID },
        savedAt !== undefined && {
            key: "saved", side: "start", rank: RANK_SAVED, version: savedAt.getTime(),
            forms: [<Box as="span" css={styles.saved} data-snap-grid-saved="">{m.saved({ time: words.time(savedAt) })}</Box>, null],
        },
        widthPx !== undefined && {
            key: "readout", side: "end", rank: RANK_READOUT, version: widthPx,
            forms: [<Box as="span" css={styles.readout} data-snap-grid-readout="">{m.widthReadout({ px: words.bare(widthPx) })}</Box>, null],
        },
        { key: "zoom", side: "end", forms: [zoomControl, viewChip], rank: RANK_VIEW, bundle: VIEW_BUNDLE, version: zoom },
        { key: "rule", side: "end", forms: [<Box as="span" css={styles.divider} aria-hidden />] },
        ...(toolbarItems ?? []),
        history,
        value.widths.length > 0 && {
            key: "widths", side: "end", forms: [widthsGroup(false), widthsGroup(true), null],
            rank: [RANK_WIDTHS, RANK_VIEW], bundle: [undefined, VIEW_BUNDLE], version: width,
        },
        ...value.toolbar.end.map((node, i): ToolbarItem => ({
            key: `end-${i}`, side: "end",
            forms: [<EastChakraComponent value={node} storageKey={`${storageKey}.toolbar.end.${i}`} />],
        })),
        ...(toolbar?.end ?? []),
    ];
}
