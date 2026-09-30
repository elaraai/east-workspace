/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Studio's East, compiled for its renderers (#1000) — what the builder's
 * palette, canvas, inspector and publish preview, and the page library, show
 * and write is computed by the functions `@elaraai/e3-ui` declares, compiled
 * once, on first use; nothing here restates them.
 *
 * @packageDocumentation
 */

import { East, type TypeOf, type ValueTypeOf } from "@elaraai/east";
import {
    Studio,
    canvasTiles,
    inspectorSelection,
    libraryPages,
    libraryProjects,
    libraryTemplates,
    nameWriteRefusal,
    paletteCards,
    palettePages,
    publishRefusal,
    publishSummary,
    saveCells,
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
