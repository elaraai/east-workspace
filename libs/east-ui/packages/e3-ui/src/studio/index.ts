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
import { StudioPage, StudioSite, StudioVersionType } from "./surfaces.js";
import { StudioPalette } from "./palette.js";

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
    StudioPagesType,
    StudioStatusType,
} from "./pages.js";
export {
    StudioPage,
    StudioSite,
    StudioVersionType,
    type StudioPageOptions,
    type StudioSiteOptions,
    type StudioVersionLiteral,
} from "./surfaces.js";
export {
    StudioPalette,
    builderKeys,
    paletteCards,
    palettePages,
    PaletteCardType,
    PalettePageType,
    type StudioPaletteOptions,
} from "./palette.js";

/** The type of the {@link Studio} namespace. */
export interface StudioNamespace {
    /** Declares a component: a self-contained East UI function, and what the palette shows of it. */
    component: typeof StudioComponents.component;
    /** Renders one placement by its component's key, from the components a surface lists. */
    dispatch: typeof StudioComponents.dispatch;
    /** Saves the page open in the builder — the canvas's Apply, one patch to the page's draft. */
    save: typeof StudioPages.save;
    /** Publishes a page: the patch that makes its draft its next live version. */
    publish: typeof StudioPages.publish;
    /** Reverts a page: the patch that makes its live version's layout its draft. */
    revert: typeof StudioPages.revert;
    /** Starts a page, from a template or blank: the patch that inserts it. */
    newPage: typeof StudioPages.newPage;
    /** Saves a page's draft as a template: the patch that inserts it. */
    saveTemplate: typeof StudioPages.saveTemplate;
    /** The changes from one layout of a page to another. */
    changes: typeof StudioPages.changes;
    /** How many pages place each component — "Used in N". */
    usage: typeof StudioPages.usage;
    /** A page's status: live or draft. */
    status: typeof StudioPages.status;
    /** `<Studio.Page>` — one page with no chrome, its live or draft layout on the SnapGrid. */
    Page: typeof StudioPage;
    /** `<Studio.Site>` — a project's published site: an `<App>` over its live pages. */
    Site: typeof StudioSite;
    /** `<Studio.Palette>` — the builder's palette: the listed components by category, and the project's pages. */
    Palette: typeof StudioPalette;
    /** The Studio's East types. */
    Types: {
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
        /** One change between two layouts of a page ({@link StudioChangeType}). */
        Change: typeof StudioChangeType;
        /** One change to a placement ({@link StudioCellChangeType}). */
        CellChange: typeof StudioCellChangeType;
        /** A page's status ({@link StudioStatusType}). */
        Status: typeof StudioStatusType;
        /** Which layout of a page to draw ({@link StudioVersionType}). */
        Version: typeof StudioVersionType;
    };
}

/**
 * The Studio — components developers publish as code (`Studio.component`),
 * the placements that render them (`Studio.dispatch`), the pages record
 * operators build (`Studio.Types.Pages`, its writes and the change list), the
 * surfaces that read it (`<Studio.Page>` and `<Studio.Site>`), and the
 * builder's screens (`<Studio.Palette>`).
 */
export const Studio: StudioNamespace = {
    component: StudioComponents.component,
    dispatch: StudioComponents.dispatch,
    save: StudioPages.save,
    publish: StudioPages.publish,
    revert: StudioPages.revert,
    newPage: StudioPages.newPage,
    saveTemplate: StudioPages.saveTemplate,
    changes: StudioPages.changes,
    usage: StudioPages.usage,
    status: StudioPages.status,
    Page: StudioPage,
    Site: StudioSite,
    Palette: StudioPalette,
    Types: {
        Component: StudioComponentType,
        Frame: StudioFrameType,
        Pages: StudioPagesType,
        Key: StudioKeyType,
        Entry: StudioEntryType,
        PageEntry: StudioPageEntryType,
        Live: StudioLiveType,
        Page: StudioPageType,
        Cell: StudioCellType,
        Change: StudioChangeType,
        CellChange: StudioCellChangeType,
        Status: StudioStatusType,
        Version: StudioVersionType,
    },
};
