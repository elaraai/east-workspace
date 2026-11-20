/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Studio (#787) — components developers publish as code, the sources a
 * surface lists, and the pages operators build on the 12-column snap grid
 * from components, visuals over those sources, and text blocks (#1669).
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
    StudioPageFilterType,
    StudioPageType,
    StudioPages,
    StudioPagesType,
    StudioStatusType,
} from "./pages.js";
import { StudioPage, StudioVersionType } from "./page.js";
import { StudioBuilder } from "./builder.js";
import { StudioLibrary } from "./library.js";
import {
    StudioChartType,
    StudioClickType,
    StudioContentType,
    StudioFollowType,
    StudioGroupType,
    StudioKpiType,
    StudioListType,
    StudioMeasureType,
    StudioTableType,
    StudioTextType,
    StudioValueType,
    StudioViewType,
    StudioVisualType,
    StudioVisuals,
} from "./content.js";
import { StudioFilterType } from "./filter.js";
import { StudioMigrations } from "./migrations.js";
import { StudioFieldType, StudioSourceType, createSource } from "./source.js";

export {
    StudioComponentType,
    StudioFrameType,
    componentNames,
    dataName,
    readNames,
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
    StudioPageFilterChangesType,
    StudioPageFilterType,
    StudioPageType,
    StudioPagesHandleType,
    StudioPagesType,
    StudioStatusType,
    saveCells,
    saveFilters,
    type StudioPagesHandle,
} from "./pages.js";
export {
    StudioAxisValueType,
    StudioBetterType,
    StudioChartType,
    StudioClickType,
    StudioComboChartType,
    StudioContentType,
    StudioFollowType,
    StudioGroupType,
    StudioKpiType,
    StudioLegendType,
    StudioListType,
    StudioMeasureType,
    StudioPeriodType,
    StudioPieChartType,
    StudioPieLegendType,
    StudioScatterChartType,
    StudioSeriesChartType,
    StudioSortType,
    StudioStackType,
    StudioTableType,
    StudioTextType,
    StudioValueType,
    StudioViewType,
    StudioVisualType,
    StudioVisuals,
    contentChange,
    contentWords,
    textParagraphs,
    viewIcon,
    viewWords,
    visualWords,
    type StudioAxisValue,
    type StudioContent,
    type StudioGroup,
    type StudioGroupOptions,
    type StudioValue,
    type StudioValueOptions,
    type StudioView,
    type StudioVisual,
    type StudioVisualOptions,
} from "./content.js";
export {
    StudioFieldKindType,
    StudioFieldType,
    StudioSourceType,
    createSource,
    sourceName,
    sourceNames,
    sourceRowsOf,
    studioSources,
    type StudioSourceDeclaration,
    type StudioSourceField,
    type StudioSourceMeta,
    type StudioSourceRows,
} from "./source.js";
export {
    StudioFilterType, StudioFiltersType, studioFiltersKey,
    StudioPickType, StudioClickedType, StudioSelectionsType, studioSelectionsKey,
} from "./filter.js";
export { StudioFormatChoiceType, choiceFormat, editedFormatChoice, formatChoice, isCurrencyCode, type StudioFormatChoice } from "./format.js";
export { StudioMigrations, cellContent, type StudioMigrationsNamespace } from "./migrations.js";
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
    componentFrames,
    contentFramed,
    contentTile,
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
    InspectorContentType,
    InspectorLayoutType,
    InspectorSelectionType,
    StudioInspectorPayloadType,
} from "./inspector.js";
export {
    StudioKindEditorType,
    StudioKindOptionType,
    StudioKindType,
    StudioPillType,
    StudioViewEditorType,
    StudioWellHoldsType,
    StudioWellType,
    studioEditors,
    type StudioKind,
    type StudioKindEditor,
    type StudioKindLiteral,
    type StudioPill,
    type StudioViewEditor,
    type StudioWell,
} from "./editors.js";
export {
    emptyView,
    fieldGroup,
    fieldMeasures,
    kindOfView,
    mostUsedSource,
    placedPill,
    switchedView,
} from "./configure.js";
export { kindEditor, kindStruct, optionSpecs, withKindField } from "./kind.js";
export {
    fieldFits,
    movedInWell,
    pillFields,
    placedFields,
    placedInWell,
    removedFromWell,
    replacedInWell,
    wellMost,
    wellPills,
    withWellPills,
} from "./wells.js";
export { changedParts, savedKindFields } from "./changed.js";

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
    /** A page's layout: its title, its placements and its starting filters ({@link StudioPageType}). */
    Page: typeof StudioPageType;
    /** One placement on a page ({@link StudioCellType}). */
    Cell: typeof StudioCellType;
    /** One of a page's starting filters: what every reader's filters of it start as ({@link StudioPageFilterType}). */
    PageFilter: typeof StudioPageFilterType;
    /** Which layout of a page to draw ({@link StudioVersionType}). */
    Version: typeof StudioVersionType;
    /** What a placement holds: a component's key, a visual or a text block ({@link StudioContentType}). */
    Content: StudioContentType;
    /** A visual: its source, its filter, its view, its click and the visual it follows ({@link StudioVisualType}). */
    Visual: StudioVisualType;
    /** What a visual draws: a KPI, a chart, a table or a list ({@link StudioViewType}). */
    View: StudioViewType;
    /** A KPI ({@link StudioKpiType}). */
    Kpi: typeof StudioKpiType;
    /** A chart, by its kind ({@link StudioChartType}). */
    Chart: typeof StudioChartType;
    /** A table, by its kind ({@link StudioTableType}). */
    Table: typeof StudioTableType;
    /** A list ({@link StudioListType}). */
    List: typeof StudioListType;
    /** One value of a visual: a measure, and how it reads ({@link StudioValueType}). */
    Value: StudioValueType;
    /** What a value measures ({@link StudioMeasureType}). */
    Measure: typeof StudioMeasureType;
    /** What a visual groups its rows by ({@link StudioGroupType}). */
    Group: StudioGroupType;
    /** A text block ({@link StudioTextType}). */
    Text: typeof StudioTextType;
    /** What a click on a visual does ({@link StudioClickType}). */
    Click: typeof StudioClickType;
    /** The visual a visual follows ({@link StudioFollowType}). */
    Follow: typeof StudioFollowType;
    /** One filter of a page: a jq condition every visual of one source reads through ({@link StudioFilterType}). */
    Filter: typeof StudioFilterType;
    /** A source a surface's visuals may read ({@link StudioSourceType}). */
    Source: typeof StudioSourceType;
    /** One field of a source ({@link StudioFieldType}). */
    Field: typeof StudioFieldType;
}

/** The type of the {@link Studio} namespace — what a solution mounts and declares. */
export interface StudioNamespace {
    /** Declares a component: a self-contained East UI function, and what the palette shows of it. */
    component: typeof StudioComponents.component;
    /** Declares a source a surface's visuals may read: a bound handle, and what operators see of it ({@link createSource}). */
    source: typeof createSource;
    /** Builds a placement's content and a visual's parts, each with its defaults, for a pages record's seeds ({@link StudioVisuals}). */
    visual: typeof StudioVisuals;
    /** The pages record's migration steps: `migration.rows("cell_content", Studio.migrations.cellContent)` ({@link StudioMigrations}). */
    migrations: typeof StudioMigrations;
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
    PageFilter: StudioPageFilterType,
    Version: StudioVersionType,
    Content: StudioContentType,
    Visual: StudioVisualType,
    View: StudioViewType,
    Kpi: StudioKpiType,
    Chart: StudioChartType,
    Table: StudioTableType,
    List: StudioListType,
    Value: StudioValueType,
    Measure: StudioMeasureType,
    Group: StudioGroupType,
    Text: StudioTextType,
    Click: StudioClickType,
    Follow: StudioFollowType,
    Filter: StudioFilterType,
    Source: StudioSourceType,
    Field: StudioFieldType,
};

/**
 * The Studio — components developers publish as code (`Studio.component`),
 * the sources a surface lists (`Studio.source`), the pages record operators
 * build (`Studio.Types.Pages`, its seeds built with `Studio.visual`, its
 * migrations `Studio.migrations`), and the components a solution mounts: the
 * builder (`<Studio.Builder>`), the page library (`<Studio.Library>`) and one
 * page (`<Studio.Page>`).
 */
export const Studio: StudioNamespace = {
    component: StudioComponents.component,
    source: createSource,
    visual: StudioVisuals,
    migrations: StudioMigrations,
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
    /** Saves a page's starting filters — the builder's Apply of them, one patch to the page's draft. */
    saveFilters: typeof StudioPages.saveFilters;
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
    source: createSource,
    visual: StudioVisuals,
    migrations: StudioMigrations,
    Builder: StudioBuilder,
    Library: StudioLibrary,
    Page: StudioPage,
    save: StudioPages.save,
    saveFilters: StudioPages.saveFilters,
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
