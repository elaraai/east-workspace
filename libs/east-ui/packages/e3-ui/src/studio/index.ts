/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Studio (#787) — components developers publish as code, and the pages
 * operators build from them on the 12-column snap grid.
 *
 * @packageDocumentation
 */

import {
    StudioComponentType,
    StudioComponents,
    StudioFrameType,
} from "./component.js";
import {
    StudioCellChangeType,
    StudioCellType,
    StudioChangeType,
    StudioEntryType,
    StudioKeyType,
    StudioLiveType,
    StudioPageEntryType,
    StudioPageType,
    StudioPages,
    StudioPagesType,
    StudioStatusType,
} from "./pages.js";
import { StudioPage, StudioVersionType } from "./page.js";
import { StudioBuilder } from "./builder.js";
import { StudioLibrary } from "./library.js";

export {
    StudioComponentType,
    StudioFrameType,
    fingerprintOf,
    type StudioComponentMeta,
    type StudioFrameLiteral,
} from "./component.js";
export {
    StudioCellChangeType,
    StudioCellType,
    StudioChangeType,
    StudioEntryType,
    StudioKeyType,
    StudioLiveType,
    StudioPageEntryType,
    StudioPageType,
    StudioPagesHandleType,
    StudioPagesType,
    StudioStatusType,
    saveCells,
    type StudioPagesHandle,
} from "./pages.js";
export {
    StudioPage,
    StudioPageComponent,
    StudioPagePayloadType,
    StudioVersionType,
    type StudioPageOptions,
    type StudioVersionLiteral,
} from "./page.js";
export {
    StudioBuilder,
    StudioBuilderComponent,
    StudioBuilderPayloadType,
    type StudioBuilderOptions,
} from "./builder.js";
export {
    builderKeys,
    paletteCards,
    palettePages,
    PaletteCardType,
    PalettePageType,
} from "./palette.js";
export {
    canvasTiles,
    CanvasTileType,
    StudioSaveTemplatePayloadType,
} from "./canvas.js";
export {
    StudioLibrary,
    StudioLibraryComponent,
    StudioLibraryPayloadType,
    StudioLibraryPageType,
    StudioLibraryTemplateType,
    libraryProjects,
    libraryPages,
    libraryTemplates,
    layoutSummary,
    nameWriteRefusal,
    type StudioLibraryOptions,
} from "./library.js";
export {
    PublishChangeType,
    PublishStandingType,
    PublishSummaryType,
    StudioPublishPayloadType,
    publishSummary,
    publishRefusal,
} from "./publish.js";
export {
    inspectorSelection,
    InspectorLayoutType,
    InspectorSelectionType,
    StudioInspectorPayloadType,
} from "./inspector.js";

/** The Studio's East types — what a solution declares its pages record with, and seeds it from. */
export interface StudioTypes {
    /** A Studio component ({@link StudioComponentType}). */
    Component: typeof StudioComponentType;
    /** How a component's placements are drawn ({@link StudioFrameType}). */
    Frame: typeof StudioFrameType;
    /** The pages record's type — every page and template, by key ({@link StudioPagesType}). */
    Pages: typeof StudioPagesType;
    /** A page's key ({@link StudioKeyType}). */
    Key: typeof StudioKeyType;
    /** One entry of the pages record: a page or a template ({@link StudioEntryType}). */
    Entry: typeof StudioEntryType;
    /** A page: its draft and its live version ({@link StudioPageEntryType}). */
    PageEntry: typeof StudioPageEntryType;
    /** A published version of a page ({@link StudioLiveType}). */
    Live: typeof StudioLiveType;
    /** A page's layout: its title and its placements ({@link StudioPageType}). */
    Page: typeof StudioPageType;
    /** One placement on a page ({@link StudioCellType}). */
    Cell: typeof StudioCellType;
    /** Which layout of a page to draw ({@link StudioVersionType}). */
    Version: typeof StudioVersionType;
}

/** The type of the {@link Studio} namespace — what a solution mounts and declares. */
export interface StudioNamespace {
    /** Declares a component: a self-contained East UI function, and what the palette shows of it. */
    component: typeof StudioComponents.component;
    /** `<Studio.Builder>` — the builder: the open page's canvas, the palette and the inspector beside it, and the publish preview. */
    Builder: typeof StudioBuilder;
    /** `<Studio.Library>` — a project's templates and pages, and where new pages start. */
    Library: typeof StudioLibrary;
    /** `<Studio.Page>` — one page with no chrome, its live or draft layout on the snap grid. */
    Page: typeof StudioPage;
    /** The Studio's East types. */
    Types: StudioTypes;
}

const types: StudioTypes = {
    Component: StudioComponentType,
    Frame: StudioFrameType,
    Pages: StudioPagesType,
    Key: StudioKeyType,
    Entry: StudioEntryType,
    PageEntry: StudioPageEntryType,
    Live: StudioLiveType,
    Page: StudioPageType,
    Cell: StudioCellType,
    Version: StudioVersionType,
};

/**
 * The Studio — components developers publish as code (`Studio.component`),
 * the pages record operators build (`Studio.Types.Pages`), and the components
 * a solution mounts: the builder (`<Studio.Builder>`), the page library
 * (`<Studio.Library>`) and one page (`<Studio.Page>`).
 */
export const Studio: StudioNamespace = {
    component: StudioComponents.component,
    Builder: StudioBuilder,
    Library: StudioLibrary,
    Page: StudioPage,
    Types: types,
};

/**
 * The type of the internal Studio namespace — the public one, and the page
 * functions behind the builder and the page library.
 */
export interface StudioInternalNamespace extends Omit<StudioNamespace, "Types"> {
    /** Saves a page's placements — the builder canvas's Apply, one patch to the page's draft. */
    save: typeof StudioPages.save;
    /** Publishes a page: the patch that makes its draft its next live version, each placement stamped with the code it goes live with. */
    publish: typeof StudioPages.publish;
    /** Reverts a page: the patch that makes its live version's layout its draft. */
    revert: typeof StudioPages.revert;
    /** Starts a page, from a template or blank: the patch that inserts it. */
    newPage: typeof StudioPages.newPage;
    /** Saves a page's draft as a template: the patch that inserts it. */
    saveTemplate: typeof StudioPages.saveTemplate;
    /** The changes from one layout of a page to another. */
    changes: typeof StudioPages.changes;
    /** A page's status: live or draft. */
    status: typeof StudioPages.status;
    /** The Studio's East types, and those of the change list and a page's status. */
    Types: StudioTypes & {
        /** One change between two layouts of a page ({@link StudioChangeType}). */
        Change: typeof StudioChangeType;
        /** One change to a placement ({@link StudioCellChangeType}). */
        CellChange: typeof StudioCellChangeType;
        /** A page's status ({@link StudioStatusType}). */
        Status: typeof StudioStatusType;
    };
}

/**
 * The internal Studio namespace — `@elaraai/e3-ui/internal`'s `Studio`: the
 * public namespace, and the page functions the renderers and the tests call.
 *
 * @internal
 */
export const StudioInternal: StudioInternalNamespace = {
    component: StudioComponents.component,
    Builder: StudioBuilder,
    Library: StudioLibrary,
    Page: StudioPage,
    save: StudioPages.save,
    publish: StudioPages.publish,
    revert: StudioPages.revert,
    newPage: StudioPages.newPage,
    saveTemplate: StudioPages.saveTemplate,
    changes: StudioPages.changes,
    status: StudioPages.status,
    Types: {
        ...types,
        Change: StudioChangeType,
        CellChange: StudioCellChangeType,
        Status: StudioStatusType,
    },
};
