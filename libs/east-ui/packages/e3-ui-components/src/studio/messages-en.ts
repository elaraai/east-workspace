/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Studio's English messages (#996, #997, #998, #1000): the default of the
 * message table `messages.ts` types — every word the Studio's renderers say
 * themselves, in English.
 *
 * @packageDocumentation
 */

import { withArticle } from "../shared/article.js";
import { capitalised } from "../shared/capital.js";
import type { StudioMessages } from "./messages.js";

/** What each chart kind is for, under its segments: the spec's words for a column, and the Chart chapter's for the rest. */
const KIND_SAYS: Readonly<Record<string, string>> = {
    column: "categories or periods side by side",
    bar: "categories compared by length",
    line: "a value over time",
    area: "a value over time, filled to its base",
    combo: "columns and lines on one x axis",
    scatter: "one point per group, at two values",
    pie: "one value's shares of its total",
};

/** What a visual draws, mid-sentence: what a follower's prompt names it by. */
const VIEW_NOUN: Readonly<Record<"kpi" | "chart" | "table" | "list", string>> = { kpi: "KPI", chart: "chart", table: "table", list: "list" };

/** The Studio's English messages — the default table. */
export const studioMessages: StudioMessages = {
    statusDraft: () => "Draft",
    statusLive: () => "Live",
    statusLiveEdited: () => "Live · edited",
    statusTemplate: () => "Template",
    publish: () => "Publish",
    more: () => "More",
    saveAsTemplateItem: () => "Save as template…",
    noPageOpen: () => "No page open",
    noPageOpenHint: ({ project, page }) =>
        `${project} has no page ${page}. Open a page from the palette's Pages tab, or start one from the page library.`,
    components: () => "Components",
    componentNoun: () => ({ singular: "component", plural: "components" }),
    pageNoun: () => ({ singular: "page", plural: "pages" }),
    logicFixed: () => "Logic fixed by the developer",
    category: () => "Category",
    tags: () => "Tags",
    collections: () => "Collections",
    inspector: () => "Inspector",
    spanBadge: ({ span }) => `${span}/12`,
    noComponent: ({ key }) => `No component "${key}"`,
    noComponentHint: () => "This surface lists no component with this key.",
    twoComponents: ({ key }) => `Two components share the key "${key}"`,
    twoComponentsHint: () => "A surface lists each component once.",
    noSource: ({ key }) => `No source "${key}" is listed`,
    noSourceHint: () => "This surface lists no source with this key.",
    wellsEmpty: () => "Add fields to draw it",
    wellNeeded: ({ label, value }) => (value ? `A number in ${label}` : `A field in ${label}`),
    sourcePicked: () => "Pick a source",
    noField: ({ source }) => `${source} has no field`,
    pickAnotherField: () => "Pick another field",
    metaLoading: () => "loading",
    metaNeedsField: () => "needs a field",
    metaBy: ({ by }) => `by ${by}`,
    metaShown: ({ shown, of }) => `${shown} of ${of}`,
    noRange: ({ source }) => `${source} has no date to compare periods by`,
    noRangeHint: () => "Measure this value over the current period instead.",
    needsWindow: ({ source }) => `Comparing periods needs a date filter on ${source}`,
    needsWindowHint: () => "Filter the page by date to compare it with another period.",
    filters: () => "Filters",
    startingFilters: () => "Starting filters",
    startingFiltersHint: () => "Every reader starts with these filters, and can change or clear them.",
    addStartingFilter: () => "Add starting filter",
    changeStartingFilter: () => "Change starting filter",
    removeStartingFilter: () => "Remove starting filter",
    clearStartingFilters: () => "Clear starting filters",
    filtersSet: ({ n, count }) => (n === 0 ? "No filters" : n === 1 ? "1 filter" : `${count} filters`),
    filterOf: ({ source }) => `Filter · ${source}`,
    addFilterOf: ({ source }) => `Add filter · ${source}`,
    filterSource: () => "Source",
    filterSourceGone: ({ source }) => `This page no longer lists ${source}. Remove the filter.`,
    ownFilter: () => "Filter",
    ownFilterHint: () => "Narrows this visual alone, before the page's filters.",
    removeFilter: () => "Remove filter",
    followsLeader: ({ leader }) => `follows ${leader}`,
    leads: ({ count }) => `leads ${count}`,
    followNothing: () => "nothing selected",
    followRemoved: () => "leader removed",
    followsName: ({ leader, selected }) => `Follows ${leader}: ${selected}`,
    followPrompt: ({ field, leader }) => `Pick ${withArticle(field)} in ${leader}`,
    followPromptHint: ({ field, view }) => `This ${VIEW_NOUN[view]} shows the ${field} you select.`,
    addLinked: () => "Add a linked visual",
    linkOnCanvas: () => "Link on the canvas",
    linkPick: ({ follower }) => `Click the visual ${follower} should follow`,
    linkPickHint: () => "The outlined visuals can lead. Esc cancels.",
    linkCycle: ({ leader }) => `${leader} follows this visual already: linking them would make a cycle.`,
    linkNothing: ({ leader }) => `${leader} has nothing to select, so nothing can follow it.`,
    linkFollow: ({ leader }) => `Follow ${leader}`,
    linkMatch: ({ leader, from }) => `${leader}'${leader.endsWith("s") ? "" : "s"} ${from} matches this visual's`,
    linkByName: ({ follower, source, leader, leaderSource }) => `Matched by name. ${follower} reads ${source}; ${leader} reads ${leaderSource}.`,
    linkSwitches: ({ leader, click }) =>
        `${leader} will select on click instead of ${click === "filter" ? "filtering the page" : click === "open" ? "opening a page" : "doing nothing"}.`,
    link: () => "Link",
    follows: () => "Follows",
    followsNothing: () => "Nothing",
    followsLeaders: () => "Visuals whose click selects",
    followsFind: () => "Find a visual…",
    followsHint: () => "Pick a visual whose click selects: this one then shows what is selected there.",
    followsCycle: () => "It follows this visual already",
    followsLine: ({ view, source }) => `${view} · ${source}`,
    match: () => "Match",
    matchFrom: ({ leader }) => `${leader}'${leader.endsWith("s") ? "" : "s"} field`,
    matchTo: () => "This visual's field",
    matchHint: ({ leaderSource, from, source, to }) =>
        `${leaderSource}'${leaderSource.endsWith("s") ? "" : "s"} ${from} against ${source}'${source.endsWith("s") ? "" : "s"} ${to}.`,
    followEmpty: () => "With nothing selected",
    followAll: () => "Show all",
    followAsk: () => "Ask to pick",
    stopFollowing: () => "Stop following",
    followGone: () => "The visual this one follows was removed",
    followGoneHint: () => "Link it to another visual, or stop following.",
    noData: () => "no data",
    noDataReason: ({ rows, source, causes }) => (causes.length === 0 ? `${source} has no rows` : `No ${rows} for ${causes.join(" · ")}`),
    sourceError: ({ source }) => `${source} could not be read`,
    retry: () => "Retry",
    answerGroups: ({ n, groups, nr, rows }) => `${groups} ${n === 1 ? "group" : "groups"} from ${rows} ${nr === 1 ? "row" : "rows"}`,
    answerStopped: () => "Its query stopped before it answered.",
    valueName: ({ measure, of, ofs, per }) => {
        switch (measure) {
            case "count": case "sum": return capitalised(of);
            case "mean": return `Average ${of}`;
            case "min": return `Lowest ${of}`;
            case "max": return `Highest ${of}`;
            case "distinct": return `Different ${ofs}`;
            case "ratio": return `${capitalised(of)} per ${per}`;
        }
    },
    changeAgainst: ({ period, name, value }) =>
        (period === "year_ago" ? `vs year ago ${value}` : period === "previous" ? `vs previous period ${value}` : `vs ${name} ${value}`),
    trendBy: ({ unit }) => `by ${unit}`,
    lowerBetter: () => "lower is better",
    unitPer: ({ unit, per }) => `${unit}/${per}`,
    goalGap: ({ gap, over }) => (over ? `${gap} over` : `${gap} to go`),
    goalShare: ({ share, goal }) => `${share} of goal ${goal}`,
    goalOf: ({ goal }) => `Goal ${goal}`,
    goalLabel: ({ goal }) => `goal ${goal}`,
    otherCount: ({ n }) => `Other ${n}`,
    rightAxis: ({ name }) => `${name} · right`,
    scatterCaption: ({ x, xUnit, y, yUnit }) => `x ${xUnit === undefined ? x : `${x}, ${xUnit}`} · y ${yUnit === undefined ? y : `${y}, ${yUnit}`}`,
    pieNote: ({ unit, total }) => (unit === undefined ? `share of ${total}` : `${unit} · share of ${total}`),
    pieCaption: ({ unit }) => `${unit} · total`,
    quarterShort: ({ quarter }) => `Q${quarter}`,
    visualName: ({ value, by }) => `${value} by ${by}`,
    groupsBoth: ({ first, second }) => `${first} and ${second}`,
    groupsCross: ({ rows, columns }) => `${rows} · ${columns}`,
    valuesBoth: ({ first, second }) => `${first} and ${second}`,
    itemsName: ({ items }) => capitalised(items),
    bucketWord: ({ unit }) => unit,
    visualMenu: () => "Visual menu",
    showRows: () => "Show rows",
    exportCsv: () => "Export CSV",
    duplicate: () => "Duplicate",
    editVisual: () => "Edit visual",
    configure: () => "Configure",
    configuredBy: () => "Configured by",
    paletteVisuals: () => "Visuals · you configure",
    paletteDevelopers: () => "Built by developers",
    visualsCategory: () => "Visuals",
    textCard: () => "Text",
    textHeading: () => "Heading",
    textBody: () => "Body",
    newText: () => "Write here what the page says.",
    source: () => "Source",
    findSource: () => "Find a source",
    sourcesListed: () => "Sources",
    kind: () => "Kind",
    options: () => "Options",
    onClick: () => "On click",
    clickName: ({ click }) => (click === "select" ? "Select it" : click === "filter" ? "Filter this page" : click === "open" ? "Open a page" : "Nothing"),
    pageToOpen: () => "Page to open",
    findPage: () => "Find a page",
    cannotSet: ({ label }) => `${label} cannot take that value`,
    wells: () => "Wells",
    addToWell: ({ value }) => (value ? "Add a value" : "Add a field"),
    findField: () => "Find a field",
    fieldGroup: ({ numbers }) => (numbers ? "Numbers" : "Dimensions"),
    fieldKind: () => "Kind",
    fields: () => "Fields",
    fieldNoun: () => ({ singular: "field", plural: "fields" }),
    fieldInUse: () => "In use",
    fieldsOf: ({ source }) => `${source} fields`,
    dragFields: () => "Drag a field onto a well.",
    noFieldFound: () => "No field matches.",
    viewHint: () => "Switching view resets the wells.",
    kindHint: ({ label, kind }) => {
        const says = KIND_SAYS[kind];
        return says === undefined ? label : `${label} · ${says}`;
    },
    dropOn: ({ field, well }) => `Drop ${field} on ${well}`,
    openPage: ({ page }) => `Open ${page}`,
    clickOpens: () => "Opens the page narrowed to what is clicked.",
    pillTop: ({ top }) => `top ${top} + Other`,
    editPill: ({ label }) => `Edit ${label}`,
    removeFromWell: ({ label, well }) => `Remove ${label} from ${well}`,
    movePill: ({ label }) => `Move ${label}`,
    changeField: ({ label }) => `Change ${label}`,
    wellMissing: ({ source, field }) => `${source} has no field ${field}. Pick another or remove it.`,
    wellTakesFirst: ({ well }) => `${well} takes the first value only`,
    dropInto: ({ field, well }) => `Add ${field} to ${well}`,
    dropRefused: ({ field, well }) => `${well} cannot take ${field}`,
    wellFull: ({ well }) => `${well} takes no more`,
    aggregate: ({ measure, per }) => {
        switch (measure) {
            case "count": return "Count";
            case "sum": return "Sum";
            case "mean": return "Mean";
            case "min": return "Min";
            case "max": return "Max";
            case "distinct": return "Distinct";
            case "ratio": return `Per ${per}`;
        }
    },
    aggregates: () => "Aggregate",
    perAnother: () => "Per another field…",
    perField: () => "Per",
    period: () => "Period",
    periodName: ({ period }) => (period === "current" ? "Current" : period === "previous" ? "Prev" : "Yr ago"),
    goal: () => "Goal",
    better: () => "Better",
    betterName: ({ better }) => (better === "higher" ? "Higher" : "Lower"),
    valueLabel: () => "Label",
    format: () => "Format",
    formatName: ({ format }) => (format === "auto" ? "Auto" : format === "number" ? "Number" : format === "percent" ? "Percent" : "Money"),
    formatHelp: () => "Auto shows it as its field's format says.",
    currencyCode: () => "Currency code",
    currencyCodeNeeded: () => "A currency's code is three letters, as AUD",
    axis: () => "Axis",
    axisSide: ({ right }) => (right ? "Right" : "Left"),
    pillGoal: ({ goal }) => `goal ${goal}`,
    pillPeriod: ({ period }) => (period === "previous" ? "previous" : "year ago"),
    bucket: () => "Period",
    bucketName: ({ unit }) => {
        switch (unit) {
            case "auto": return "Auto";
            case "hour": return "Hour";
            case "day": return "Day";
            case "week": return "Week";
            case "month": return "Month";
            case "quarter": return "Qtr";
            case "year": return "Year";
        }
    },
    order: () => "Order",
    orderName: ({ sort, date }) => {
        switch (sort) {
            case "natural": return date ? "Time order" : "Value order";
            case "high": return "High first";
            case "low": return "Low first";
            case "label": return "A to Z";
        }
    },
    keepFirst: () => "Keep the first",
    keepFirstHelp: () => "Empty keeps every group; the rest fold into Other.",
    other: () => "Other",
    quarterOf: ({ quarter, year }) => `Q${quarter} ${year}`,
    groupsShown: ({ shown, of, n }) => `Showing ${shown} of ${of} ${n === 1 ? "group" : "groups"}`,
    rowsShown: ({ first, last, of }) => `Showing ${first}–${last} of ${of}`,
    columnUnit: ({ label, unit }) => `${label} ${unit}`,
    rowsOf: ({ name }) => `Rows · ${name}`,
    rowsCount: ({ n, count }) => (n === 1 ? "1 row" : `${count} rows`),
    exportFailed: () => "The rows could not be exported",
    dismiss: () => "Dismiss",
    totalRow: () => "Total",
    noValue: () => "no data",
    measureWord: ({ measure }) => (measure === "mean" ? "average" : measure),
    goalMissed: ({ over }) => (over ? "above goal" : "below goal"),
    labelHeader: ({ first, second }) => (second === undefined ? first : `${first} · ${second}`),
    heatTop: ({ from }) => `≥${from}`,
    heatStep: ({ from, to }) => `${from}–${to}`,
    notPublished: ({ page }) => `${page} is not published yet`,
    notPublishedHint: () => "Publish it to show it here.",
    noPage: ({ page }) => `No page ${page}`,
    noPageHint: ({ project }) => `The project ${project} has no page by this name.`,
    blankSummary: () => "12-col · empty",
    placements: ({ n, count }) => `${count} ${n === 1 ? "component" : "components"}`,
    openInBuilder: () => "Open in builder →",
    newPageFromTemplate: () => "New page from template",
    selectedComponent: () => "Selected component",
    selectedVisual: () => "Selected visual",
    selectedText: () => "Selected text",
    view: () => "View",
    data: () => "Data",
    readsNothing: () => "reads no data",
    configuration: () => "Configuration",
    fixedByDeveloper: () => "fixed by developer",
    noDescription: () => "No description",
    layout: () => "Layout",
    columnSpan: () => "Column span",
    spanOf: ({ span }) => `${span} / 12`,
    decreaseSpan: () => "Decrease span",
    increaseSpan: () => "Increase span",
    row: () => "Row",
    height: () => "Height",
    auto: () => "Auto",
    px: ({ px }) => `${px} px`,
    align: () => "Align",
    alignTop: () => "Top",
    alignCenter: () => "Center",
    alignStretch: () => "Stretch",
    published: () => "Published component · logic immutable",
    nothingSelected: () => "Nothing selected",
    nothingSelectedHint: () => "Click a component on the grid to see what it reads and its layout.",
    searchLibrary: ({ pages, templates, np, nt }) =>
        `Search ${pages} ${np === 1 ? "page" : "pages"} and ${templates} ${nt === 1 ? "template" : "templates"}…`,
    searchLabel: () => "Search pages and templates",
    clearSearch: () => "Clear search",
    sortByName: () => "Sort · Name",
    nameAz: () => "Name A–Z",
    nameZa: () => "Name Z–A",
    newPageIn: ({ project }) => `New page in ${project}`,
    newPage: () => "New page",
    projects: () => "Projects",
    pages: () => "Pages",
    live: () => "Live",
    draft: () => "Draft",
    templates: () => "Templates",
    cloneToStart: () => "clone to start a page",
    pagesIn: ({ shown, total, project, narrowed }) => (narrowed ? `${shown} of ${total} in ${project}` : `${total} in ${project}`),
    pageName: () => "Page name",
    pageNameMissing: () => "Give the page a name to create it.",
    template: () => "Template",
    blankGrid: () => "Blank grid",
    createPage: () => "Create page",
    cancel: () => "Cancel",
    nameTaken: ({ name }) => `${name} is already a page or a template here.`,
    saveAsTemplate: () => "Save as template",
    templateName: () => "Template name",
    templateNameMissing: () => "Give the template a name to save it.",
    saveTemplate: () => "Save template",
    templateNameFor: ({ page }) => `${page} template`,
    templateOpen: () => "A template is open — open a page to save it as a template",
    preview: () => "Preview",
    devices: () => "Device",
    device: ({ device }) => (device === "desktop" ? "Desktop" : device === "tablet" ? "Tablet" : "Mobile"),
    env: () => "Env",
    exit: () => "Exit",
    readyToPublish: () => "Ready to publish",
    upToDate: () => "Up to date",
    templateNotPublished: () => "Templates are not published",
    version: ({ version }) => `v${version}`,
    liveVersion: () => "live",
    templateKind: () => "template",
    changesSince: ({ n, count, version }) => `${count} ${n === 1 ? "change" : "changes"} since ${version}`,
    changesFirst: ({ n, count }) => `${count} ${n === 1 ? "change" : "changes"} · first version`,
    noChangesSince: ({ version }) => `No changes since ${version}`,
    changeVerb: ({ change }) => {
        switch (change) {
            case "filters": return "Changed";
            case "added": return "Added";
            case "removed": return "Removed";
            case "moved": return "Moved";
            case "resized": case "height": return "Resized";
            case "aligned": return "Aligned";
            case "retitled": return "Retitled";
            case "configured": return "Configured";
        }
    },
    audience: () => "Audience",
    rollout: () => "Rollout",
    saveAsDraft: () => "Save as draft",
    publishTo: ({ version, env }) => (version === undefined ? "Publish" : env === undefined ? `Publish ${version}` : `Publish ${version} to ${env}`),
    phoneComponentsIntro: () => "Tap a component, then tap where it goes on the page. On desktop you drag it onto the grid.",
    phonePagesIntro: () => "Tap a page to open it in the builder.",
    phoneOnPage: () => "on page",
    phoneDetails: () => "Details",
    phoneRowMeta: ({ row }) => `row ${row}`,
    phoneWhere: ({ row, first, last }) => `row ${row} · columns ${first}–${last}`,
    phoneRowOf: ({ row, rows }) => `${row} of ${rows}`,
    phoneMove: () => "Move",
    phoneNothingFirst: () => "Tap a tile on the page to see what it reads and its layout.",
    phoneNothingThen: () => "Open Components to add one.",
    phoneTemplateHelp: ({ project, page }) => `Joins ${project}'s templates. ${page} stays as it is.`,
    phoneBack: () => "Back to the builder",
    phonePage: () => "Page",
    phoneChanges: () => "Changes",
    phoneWireCaption: ({ device, px }) => `${device} · ${px} px · the layout, each tile by name`,
};
