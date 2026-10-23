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
 * Retry; what Find marks an item it found by and what the footer says of one
 * the canvas doesn't show as itself (#1404); the canvas's and the frame's
 * accessible names; and its editing's
 * (#1388): the changes waiting on Save, what a Save's notice counts a kind's
 * rows in, a details record's banners, why a connection's draft doesn't snap
 * or a Delete is refused, and each gesture's step in the history; and its
 * library's (#1389): the pane and its tabs, their cards' lines and nouns, what
 * an empty tab and a tab the rail empties say, the Index's search, its zones'
 * and the zone in view, the Layers tab's controls, and a followed source's
 * failed narrowing; and its drops' (#1390): where a card lands, why a drop is
 * refused, and a drop's step in the history; and its inspector's (#1391): the
 * pane and its tabs, the heads of Details' sections and its own fields, where
 * an entity stands, a gesture's button and its step, a record's last save and
 * who made it, why a net's side stays, and each issue's words. A host
 * translates the Schematic where it translates its formatters.
 *
 * @packageDocumentation
 */

import type { Formatters } from "@elaraai/east-ui-components";
import type { SchematicIssueWord } from "./issues.js";
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
    /**
     * What keeps an item Find found off the canvas, at its line's end (#1404): the rail's filters hide it, or dim it
     * as context; its layer is hidden; it has no position.
     */
    findMark: (p: { mark: "hidden" | "dimmed" | "layer" | "unplaced" }) => string;
    /** What the footer says of an item a Find's pick landed on that the canvas doesn't show it as itself — `A07 is hidden by the filters`. */
    foundOff: (p: { item: string; mark: "hidden" | "dimmed" | "layer" | "unplaced" }) => string;
    /** The footer's action beside a found item the rail's filters leave out: they clear, and the item is selected. */
    clearFilters: () => string;
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
    /**
     * Where a card dropped at a point lands, as the ghost says it and the history names its drop (#1390): the zone
     * holding the point, if one does, and the point as the drawing's scale unit measures it — `Cage A · 6.04, 2.91 m`.
     */
    dropAt: (p: { zone: string | undefined; x: string; y: string; unit: string | undefined }) => string;
    /** What a card dropped on an entity lands on, as the ghost says it — `onto A03`; `name` is the entity's. */
    dropOnto: (p: { name: string }) => string;
    /** A link, as a drop's words name it: by its ends' items — `A01 → ODF-1`. */
    linkEnds: (p: { from: string; to: string }) => string;
    /** The entities of a kind a card's ⏎ drops on, several of them — `3 racks`; `name` is the kind's, as running text writes it. */
    dropMany: (p: SchematicCount & { name: string }) => string;
    /** Why a drop is refused where the drag rests: red under the ghost, and for a card's ⏎ in the footer. */
    dropRefused: (p: SchematicDropRefusalWord) => string;
    /** Where a drag that lands nowhere rests, as a screen reader hears it. */
    dropCanvas: () => string;
    /**
     * A drop's step in the history, and its Save's — `Drop 42U rack · 8 kW at Cage A · 6.04, 2.91 m`, `Drop Uplink ·
     * 100G on A01 → ODF-1`: `where` is where it lands, and `onto` whether that is an entity.
     */
    dropLabel: (p: { card: string; where: string; onto: boolean }) => string;
    /** The inspector pane's name, on its rail and its head (#1391). */
    inspectorPane: () => string;
    /** The inspector's tabs: `Details`, `Issues`. */
    inspectorTab: (p: { tab: "details" | "issues" }) => string;
    /** What nothing selected shows, in its head's eyebrow: the drawing. */
    inspectorDrawing: () => string;
    /** A section of Details, under its head — `Rack`, `Rack details`, `Position`, `Joined to`, `Ends`, `Sides`, `Member`: `name` is the kind's. */
    inspectorSection: (p: { section: SchematicInspectorSection; name: string }) => string;
    /** A field of Details' own — an item's `x` and `y`, a link's ends, a net's sides. */
    inspectorField: (p: { field: "x" | "y" | "from" | "to" | "sources" | "destinations" }) => string;
    /** A gesture's button: Delete, Unplace, Remove. */
    inspectorAction: (p: { action: "delete" | "unplace" | "remove" }) => string;
    /** An item's place, under its name: the zone holding it, if one does, and its centre — `Cage A · 9.60, 2.90 m`. */
    inspectorAt: (p: { zone: string | undefined; x: string; y: string; unit: string | undefined }) => string;
    /** A zone's size, under its name — `19.60 × 4.60 m`. */
    inspectorSize: (p: { width: string; height: string; unit: string | undefined }) => string;
    /** A net's sides, under its name — `2 sources → 3 destinations`. */
    inspectorSides: (p: { sources: SchematicCount; destinations: SchematicCount }) => string;
    /** Which side a net's leg is on, under its name — `Source leg`, `Destination leg`. */
    inspectorLeg: (p: { end: "source" | "destination" }) => string;
    /** Several selected, in their head — `4 selected`. */
    inspectorSeveral: (p: SchematicCount) => string;
    /** What the drawing's Details counts, under a count — `Zones`, `Links`, `Nets`, one or several. */
    inspectorCount: (p: { what: "zones" | "links" | "nets"; n: number }) => string;
    /** How many of a kind are selected — `3 racks`: `name` is the kind's, as running text writes it. */
    inspectorKindCount: (p: SchematicCount & { name: string }) => string;
    /** A row whose read is in flight. */
    inspectorReading: () => string;
    /** A row the record holds none of: an entity whose row is gone. */
    inspectorNoRow: () => string;
    /** An item whose details record holds no row of it. */
    inspectorNoDetails: (p: { name: string }) => string;
    /** What a link or a net Details lists an item joined to is, under its name: its kind, and for a net the item's side. */
    inspectorJoin: (p: { kind: string; end: "source" | "destination" | undefined }) => string;
    /** A record's last save in the drawing's Details — `Rack saved 14:02 by alice`: `when` is its time today, else its date and time. */
    inspectorSaved: (p: { name: string; when: string; by: string }) => string;
    /** An edit's step in the history — `Edit A03`, `Unplace A06`, `Delete A03`, `Remove A05 from PDU-B · A side`. */
    inspectorStep: (p: { edit: "edit" | "unplace" | "delete" | "remove"; name: string; from?: string }) => string;
    /** Why a net's side can't be emptied in its tags: a Delete takes the net. */
    inspectorSideEmpty: (p: { side: "sources" | "destinations" }) => string;
    /** What an issue names, in its row — `Rack · A03`; a layer's when `kind` is `undefined`. */
    issueWhere: (p: { kind: string | undefined; name: string }) => string;
    /** What an issue says. */
    issueText: (p: SchematicIssueWord) => string;
    /** What Issues says with none: its head and the line under it. */
    inspectorNoIssues: (p: { part: "title" | "hint" }) => string;
}

/** A section of the inspector's Details, as its head names it. */
export type SchematicInspectorSection = "fields" | "details" | "position" | "joins" | "ends" | "sides" | "member";

/**
 * Why a drop is refused, as its words say it (#1390): outside the drawing; no
 * entity of the card's kind under the drag; its kind read only; or its kind's
 * session taking no edit now — `kind` is the kind's name, as running text
 * writes it.
 */
export type SchematicDropRefusalWord =
    | { readonly why: "outside" }
    | { readonly why: "onto" | "readOnly" | "busy"; readonly kind: string };

/** A tab of the library, as its words name it: its own, or an author's (`tab`). */
export type SchematicLibraryTabWord = "templates" | "backlog" | "index" | "layers" | "tab";

/** A gesture, as the history labels its step. */
export type SchematicStep = "move" | "connect" | "net" | "retarget" | "extend" | "delete";

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** Words as a sentence starts them. */
const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** The article a noun takes, by the sound English spelling gives its first letter. */
const article = (noun: string): string => (/^[aeiou]/i.test(noun) ? "an" : "a");

/** What an issue says, in English. */
function issueText(p: SchematicIssueWord): string {
    switch (p.issue) {
        case "missing": return `Names ${p.kind} ${p.key}, which no ${p.kind.toLowerCase()} holds`;
        case "outside": return "Outside the drawing";
        case "geometry": return "Its shape reaches past its box";
        case "colour": return `Its colour, ${p.colour}, is no theme colour: it draws its tone`;
        case "ready":
        case "save": return p.field === undefined ? p.message : `${p.field}: ${p.message}`;
    }
}

/** Each section's head. */
function inspectorSection({ section, name }: { section: SchematicInspectorSection; name: string }): string {
    switch (section) {
        case "fields": return name;
        case "details": return `${name} details`;
        case "position": return "Position";
        case "joins": return "Joined to";
        case "ends": return "Ends";
        case "sides": return "Sides";
        case "member": return "Member";
    }
}

/** Why a drop is refused, in English. */
function dropRefused(p: SchematicDropRefusalWord): string {
    switch (p.why) {
        case "outside": return "Outside the drawing";
        case "onto": return `Drop onto ${article(p.kind)} ${p.kind}`;
        case "readOnly": return `${capital(p.kind)}s are read only`;
        case "busy": return `${capital(p.kind)}s take no edit now`;
    }
}

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
    findNoMatches: () => "No item's key matches. Keys are case-sensitive.",
    findMark: ({ mark }) => ({ hidden: "hidden", dimmed: "dimmed", layer: "on a hidden layer", unplaced: "no position" })[mark],
    foundOff: ({ item, mark }) => ({
        hidden: `${item} is hidden by the filters`,
        dimmed: `${item} is dimmed by the filters`,
        layer: `${item} is on a hidden layer`,
        unplaced: `${item} has no position: it is in the Backlog`,
    })[mark],
    clearFilters: () => "Clear filters",
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
    dropAt: ({ zone, x, y, unit }) => `${zone === undefined ? "" : `${zone} · `}${x}, ${y}${unit === undefined ? "" : ` ${unit}`}`,
    dropOnto: ({ name }) => `onto ${name}`,
    linkEnds: ({ from, to }) => `${from} → ${to}`,
    dropMany: ({ n, count, name }) => `${count} ${plural(n, name, `${name}s`)}`,
    dropRefused,
    dropCanvas: () => "the canvas",
    dropLabel: ({ card, where, onto }) => `Drop ${card} ${onto ? "on" : "at"} ${where}`,
    inspectorPane: () => "Inspector",
    inspectorTab: ({ tab }) => (tab === "details" ? "Details" : "Issues"),
    inspectorDrawing: () => "Drawing",
    inspectorSection,
    inspectorField: ({ field }) => ({ x: "x", y: "y", from: "From", to: "To", sources: "Sources", destinations: "Destinations" })[field],
    inspectorAction: ({ action }) => ({ delete: "Delete", unplace: "Unplace", remove: "Remove" })[action],
    inspectorAt: ({ zone, x, y, unit }) => `${zone === undefined ? "" : `${zone} · `}${x}, ${y}${unit === undefined ? "" : ` ${unit}`}`,
    inspectorSize: ({ width, height, unit }) => `${width} × ${height}${unit === undefined ? "" : ` ${unit}`}`,
    inspectorSides: ({ sources, destinations }) =>
        `${sources.count} ${plural(sources.n, "source", "sources")} → ${destinations.count} ${plural(destinations.n, "destination", "destinations")}`,
    inspectorLeg: ({ end }) => (end === "source" ? "Source leg" : "Destination leg"),
    inspectorSeveral: ({ count }) => `${count} selected`,
    inspectorCount: ({ what, n }) => ({ zones: plural(n, "Zone", "Zones"), links: plural(n, "Link", "Links"), nets: plural(n, "Net", "Nets") })[what],
    inspectorKindCount: ({ n, count, name }) => `${count} ${plural(n, name, `${name}s`)}`,
    inspectorReading: () => "Reading…",
    inspectorNoRow: () => "Its record holds no row of it",
    inspectorNoDetails: ({ name }) => `No ${name.toLowerCase()} details`,
    inspectorJoin: ({ kind, end }) => (end === undefined ? kind : `${kind} · ${end === "source" ? "source" : "destination"}`),
    inspectorSaved: ({ name, when, by }) => `${name} saved ${when} by ${by}`,
    inspectorStep: ({ edit, name, from }) => ({
        edit: `Edit ${name}`, unplace: `Unplace ${name}`, delete: `Delete ${name}`, remove: `Remove ${name} from ${from ?? ""}`,
    })[edit],
    inspectorSideEmpty: ({ side }) => `A net keeps one ${side === "sources" ? "source" : "destination"} at least: Delete takes the net`,
    issueWhere: ({ kind, name }) => `${kind ?? "Layer"} · ${name}`,
    issueText,
    inspectorNoIssues: ({ part }) => (part === "title" ? "No issues" : "Every link names its items, and every shape and colour holds."),
};

/** The words a Schematic speaks: its message table, and its locale's formatters. */
export interface SchematicWords extends Formatters {
    /** The message table in effect. */
    readonly m: SchematicMessages;
}
