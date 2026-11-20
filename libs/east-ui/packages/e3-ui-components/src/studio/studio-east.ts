/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Studio's East, compiled for its renderers (#1000) — what the builder's
 * palette, canvas, inspector and its Configure tab (#1672) and publish
 * preview, the page library, and a placement's content (#1669) show and write
 * is computed by the functions `@elaraai/e3-ui` declares, compiled once, on
 * first use; nothing here restates them.
 *
 * @packageDocumentation
 */

import { East, type TypeOf, type ValueTypeOf } from "@elaraai/east";
import {
    Studio,
    canvasTiles,
    componentFrames,
    componentNames,
    contentFramed,
    contentTile,
    contentWords,
    emptyView,
    fieldGroup,
    fieldMeasures,
    inspectorSelection,
    kindOfView,
    libraryPages,
    libraryProjects,
    libraryTemplates,
    mostUsedSource,
    nameWriteRefusal,
    paletteCards,
    palettePages,
    placedPill,
    publishRefusal,
    publishSummary,
    saveCells,
    saveFilters,
    sourceName,
    sourceNames,
    switchedView,
    textParagraphs,
    viewIcon,
    viewWords,
    visualWords,
} from "@elaraai/e3-ui/internal";

/** The JavaScript function an East function compiles to. */
type Compiled<F> = ValueTypeOf<TypeOf<F>>;

/** The Studio's compiled East — see the module docs. */
export interface StudioEast {
    /** Each listed component's palette card. */
    paletteCards: Compiled<typeof paletteCards>;
    /** A project's pages, as the palette lists them. */
    palettePages: Compiled<typeof palettePages>;
    /** Each listed component's tile on the canvas. */
    canvasTiles: Compiled<typeof canvasTiles>;
    /** The tile of what a placement holds: a listed component's, a visual's, a text block's. */
    contentTile: Compiled<typeof contentTile>;
    /** What a placement holds, in words. */
    contentWords: Compiled<typeof contentWords>;
    /** A visual, in words: its view and its source's name. */
    visualWords: Compiled<typeof visualWords>;
    /** Each listed component's name, by its key. */
    componentNames: Compiled<typeof componentNames>;
    /** Each listed component's frame, by its key. */
    componentFrames: Compiled<typeof componentFrames>;
    /** Whether a placement is drawn in a tile frame, by what it holds. */
    contentFramed: Compiled<typeof contentFramed>;
    /** A view's icon. */
    viewIcon: Compiled<typeof viewIcon>;
    /** A view, in words — "Column chart". */
    viewWords: Compiled<typeof viewWords>;
    /** A text block's paragraphs. */
    textParagraphs: Compiled<typeof textParagraphs>;
    /** Each listed source's name, by its key. */
    sourceNames: Compiled<typeof sourceNames>;
    /** A source's name, by its key: its key where the surface lists none of it. */
    sourceName: Compiled<typeof sourceName>;
    /** The selected placement, as the inspector shows it. */
    inspectorSelection: Compiled<typeof inspectorSelection>;
    /** What the publish preview shows of the open entry. */
    publishSummary: Compiled<typeof publishSummary>;
    /** What refused a publish. */
    publishRefusal: Compiled<typeof publishRefusal>;
    /** The projects the record holds. */
    libraryProjects: Compiled<typeof libraryProjects>;
    /** A project's pages, as the page library draws them. */
    libraryPages: Compiled<typeof libraryPages>;
    /** A project's templates, as the page library draws them. */
    libraryTemplates: Compiled<typeof libraryTemplates>;
    /** What refused a write under a new name. */
    nameWriteRefusal: Compiled<typeof nameWriteRefusal>;
    /** The changes from one layout of a page to another. */
    changes: Compiled<typeof Studio.changes>;
    /** The patch that publishes a page. */
    publish: Compiled<typeof Studio.publish>;
    /** The patch that starts a page. */
    newPage: Compiled<typeof Studio.newPage>;
    /** The patch that saves a page's draft as a template. */
    saveTemplate: Compiled<typeof Studio.saveTemplate>;
    /** The canvas's Apply: a batch of placements, one patch through the record's patch write. */
    save: Compiled<typeof saveCells>;
    /** The starting filters' Apply (#1673): a batch of them, one patch on them alone through the record's patch write. */
    saveFilters: Compiled<typeof saveFilters>;
    /** The pill a field makes placed in a well (#1672). */
    placedPill: Compiled<typeof placedPill>;
    /** The measures a value of a field may take. */
    fieldMeasures: Compiled<typeof fieldMeasures>;
    /** A field as a group, by its kind's defaults. */
    fieldGroup: Compiled<typeof fieldGroup>;
    /** The kind a view is. */
    kindOfView: Compiled<typeof kindOfView>;
    /** A kind with nothing in its wells: what a dropped visual starts as. */
    emptyView: Compiled<typeof emptyView>;
    /** A view switched to another kind, its wells that fit carried over. */
    switchedView: Compiled<typeof switchedView>;
    /** The source a dropped visual reads: the page's most used. */
    mostUsedSource: Compiled<typeof mostUsedSource>;
}

/** Compiles every function the renderers call. */
function compileStudio(): StudioEast {
    return {
        /** Each listed component's palette card. */
        paletteCards: East.compile(paletteCards, []),
        /** A project's pages, as the palette lists them. */
        palettePages: East.compile(palettePages, []),
        /** Each listed component's tile on the canvas. */
        canvasTiles: East.compile(canvasTiles, []),
        /** The tile of what a placement holds: a listed component's, a visual's, a text block's. */
        contentTile: East.compile(contentTile, []),
        /** What a placement holds, in words. */
        contentWords: East.compile(contentWords, []),
        /** A visual, in words: its view and its source's name. */
        visualWords: East.compile(visualWords, []),
        /** Each listed component's name, by its key. */
        componentNames: East.compile(componentNames, []),
        /** Each listed component's frame, by its key. */
        componentFrames: East.compile(componentFrames, []),
        /** Whether a placement is drawn in a tile frame, by what it holds. */
        contentFramed: East.compile(contentFramed, []),
        /** A view's icon. */
        viewIcon: East.compile(viewIcon, []),
        /** A view, in words — "Column chart". */
        viewWords: East.compile(viewWords, []),
        /** A text block's paragraphs. */
        textParagraphs: East.compile(textParagraphs, []),
        /** Each listed source's name, by its key. */
        sourceNames: East.compile(sourceNames, []),
        /** A source's name, by its key: its key where the surface lists none of it. */
        sourceName: East.compile(sourceName, []),
        /** The selected placement, as the inspector shows it. */
        inspectorSelection: East.compile(inspectorSelection, []),
        /** What the publish preview shows of the open entry. */
        publishSummary: East.compile(publishSummary, []),
        /** What refused a publish. */
        publishRefusal: East.compile(publishRefusal, []),
        /** The projects the record holds. */
        libraryProjects: East.compile(libraryProjects, []),
        /** A project's pages, as the page library draws them. */
        libraryPages: East.compile(libraryPages, []),
        /** A project's templates, as the page library draws them. */
        libraryTemplates: East.compile(libraryTemplates, []),
        /** What refused a write under a new name. */
        nameWriteRefusal: East.compile(nameWriteRefusal, []),
        /** The changes from one layout of a page to another. */
        changes: East.compile(Studio.changes, []),
        /** The patch that publishes a page. */
        publish: East.compile(Studio.publish, []),
        /** The patch that starts a page. */
        newPage: East.compile(Studio.newPage, []),
        /** The patch that saves a page's draft as a template. */
        saveTemplate: East.compile(Studio.saveTemplate, []),
        /** The canvas's Apply: a batch of placements, one patch through the record's patch write. */
        save: East.compileAsync(saveCells, []),
        /** The starting filters' Apply (#1673): a batch of them, one patch on them alone through the record's patch write. */
        saveFilters: East.compileAsync(saveFilters, []),
        /** The pill a field makes placed in a well (#1672). */
        placedPill: East.compile(placedPill, []),
        /** The measures a value of a field may take. */
        fieldMeasures: East.compile(fieldMeasures, []),
        /** A field as a group, by its kind's defaults. */
        fieldGroup: East.compile(fieldGroup, []),
        /** The kind a view is. */
        kindOfView: East.compile(kindOfView, []),
        /** A kind with nothing in its wells: what a dropped visual starts as. */
        emptyView: East.compile(emptyView, []),
        /** A view switched to another kind, its wells that fit carried over. */
        switchedView: East.compile(switchedView, []),
        /** The source a dropped visual reads: the page's most used. */
        mostUsedSource: East.compile(mostUsedSource, []),
    };
}

let compiled: StudioEast | undefined;

/**
 * The Studio's East, compiled on first use.
 *
 * @returns The compiled functions
 */
export function studioEast(): StudioEast {
    compiled ??= compileStudio();
    return compiled;
}
