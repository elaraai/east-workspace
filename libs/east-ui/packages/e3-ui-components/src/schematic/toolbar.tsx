/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's toolbar items (#1387, `Schematic Builder Spec.md` §6.1,
 * SC24) — every control the Schematic has, as items of its frame's one
 * toolbar, in this order:
 *
 * 1. **the rail** over its `Slice.bindRecords` — each source's fields, the
 *    presets over them — and, at the row's end, its summary;
 * 2. **the tools**, one strip: Select, Zoom box, Marquee, Connect (while a link
 *    kind is editable) and Move (while an item kind is editable); beside it,
 *    while several link kinds are editable, Connect's menu of the kind it
 *    draws;
 * 3. **Zoom** − / + and **Fit**;
 * 4. **Find**, over the item kinds' keys (`find.ts`);
 * 5. **the steps** to the previous and the next item, while something is
 *    selected;
 * 6. **the history item**, last, where the Schematic edits (#1388).
 *
 * They fold on one ladder: the rail first, in its own order (#952) — its
 * fields into their chips, then one chip, then its icon — then its summary
 * (`SUMMARY_RANK`); then the Schematic's own: the tools' strip drops its words
 * for its icons, Find's box folds to its icon, the strip folds into one chip
 * naming the tool, whose menu holds every tool — Connect once per link kind
 * it may draw — and last the tools, the zoom, Fit and the steps fold into
 * Find's popover, the View, one move: a phone's row holds the rail's icon,
 * the View and the history item (the Plan's View precedent). The history
 * item's step (`DEFAULT_RANK`) comes after all of them. Nothing wraps,
 * scrolls or goes to a second row, and on a coarse pointer every control is a
 * 44px target by its halo, the row's height its own.
 *
 * @packageDocumentation
 */

import { Box, chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faArrowPointer, faChevronLeft, faChevronRight, faExpand, faLink, faMagnifyingGlassPlus, faMinus, faObjectGroup, faPlus, faUpDownLeftRight,
    type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordSlicesChromeType } from "@elaraai/east-ui/internal";
import { HOST_RANK, useRecordSlicesToolbarItems } from "@elaraai/east-ui-components/internal";
import { useKeySearchToolbarItem, type KeySearchSource, type ToolbarItem } from "@elaraai/east-ui-components";
import { Seg, SegMenu } from "../shared/schedule/segments.js";
import type { SchematicZoomRange } from "./canvas/view.js";
import type { SchematicWords } from "./messages.js";
import type { SchematicTool, SchematicToolsState } from "./tools.js";

type Styles = Record<string, SystemStyleObject>;

/**
 * The Schematic's own fold ranks, after every step of the slice rail's
 * (#952): the tools' strip drops its words, Find folds to its icon, the strip
 * folds into its chip, and last the View bundle. The history item's step
 * (`DEFAULT_RANK`) comes after them.
 */
export const SCHEMATIC_RANK = {
    labels: HOST_RANK,
    seek: HOST_RANK + 1,
    chip: HOST_RANK + 2,
    view: HOST_RANK + 3,
} as const;

/** The bundle a phone's row folds the tools, the zoom, Fit, the steps and Find into: Find's View popover, one move. */
export const SCHEMATIC_VIEW = "schematic.view";

/** Each tool's icon, Font Awesome's solid. */
const TOOL_ICONS: { readonly [T in SchematicTool]: IconDefinition } = {
    select: faArrowPointer, zoom: faMagnifyingGlassPlus, marquee: faObjectGroup, connect: faLink, move: faUpDownLeftRight,
};

/** One link kind Connect may draw. */
export interface SchematicLinkChoice {
    /** Its slot. */
    readonly key: string;
    /** Its name (`Fibre run`). */
    readonly name: string;
}

/** What the Schematic's toolbar items show and drive. */
export interface SchematicToolbarProps {
    /** The `schematic` recipe's styles. */
    readonly styles: Styles;
    /** The Schematic's words. */
    readonly words: SchematicWords;
    /** The rail: one over the Schematic's `Slice.bindRecords`, its affordances and its persistence; `undefined` with no slice. */
    readonly chrome: ValueTypeOf<RecordSlicesChromeType> | undefined;
    /** What the rail's summary counts each source in, by its name. */
    readonly nouns: Readonly<Record<string, string>> | undefined;
    /** The tools the Schematic offers, in order. */
    readonly tools: readonly SchematicTool[];
    /** The tools in force: the tool held, and the link kind Connect draws. */
    readonly held: SchematicToolsState;
    /** The link kinds Connect may draw: the editable ones. */
    readonly links: readonly SchematicLinkChoice[];
    /** Picks a tool, or the link kind Connect draws. */
    readonly onTools: (next: SchematicToolsState) => void;
    /** Find's source, over the item kinds' keys. */
    readonly find: KeySearchSource;
    /** Zooms about the canvas's middle by a factor. */
    readonly onZoom: (factor: number) => void;
    /** Where the zoom stands: at Fit Zoom out takes no press, and at the zoom's limit Zoom in takes none (#1393). */
    readonly zoom: SchematicZoomRange;
    /** Fits the drawing in view. */
    readonly onFit: () => void;
    /** Whether something is selected: the steps show. */
    readonly selected: boolean;
    /** Steps the selection to the previous item, or the next. */
    readonly onStep: (delta: 1 | -1) => void;
    /** The history item, where the Schematic edits (#1388); `undefined` where it does not. */
    readonly history?: ToolbarItem | undefined;
}

/** How far a Zoom button zooms. */
const ZOOM_STEP = 1.5;

/** The tools' strip: each tool, its icon and its name — or its icon alone, named by its name. */
function ToolStrip({ props, iconsOnly, fullWidth, onPicked }: {
    props: SchematicToolbarProps; iconsOnly: boolean; fullWidth?: boolean; onPicked?: () => void;
}) {
    const { words, tools, held, onTools } = props;
    const items = tools.map((tool) => ({ key: tool, label: words.m.toolName({ tool }), hint: words.m.toolHint({ tool }), icon: TOOL_ICONS[tool] }));
    return (
        <Seg label={words.m.toolsLabel()} name="tools" scope="schematic" items={items} active={held.tool} iconsOnly={iconsOnly}
            fullWidth={fullWidth ?? false} onPick={(tool) => { onTools({ tool, link: held.link }); onPicked?.(); }} />
    );
}

/** Connect's menu: the link kind it draws — picking one holds Connect. */
function LinkMenu({ props }: { props: SchematicToolbarProps }) {
    const { words, links, held, onTools } = props;
    return (
        <SegMenu label={words.m.connectDraws()} name="link" scope="schematic" items={links.map((link) => ({ key: link.key, label: link.name }))}
            active={held.link ?? ""} onPick={(link) => onTools({ tool: "connect", link })} />
    );
}

/** The tools on a row with room: the strip, and Connect's menu while several link kinds are editable. */
function Tools({ props, iconsOnly }: { props: SchematicToolbarProps; iconsOnly: boolean }) {
    return (
        <Box css={props.styles.tools} data-schematic-tools={iconsOnly ? "icons" : ""}>
            <ToolStrip props={props} iconsOnly={iconsOnly} />
            {props.links.length > 1 && <LinkMenu props={props} />}
        </Box>
    );
}

/**
 * The tools folded into one chip naming the tool held, whose menu holds every
 * tool — Connect once per link kind it may draw, while several are editable.
 */
function ToolChip({ props }: { props: SchematicToolbarProps }) {
    const { words, tools, held, links, onTools } = props;
    const several = links.length > 1;
    // Each entry, and the tools it holds.
    const entries = tools.flatMap((tool): { key: string; label: string; next: SchematicToolsState }[] => (tool === "connect" && several
        ? links.map((link) => ({ key: `connect:${link.key}`, label: words.m.connectKind({ name: link.name }), next: { tool, link: link.key } }))
        : [{ key: tool, label: words.m.toolName({ tool }), next: { tool, link: held.link } }]));
    const active = held.tool === "connect" && several ? `connect:${held.link ?? ""}` : held.tool;
    return (
        <SegMenu label={words.m.toolsLabel()} name="tools" scope="schematic" items={entries.map(({ key, label }) => ({ key, label }))} active={active}
            onPick={(key) => {
                const entry = entries.find((e) => e.key === key);
                if (entry !== undefined) onTools(entry.next);
            }} />
    );
}

/** Zoom − / + and Fit: icon buttons, one strip — Zoom out taking no press at Fit, Zoom in none at the zoom's limit (#1393). */
function ZoomGroup({ props, fullWidth = false }: { props: SchematicToolbarProps; fullWidth?: boolean }) {
    const seg = useSlotRecipe({ key: "seg" })({ fullWidth }) as Styles;
    const { words, onZoom, onFit, zoom } = props;
    return (
        <Box css={seg.root} role="group" aria-label={words.m.zoomLabel()} data-schematic-zoom="">
            <chakra.button type="button" css={seg.item} aria-label={words.m.zoomOut()} title={words.m.zoomOut()} disabled={zoom.atFit}
                onClick={() => onZoom(1 / ZOOM_STEP)}>
                <FontAwesomeIcon icon={faMinus} aria-hidden="true" />
            </chakra.button>
            <chakra.button type="button" css={seg.item} aria-label={words.m.zoomIn()} title={words.m.zoomIn()} disabled={zoom.atLimit}
                onClick={() => onZoom(ZOOM_STEP)}>
                <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
            </chakra.button>
            <chakra.button type="button" css={seg.item} aria-label={words.m.fit()} title={words.m.fit()} onClick={onFit}>
                <FontAwesomeIcon icon={faExpand} aria-hidden="true" />
            </chakra.button>
        </Box>
    );
}

/** The steps to the previous and the next item: icon buttons, one strip. */
function StepGroup({ props, fullWidth = false }: { props: SchematicToolbarProps; fullWidth?: boolean }) {
    const seg = useSlotRecipe({ key: "seg" })({ fullWidth }) as Styles;
    const { words, onStep } = props;
    return (
        <Box css={seg.root} role="group" aria-label={words.m.stepLabel()} data-schematic-step="">
            <chakra.button type="button" css={seg.item} aria-label={words.m.previousItem()} title={words.m.previousItem()} onClick={() => onStep(-1)}>
                <FontAwesomeIcon icon={faChevronLeft} aria-hidden="true" />
            </chakra.button>
            <chakra.button type="button" css={seg.item} aria-label={words.m.nextItem()} title={words.m.nextItem()} onClick={() => onStep(1)}>
                <FontAwesomeIcon icon={faChevronRight} aria-hidden="true" />
            </chakra.button>
        </Box>
    );
}

/**
 * The View popover's controls (§6.1): on a phone's row, the tools — a pick
 * closes the popover, the canvas taking the next gesture — Connect's link
 * kinds, the zoom, Fit and the steps, over Find's box.
 */
function ViewControls({ props, close }: { props: SchematicToolbarProps; close: () => void }) {
    const { words, links, held, onTools, selected, styles } = props;
    return (
        <Box css={styles.viewControls} data-schematic-view="">
            <ToolStrip props={props} iconsOnly fullWidth onPicked={close} />
            {links.length > 1 && (
                <Seg label={words.m.connectDraws()} name="link" scope="schematic" items={links.map((link) => ({ key: link.key, label: link.name }))}
                    active={held.link ?? ""} fullWidth onPick={(link) => { onTools({ tool: "connect", link }); close(); }} />
            )}
            <ZoomGroup props={props} fullWidth />
            {selected && <StepGroup props={props} fullWidth />}
        </Box>
    );
}

/**
 * The Schematic's toolbar items, in §6.1's order and on its fold ladder (see
 * the module docs) — for its frame's one toolbar.
 *
 * @param props - What the items show and drive
 * @returns The items, a falsy entry for each the Schematic has no use for
 */
export function useSchematicToolbarItems(props: SchematicToolbarProps): ReadonlyArray<ToolbarItem | false | undefined> {
    const { words, chrome, nouns, tools, held, links, find, selected, history } = props;
    // The rail: one over every source of the Schematic's slice, each counted in its own noun.
    const rail = useRecordSlicesToolbarItems(chrome?.slice, {
        ...(nouns === undefined ? {} : { nouns }),
        ...(chrome === undefined ? {} : { affordances: chrome.affordances.map((a) => a.type) }),
        ...(chrome?.persist.type === "some" ? { persist: chrome.persist.value.type } : {}),
    });
    // Find: its box, its icon, then the View popover holding the tools, the zoom, Fit and the steps over its box.
    const seek = useKeySearchToolbarItem(find, {
        rank: SCHEMATIC_RANK.seek, label: words.m.findLabel(),
        compact: { label: words.m.viewLabel(), controls: (close) => <ViewControls props={props} close={close} /> },
    });
    // What the tools' forms show moves with the tool held and what is offered: their widths are measured again.
    const toolsVersion = `${held.tool}|${held.link ?? ""}|${tools.join(",")}|${links.map((link) => link.key).join(",")}`;
    return [
        ...rail,
        {
            key: "tools",
            rank: [SCHEMATIC_RANK.labels, SCHEMATIC_RANK.chip, SCHEMATIC_RANK.view],
            bundle: [undefined, undefined, SCHEMATIC_VIEW],
            version: toolsVersion,
            forms: [<Tools props={props} iconsOnly={false} />, <Tools props={props} iconsOnly />, <ToolChip props={props} />, null],
        },
        { key: "zoom", rank: SCHEMATIC_RANK.view, bundle: SCHEMATIC_VIEW, forms: [<ZoomGroup props={props} />, null] },
        seek !== undefined && { ...seek, rank: [SCHEMATIC_RANK.seek, SCHEMATIC_RANK.view], bundle: [undefined, SCHEMATIC_VIEW] },
        selected && { key: "step", rank: SCHEMATIC_RANK.view, bundle: SCHEMATIC_VIEW, forms: [<StepGroup props={props} />, null] },
        history,
    ];
}
