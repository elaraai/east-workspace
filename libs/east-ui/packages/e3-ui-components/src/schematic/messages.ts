/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's words (#1387, `Schematic Builder Spec.md` §6) — its frame's:
 * the toolbar's tools, Connect's menu, the zoom, Fit, Find and the steps
 * through the items, the View popover a phone's row folds them into, and what
 * the rail counts a templates list's source in; the footer's counts and each
 * record's last save; the banner over a kind whose read failed, and its
 * Retry; the canvas's and the frame's accessible names. A host translates the
 * Schematic where it translates its formatters.
 *
 * @packageDocumentation
 */

import type { Formatters } from "@elaraai/east-ui-components";
import type { SchematicTool } from "./tools.js";

/** A count as a message takes it: the number, for its plural, and the number as the locale prints it. */
export interface SchematicCount {
    /** The number. */
    readonly n: number;
    /** The number, printed in the app's locale. */
    readonly count: string;
}

/** The Schematic's message table. */
export interface SchematicMessages {
    /** The frame's accessible name, and what its skeleton is the loading of. */
    frameLabel: () => string;
    /** The canvas's accessible name: what it is, and what its keys do. */
    canvasLabel: () => string;
    /** The minimap's line under the pointer: what a press on it does. */
    minimapHint: () => string;
    /** The tools' strip's accessible name. */
    toolsLabel: () => string;
    /** A tool's name: its segment's word, and its accessible name. */
    toolName: (p: { tool: SchematicTool }) => string;
    /** A tool's line under the pointer: what it does, and the key that holds it. */
    toolHint: (p: { tool: SchematicTool }) => string;
    /** Connect's menu's accessible name: the link kind it draws. */
    connectDraws: () => string;
    /** Connect drawing a link kind, as the folded tools' menu lists it — `Connect · Fibre run`. */
    connectKind: (p: { name: string }) => string;
    /** The zoom's group's accessible name. */
    zoomLabel: () => string;
    /** Zoom out. */
    zoomOut: () => string;
    /** Zoom in. */
    zoomIn: () => string;
    /** Fit: the whole drawing in view. */
    fit: () => string;
    /** Find's placeholder, its icon's accessible name and its popover's head. */
    findLabel: () => string;
    /** What Find says when a query finds nothing. */
    findNoMatches: () => string;
    /** The View popover's name: a phone's row's tools, zoom, Fit and Find. */
    viewLabel: () => string;
    /** The steps' group's accessible name. */
    stepLabel: () => string;
    /** The step to the previous item. */
    previousItem: () => string;
    /** The step to the next item. */
    nextItem: () => string;
    /** An item kind's count in the footer: the items drawn, of its rows — `Rack 5 of 7`; one number while every row draws. */
    kindCount: (p: { name: string; drawn: SchematicCount; total: SchematicCount | undefined }) => string;
    /** The zones drawn — `5 zones`. */
    zoneCount: (p: SchematicCount) => string;
    /** The links drawn — `6 links`. */
    linkCount: (p: SchematicCount) => string;
    /** The nets drawn — `2 nets`. */
    netCount: (p: SchematicCount) => string;
    /** When a kind's record was last saved — `Rack saved 14:02`: `when` is its time today, else its date and time. */
    recordSaved: (p: { name: string; when: string }) => string;
    /** What the rail counts a templates list's source in — `rack templates`: `name` is its kind's, as running text writes it. */
    templatesNoun: (p: { name: string }) => string;
    /** The banner over a kind whose read failed — `Rack rows could not be read`; `name` is the kind's. */
    kindUnavailable: (p: { name: string }) => string;
    /** The banner over a read that failed as a whole. */
    drawingUnavailable: () => string;
    /** The banner's button, which reads again. */
    retry: () => string;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** Each tool's name. */
const TOOL_NAMES: { readonly [T in SchematicTool]: string } = {
    select: "Select", zoom: "Zoom box", marquee: "Marquee", connect: "Connect", move: "Move",
};

/** Each tool's line under the pointer. */
const TOOL_HINTS: { readonly [T in SchematicTool]: string } = {
    select: "Select — a tap selects, a drag on empty canvas pans (hold Space)",
    zoom: "Zoom box — drag a box to zoom into (hold Ctrl)",
    marquee: "Marquee — drag a box to select the items in it (Shift adds)",
    connect: "Connect — drag from an item to another to record a link",
    move: "Move — drag an item, or the selection, to move it",
};

/** The English table. */
export const schematicMessages: SchematicMessages = {
    frameLabel: () => "Schematic",
    canvasLabel: () => "Schematic canvas — arrow keys step through the items",
    minimapHint: () => "Jump to a location",
    toolsLabel: () => "Tool",
    toolName: ({ tool }) => TOOL_NAMES[tool],
    toolHint: ({ tool }) => TOOL_HINTS[tool],
    connectDraws: () => "Connect draws",
    connectKind: ({ name }) => `Connect · ${name}`,
    zoomLabel: () => "Zoom",
    zoomOut: () => "Zoom out",
    zoomIn: () => "Zoom in",
    fit: () => "Fit",
    findLabel: () => "Find item",
    findNoMatches: () => "No matching items. Search by key or label.",
    viewLabel: () => "View",
    stepLabel: () => "Step through items",
    previousItem: () => "Previous item",
    nextItem: () => "Next item",
    kindCount: ({ name, drawn, total }) => (total === undefined || total.n === drawn.n ? `${name} ${drawn.count}` : `${name} ${drawn.count} of ${total.count}`),
    zoneCount: ({ n, count }) => `${count} ${plural(n, "zone", "zones")}`,
    linkCount: ({ n, count }) => `${count} ${plural(n, "link", "links")}`,
    netCount: ({ n, count }) => `${count} ${plural(n, "net", "nets")}`,
    recordSaved: ({ name, when }) => `${name} saved ${when}`,
    templatesNoun: ({ name }) => `${name} templates`,
    kindUnavailable: ({ name }) => `${name} rows could not be read`,
    drawingUnavailable: () => "The drawing could not be read",
    retry: () => "Retry",
};

/** The words a Schematic speaks: its message table, and its locale's formatters. */
export interface SchematicWords extends Formatters {
    /** The message table in effect. */
    readonly m: SchematicMessages;
}
