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
 * Retry; the canvas's and the frame's accessible names; and its editing's
 * (#1388): the changes waiting on Save, what a Save's notice counts a kind's
 * rows in, a details record's banners, why a connection's draft doesn't snap
 * or a Delete is refused, and each gesture's step in the history; and its
 * library's (#1389): the pane and its tabs, their cards' lines and nouns, what
 * an empty tab and a tab the rail empties say, the Index's search, its zones'
 * and the zone in view, the Layers tab's controls, and a followed source's
 * failed narrowing. A host translates the Schematic where it translates its
 * formatters.
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
    /** The changes waiting on Save, every record's — `3 pending` (#1388). */
    pending: (p: SchematicCount) => string;
    /**
     * What a Save's notice counts a kind's rows in, a row or several (`RecordSliceSaveNotice`): `name` is the
     * kind's, as running text writes it — `rack`, `racks`.
     */
    kindNoun: (p: { name: string; plural: boolean }) => string;
    /** A kind's details' session, as its banners are titled — `Rack details`. */
    detailsName: (p: { name: string }) => string;
    /**
     * Why a connection's draft doesn't snap: its kind's end — `start` a link's from or a net's sources, `end` a
     * link's to or a net's destinations — holds no item of the target's kind: `Fibre run can't end at PDU-A`.
     */
    endRefused: (p: { kind: string; end: "start" | "end"; item: string }) => string;
    /** Why a Delete was refused: a link or a net bound read only names an item it would delete. */
    deleteRefused: (p: { item: string; kind: string; key: string }) => string;
    /** A gesture's label in the history: what it did, and to how many. */
    step: (p: { step: SchematicStep; name: string; n: number }) => string;
    /** The library pane's name, on its rail and its head (#1389). */
    libraryPane: () => string;
    /** A tab of the library's own, by its name: `Templates`, `Backlog`, `Index`, `Layers`. */
    libraryTab: (p: { tab: Exclude<SchematicLibraryTabWord, "tab"> }) => string;
    /** What a tab counts its cards as, one or several: a template, an item, a zone, a layer; an author's tab's a card. */
    libraryNoun: (p: { tab: SchematicLibraryTabWord; n: number }) => string;
    /** What an empty tab says: `No templates`; an author's tab, `Nothing in <name>`. */
    libraryEmpty: (p: { tab: SchematicLibraryTabWord; name: string }) => string;
    /** The line under an empty tab's words. */
    libraryEmptyHint: (p: { tab: SchematicLibraryTabWord; name: string }) => string;
    /** What a tab the rail leaves no card says: `No templates match the filters`; `name` is an author's tab's, as running text writes it. */
    libraryNarrowed: (p: { tab: SchematicLibraryTabWord; name: string }) => string;
    /** The line under it. */
    libraryNarrowedHint: (p: { tab: SchematicLibraryTabWord; name: string }) => string;
    /** The cards' grouping's name. */
    libraryGroupBy: () => string;
    /** A template's group: its kind's name, then the template's own group — `Rack · Half racks`. */
    templateGroup: (p: { kind: string; group: string | undefined }) => string;
    /** A Backlog card's line: its kind's name, then the item's second line — `Rack · 48U · 12 kW`. */
    backlogLine: (p: { kind: string; sublabel: string | undefined }) => string;
    /** The Index's search: its placeholder and its accessible name. */
    indexSearch: () => string;
    /** What the Index says when its search keeps no item: `No items match "A9"`. */
    indexNoMatch: (p: { query: string }) => string;
    /** A zone's chevron: what a press on it does. */
    indexToggle: (p: { zone: string; open: boolean }) => string;
    /** A zone's count of the items it holds — `4 items` — as a reader hears it. */
    indexCount: (p: SchematicCount) => string;
    /** The Layers tab's Show all: every layer shown, the isolation ended. */
    layersShowAll: () => string;
    /** A layer's Show or Hide. */
    layerShow: (p: { layer: string; shown: boolean }) => string;
    /** A layer's Isolate: alone, or ending it. */
    layerIsolate: (p: { layer: string; isolated: boolean }) => string;
    /** A layer's Lock. */
    layerLock: (p: { layer: string; locked: boolean }) => string;
    /** A layer's count of the entities on it — `12 entities` — as a reader hears it. */
    layerCount: (p: SchematicCount) => string;
    /** The banner over a source the library follows whose narrowing could not be read — `Rack templates results unavailable`. */
    sourceUnavailable: (p: { name: string }) => string;
    /** A followed source's results moved while they were read. */
    sourceChanged: (p: { name: string }) => string;
    /** A followed source's results could not be read. */
    sourceFailed: (p: { name: string }) => string;
}

/** A tab of the library, as its words name it: its own, or an author's (`tab`). */
export type SchematicLibraryTabWord = "templates" | "backlog" | "index" | "layers" | "tab";

/** A gesture, as the history labels its step. */
export type SchematicStep = "move" | "connect" | "net" | "retarget" | "extend" | "delete";

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** Words as a sentence starts them. */
const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Each of the library's own tabs' name. */
const TAB_NAMES: { readonly [T in Exclude<SchematicLibraryTabWord, "tab">]: string } = {
    templates: "Templates", backlog: "Backlog", index: "Index", layers: "Layers",
};

/** What each tab counts its cards as: one, several. */
const TAB_NOUNS: { readonly [T in SchematicLibraryTabWord]: readonly [string, string] } = {
    templates: ["template", "templates"], backlog: ["item", "items"], index: ["zone", "zones"], layers: ["layer", "layers"], tab: ["card", "cards"],
};

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
    pending: ({ count }) => `${count} pending`,
    kindNoun: ({ name, plural }) => (plural ? `${name}s` : name),
    detailsName: ({ name }) => `${name} details`,
    endRefused: ({ kind, end, item }) => `${kind} can't ${end === "start" ? "start" : "end"} at ${item}`,
    deleteRefused: ({ item, kind, key }) => `${item} isn't deleted: ${kind} ${key} names it, and is read only`,
    step: ({ step, name, n }) => ({
        move: `Move ${n} ${plural(n, "item", "items")}`,
        connect: `Connect a ${name}`,
        net: `Grow a ${name}`,
        retarget: `Retarget a ${name}`,
        extend: `Extend a ${name}`,
        delete: `Delete ${n} ${plural(n, "row", "rows")}`,
    })[step],
    libraryPane: () => "Library",
    libraryTab: ({ tab }) => TAB_NAMES[tab],
    libraryNoun: ({ tab, n }) => plural(n, TAB_NOUNS[tab][0], TAB_NOUNS[tab][1]),
    libraryEmpty: ({ tab, name }) => ({
        templates: "No templates", backlog: "Nothing in the backlog", index: "No zones", layers: "No layers", tab: `Nothing in ${name}`,
    })[tab],
    libraryEmptyHint: ({ tab }) => ({
        templates: "No template to drag onto the canvas.",
        backlog: "Every item has a place on the drawing.",
        index: "The drawing holds no zone.",
        layers: "The drawing has no layer.",
        tab: "No card to drag onto the canvas.",
    })[tab],
    libraryNarrowed: ({ tab, name }) => `No ${tab === "tab" ? name : TAB_NOUNS[tab][1]} match the filters`,
    libraryNarrowedHint: ({ tab, name }) => `Change or clear the filters to see more ${tab === "tab" ? name : TAB_NOUNS[tab][1]}.`,
    libraryGroupBy: () => "Group",
    templateGroup: ({ kind, group }) => (group === undefined ? kind : `${kind} · ${group}`),
    backlogLine: ({ kind, sublabel }) => (sublabel === undefined ? kind : `${kind} · ${sublabel}`),
    indexSearch: () => "Search items",
    indexNoMatch: ({ query }) => `No items match "${query}"`,
    indexToggle: ({ zone, open }) => `${open ? "Close" : "Open"} ${zone}`,
    indexCount: ({ n, count }) => `${count} ${plural(n, "item", "items")}`,
    layersShowAll: () => "Show all",
    layerShow: ({ layer, shown }) => `${shown ? "Hide" : "Show"} ${layer}`,
    layerIsolate: ({ layer, isolated }) => (isolated ? `Show every layer, not ${layer} alone` : `Isolate ${layer}`),
    layerLock: ({ layer, locked }) => `${locked ? "Unlock" : "Lock"} ${layer}`,
    layerCount: ({ n, count }) => `${count} ${plural(n, "entity", "entities")}`,
    sourceUnavailable: ({ name }) => `${capital(name)} results unavailable`,
    sourceChanged: ({ name }) => `${capital(name)} results changed; retry the narrowing.`,
    sourceFailed: ({ name }) => `Could not load ${name} results`,
};

/** The words a Schematic speaks: its message table, and its locale's formatters. */
export interface SchematicWords extends Formatters {
    /** The message table in effect. */
    readonly m: SchematicMessages;
}
