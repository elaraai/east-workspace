/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Every word the Studio's renderers say themselves (#996, #997, #998, #1000) —
 * ONE typed message table: the builder's toolbar, its palette and its
 * placeholders; the inspector's section heads, its fields and its controls'
 * names, its footer, and what it says with nothing selected; the page
 * library's toolbar, pane, section heads and cards; the popovers that name a
 * new page or a template; the publish preview's bar, its aside and its
 * footer; and what a page says when it has nothing to draw. What the AUTHOR wrote — a component's name, key, reads and
 * description, a placement's title, a project's, a page's and an
 * environment's names, the audience and the rollout — is data, and never
 * passes through it.
 *
 * English is the default. A host overrides any subset for a subtree with
 * {@link StudioMessagesProvider}; numbers format in the locale react-aria's
 * `I18nProvider` above the app sets (the browser's otherwise).
 *
 * @packageDocumentation
 */

import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";

/**
 * The Studio's message table.
 *
 * @remarks
 * Numbers — `span`, `px`, the counts, a version's number — arrive already
 * formatted for the locale; `np`, `nt` and `n` are the raw counts, for plurals.
 */
export interface StudioMessages {
    /** The builder toolbar's status: never published. */
    statusDraft: () => string;
    /** Published, its draft its live layout. */
    statusLive: () => string;
    /** Published, its draft changed since. */
    statusLiveEdited: () => string;
    /** A template is open. */
    statusTemplate: () => string;
    /** The builder toolbar's Publish. */
    publish: () => string;
    /** The ⋯ chip a row short of room folds Save as template, Preview and Publish into (#1229) — its accessible name. */
    more: () => string;
    /** Save as template in the ⋯ chip's menu, which opens its popover. */
    saveAsTemplateItem: () => string;
    /** The builder with no page of the project open — its heading. */
    noPageOpen: () => string;
    /** Under it, what to do. */
    noPageOpenHint: (p: { project: string; page: string }) => string;
    /** The palette's pane — its tab and its rail's name. */
    components: () => string;
    /** One component, and any other count — the palette's noun. */
    componentNoun: () => { singular: string; plural: string };
    /** One page, and any other count — the palette's noun. */
    pageNoun: () => { singular: string; plural: string };
    /** A palette card's lock. */
    logicFixed: () => string;
    /** The palette's grouping and filter facet. */
    category: () => string;
    /** The palette's tags facet. */
    tags: () => string;
    /** The palette's collections facet. */
    collections: () => string;
    /** The inspector's pane — its tab and its rail's name. */
    inspector: () => string;
    /** The inspector's rail badge — the selected placement's span, `8/12`. */
    spanBadge: (p: { span: string }) => string;
    /** A placement whose component the surface does not list — its heading. */
    noComponent: (p: { key: string }) => string;
    /** Under it. */
    noComponentHint: () => string;
    /** A placement whose key two listed components share — its heading. */
    twoComponents: (p: { key: string }) => string;
    /** Under it. */
    twoComponentsHint: () => string;
    /** A visual whose source the surface does not list — its heading. */
    noSource: (p: { key: string }) => string;
    /** Under it. */
    noSourceHint: () => string;
    /** A visual with a well it needs empty (#1670) — its heading. */
    wellsEmpty: () => string;
    /** A well it needs, in the checklist under it, by its label — `A number in Values`; `value` when a value fills it (#1672). */
    wellNeeded: (p: { label: string; value: boolean }) => string;
    /** What that checklist has done: its source is chosen. */
    sourcePicked: () => string;
    /** A visual reading a field its source does not have — the words before the field's name: `Orders has no field`. */
    noField: (p: { source: string }) => string;
    /** Under it, the link that opens the visual's fields. */
    pickAnotherField: () => string;
    /** A tile's meta while its answer is awaited. */
    metaLoading: () => string;
    /** A tile's meta while a field it reads is missing. */
    metaNeedsField: () => string;
    /** A tile's meta: what it groups by — `by week`. */
    metaBy: (p: { by: string }) => string;
    /** A tile's meta: what it holds of how many — `7 of 46`; both are formatted. */
    metaShown: (p: { shown: string; of: string }) => string;
    /** A visual with a value over another period, over a source with no date range to move the page's window along — its heading. */
    noRange: (p: { source: string }) => string;
    /** Under it. */
    noRangeHint: () => string;
    /** A visual with a value over another period, on a page with no date window — its heading. */
    needsWindow: (p: { source: string }) => string;
    /** Under it. */
    needsWindowHint: () => string;
    /** The page's filters — the rail's name, and its folded chip's. */
    filters: () => string;
    /** How many filters narrow the page, as the rail's folded chip says it. */
    filtersSet: (p: { n: number; count: string }) => string;
    /** A filter's chip where the page lists more than one source: the source's name, then the filter's words. */
    filterOn: (p: { source: string; filter: string }) => string;
    /** A filter's editor's head: the source it is on. */
    filterOf: (p: { source: string }) => string;
    /** The source a new filter is on — the chooser's label. */
    filterSource: () => string;
    /** A filter on a source the page no longer lists, in its editor. */
    filterSourceGone: (p: { source: string }) => string;
    /** A follower's tag on the builder's canvas: the visual it follows (LNK-4). */
    followsLeader: (p: { leader: string }) => string;
    /** A leader's tag on the builder's canvas: how many visuals follow it; `count` is formatted. */
    leads: (p: { count: string }) => string;
    /** A follower's tag with nothing selected on its leader (LNK-5). */
    followNothing: () => string;
    /** A follower's tag when its leader is no longer on the page (LNK-5). */
    followRemoved: () => string;
    /** What a follower's tag names for assistive technology: the visual it follows, and what is selected. */
    followsName: (p: { leader: string; selected: string }) => string;
    /** A follower that asks for a pick, with nothing selected: its title, naming the leader's field and the leader (LNK-5). */
    followPrompt: (p: { field: string; leader: string }) => string;
    /** Under it: what the follower then shows, named by what it draws — `This chart shows the machine you select.` */
    followPromptHint: (p: { field: string; view: "kpi" | "chart" | "table" | "list" }) => string;
    /** The Configure tab's Follows field: the visual a visual follows (LNK-3). */
    follows: () => string;
    /** Its choice for following none. */
    followsNothing: () => string;
    /** Its chooser's head: the visuals a visual may follow. */
    followsLeaders: () => string;
    /** Its chooser's search, while empty. */
    followsFind: () => string;
    /** Under the field while it follows none: what following does. */
    followsHint: () => string;
    /** A leader its chooser refuses: following it would make a cycle (LNK-3). */
    followsCycle: () => string;
    /** A leader, as its chooser's line says it: what it draws, and its source. */
    followsLine: (p: { view: string; source: string }) => string;
    /** The match's field: the leader's field against this visual's. */
    match: () => string;
    /** The leader's field's picker's name. */
    matchFrom: (p: { leader: string }) => string;
    /** This visual's field's picker's name. */
    matchTo: () => string;
    /** Under the match: the two fields, each with its source — `Assets' Machine against Telemetry's Machine id.` */
    matchHint: (p: { leaderSource: string; from: string; source: string; to: string }) => string;
    /** What a follower shows with nothing selected: the field's name, and its two choices (LNK-5). */
    followEmpty: () => string;
    followAll: () => string;
    followAsk: () => string;
    /** Takes the link off. */
    stopFollowing: () => string;
    /** A leader's menu's item: a new chart on the next row, on its source, already following it (LNK-8). */
    addLinked: () => string;
    /** Starts linking on the canvas: a visual's menu's item, and the Follows block's button (LNK-6). */
    linkOnCanvas: () => string;
    /** The banner while a leader is picked: what to do, naming the visual being linked. */
    linkPick: (p: { follower: string }) => string;
    /** Under it: which visuals can be picked, and how to leave. */
    linkPickHint: () => string;
    /** A click on a visual that follows the one being linked: why it is refused (LNK-3). */
    linkCycle: (p: { leader: string }) => string;
    /** A click on a placement whose clicks tell no field: why it cannot lead. */
    linkNothing: (p: { leader: string }) => string;
    /** The link's popover's head (LNK-7). */
    linkFollow: (p: { leader: string }) => string;
    /** Over its fields: the leader's field, which one of this visual's matches. */
    linkMatch: (p: { leader: string; from: string }) => string;
    /** Under them, where the two read different sources: how the match was made. */
    linkByName: (p: { follower: string; source: string; leader: string; leaderSource: string }) => string;
    /** Under them, where the leader's click was not select: what linking switches. */
    linkSwitches: (p: { leader: string; click: "filter" | "open" | "none" | "select" }) => string;
    /** Its button. */
    link: () => string;
    /** A follower that asks for a pick whose leader is no longer on the page: its title. */
    followGone: () => string;
    /** Under it. */
    followGoneHint: () => string;
    /** A visual that read no rows — where its value would be. */
    noData: () => string;
    /**
     * Under it, why (#1673): what emptied it — its own filter, the page's filters on its source and what it follows,
     * each in words — after its source's rows, named mid-sentence: `No orders for region is NSW · units is less than 0`;
     * with none, that its source has no rows: `Orders has no rows`.
     */
    noDataReason: (p: { rows: string; source: string; causes: readonly string[] }) => string;
    /** A visual whose source could not be read — the banner's title. */
    sourceError: (p: { source: string }) => string;
    /** The banner's action, which asks the visual's programs again. */
    retry: () => string;
    /** A visual's answer, before it is drawn — `12 groups from 340 rows`. */
    answerGroups: (p: { n: number; groups: string; nr: number; rows: string }) => string;
    /** A visual whose query stopped before it answered: out of time, too large, or needing a platform function. */
    answerStopped: () => string;
    /**
     * A visual's value with no label of its own, named by what it measures (#1671): a count by its source's name
     * (`Orders`), a field's sum by the field's label, `Average margin`, `Lowest units`, `Highest units`, `Different
     * customers`, `Revenue per unit`. `of` is a count's source's name or its field's label, `ofs` the label in the
     * plural, `per` a ratio's second field's label in the singular — each in the case it takes mid-sentence.
     */
    valueName: (p: { measure: "count" | "sum" | "mean" | "min" | "max" | "distinct" | "ratio"; of: string; ofs: string; per: string }) => string;
    /**
     * What a KPI's change is against, with what it was — `vs year ago 10.76`, `vs previous period 49`; a compare over the
     * same period by its name, mid-sentence — `vs average revenue 70`.
     */
    changeAgainst: (p: { period: "current" | "previous" | "year_ago"; name: string; value: string }) => string;
    /** A KPI's trend's bucket, after what its change is against — `by month`; `unit` is {@link StudioMessages.bucketWord}'s. */
    trendBy: (p: { unit: string }) => string;
    /** After what a KPI's change is against, when less is better. */
    lowerBetter: () => string;
    /** A ratio's unit, beside its number — `AUD/unit`: what it is of, per one of what it is per, mid-sentence and in the singular. */
    unitPer: (p: { unit: string; per: string }) => string;
    /** How far a KPI stands from its goal — `0.66M to go`, `300 over`. */
    goalGap: (p: { gap: string; over: boolean }) => string;
    /** How far a KPI is to its goal, beside its progress — `85% of goal 4.50M`. */
    goalShare: (p: { share: string; goal: string }) => string;
    /** A KPI's goal with no share to say of it — `Goal 0`. */
    goalOf: (p: { goal: string }) => string;
    /** A chart's goal line's label, inside the plot over the line — `goal 450k`. */
    goalLabel: (p: { goal: string }) => string;
    /** The rest of a group past its first N, with how many it holds — `Other 41`; `n` is formatted. */
    otherCount: (p: { n: string }) => string;
    /** A combo's series read against its right axis, as the legend names it — `Revenue per unit · right`. */
    rightAxis: (p: { name: string }) => string;
    /** What a scatter's axes are, over its plot — `x units · y revenue per unit, AUD/unit`; each name mid-sentence, a unit where its value has one. */
    scatterCaption: (p: { x: string; xUnit?: string | undefined; y: string; yUnit?: string | undefined }) => string;
    /** Under a pie's legend, what its values are — `AUD · share of 3.84M`; with no unit, `share of 1,284`. */
    pieNote: (p: { unit?: string | undefined; total: string }) => string;
    /** Under a donut's total, what it is — `units · total`. */
    pieCaption: (p: { unit: string }) => string;
    /** A quarter on an axis whose buckets are all of one year — `Q3`. */
    quarterShort: (p: { quarter: number }) => string;
    /** A visual's name made from its wells (TIL-1) — `Revenue by month`; `value` is its value's name, `by` what it groups by, mid-sentence. */
    visualName: (p: { value: string; by: string }) => string;
    /** A summary's two groups, in its name — `region and category`. */
    groupsBoth: (p: { first: string; second: string }) => string;
    /** A pivot's row group and column group, in its name — `region · month`. */
    groupsCross: (p: { rows: string; columns: string }) => string;
    /** A combo's first column and first line, in its name — `Units and revenue per unit`; `second` is mid-sentence. */
    valuesBoth: (p: { first: string; second: string }) => string;
    /** What a scatter's points or a list's rows stand for, as its name — `Customers`; `items` is the field's label in the plural, mid-sentence. */
    itemsName: (p: { items: string }) => string;
    /** A date bucket's unit, mid-sentence — `month`. */
    bucketWord: (p: { unit: "hour" | "day" | "week" | "month" | "quarter" | "year" }) => string;
    /** The tile menu's chip — its accessible name (TIL-2). */
    visualMenu: () => string;
    /** The tile menu's item that shows the visual's rows in the drawer. */
    showRows: () => string;
    /** The tile menu's item, and the drawer's action, that downloads the rows as CSV. */
    exportCsv: () => string;
    /** The tile menu's item that places a copy of the visual beside it. */
    duplicate: () => string;
    /** The tile menu's item, on the builder's canvas, that opens the visual's Configure tab (#1672). */
    editVisual: () => string;
    /** The inspector's tab that edits what the selected placement holds (#1672). */
    configure: () => string;
    /** The palette's grouping by who configures a card: the operator, or its developer (#1672). */
    configuredBy: () => string;
    /** The palette's group of visuals, which the operator configures. */
    paletteVisuals: () => string;
    /** The palette's group of components, built by developers. */
    paletteDevelopers: () => string;
    /** A visual card's category, under the palette's Category grouping. */
    visualsCategory: () => string;
    /** The palette's text block card. */
    textCard: () => string;
    /** A text block's heading field, in its Configure tab. */
    textHeading: () => string;
    /** A text block's body field. */
    textBody: () => string;
    /** What a text block dropped from the palette says until it is written. */
    newText: () => string;
    /** A visual's source part, and its picker's name. */
    source: () => string;
    /** The source picker's search. */
    findSource: () => string;
    /** The source picker's one section. */
    sourcesListed: () => string;
    /** A visual's kind segments' name. */
    kind: () => string;
    /** A visual's options part. */
    options: () => string;
    /** A visual's On click part. */
    onClick: () => string;
    /** What a click on a visual does, as its segment says it. */
    clickName: (p: { click: "select" | "filter" | "open" | "none" }) => string;
    /** The page an Open a page click opens — its picker's name. */
    pageToOpen: () => string;
    /** The page picker's search. */
    findPage: () => string;
    /** An option set to a value its kind does not take. */
    cannotSet: (p: { label: string }) => string;
    /** A visual's wells' part — its name, for the keyboard. */
    wells: () => string;
    /** An empty single well's slot, and a list well's add slot — `Add a value`; `value` when a value fills it (EDT-3). */
    addToWell: (p: { value: boolean }) => string;
    /** The field chooser's search, and the Fields list's. */
    findField: () => string;
    /** The groups fields are listed in: what a visual groups by, and numbers — `Dimensions`, `Numbers`. */
    fieldGroup: (p: { numbers: boolean }) => string;
    /** The Fields list's grouping. */
    fieldKind: () => string;
    /** The Fields part's eyebrow. */
    fields: () => string;
    /** One field, and any other count — the Fields list's noun. */
    fieldNoun: () => { singular: string; plural: string };
    /** A field a well holds, as the Fields list marks it (EDT-3). */
    fieldInUse: () => string;
    /** The Fields part's label — `Orders fields`. */
    fieldsOf: (p: { source: string }) => string;
    /** Under the Fields list, what to do with one. */
    dragFields: () => string;
    /** The Fields list with none its search leaves. */
    noFieldFound: () => string;
    /** Under the view's segments. */
    viewHint: () => string;
    /** Under a chart's kinds, what the chosen one is for — `Column · categories or periods side by side`; a kind it has no words for, its name alone. */
    kindHint: (p: { label: string; kind: string }) => string;
    /** A well's empty place while a field it takes is dragged over it — `Drop Region on Split by`. */
    dropOn: (p: { field: string; well: string }) => string;
    /** A click that opens a page, as its select says it — `Open Region detail`. */
    openPage: (p: { page: string }) => string;
    /** Under the On click select while a click opens a page. */
    clickOpens: () => string;
    /** A group pill's first N, after its name — `top 2 + Other`. */
    pillTop: (p: { top: string }) => string;
    /** A pill's name and what it is set to, which open its menu — `Edit Revenue`. */
    editPill: (p: { label: string }) => string;
    /** A pill's remove — `Remove Revenue from Values`. */
    removeFromWell: (p: { label: string; well: string }) => string;
    /** A list well's pill's grip — `Move Revenue`; ⌥↑ and ⌥↓ move it too. */
    movePill: (p: { label: string }) => string;
    /** A pill's field, which opens the field chooser to change it — `Change Revenue`. */
    changeField: (p: { label: string }) => string;
    /** Under a well, a pill whose field its source does not have (MOD-5). */
    wellMissing: (p: { source: string; field: string }) => string;
    /** Under a well a list is held to one pill by, while the list holds more (CHT-2) — `Split by takes the first value only`. */
    wellTakesFirst: (p: { well: string }) => string;
    /** The drag's caption over a well that takes the field — `Add Region to X axis`. */
    dropInto: (p: { field: string; well: string }) => string;
    /** Over a well that does not — `Trend cannot take Region`. */
    dropRefused: (p: { field: string; well: string }) => string;
    /** Over a list well that is full — `Values takes no more`. */
    wellFull: (p: { well: string }) => string;
    /** A value pill's aggregate, as its chip and its menu name it (EDT-6) — `Sum`; a ratio's by what it is per — `Per unit`. */
    aggregate: (p: { measure: "count" | "sum" | "mean" | "min" | "max" | "distinct" | "ratio"; per: string }) => string;
    /** The value pill menu's aggregates' name. */
    aggregates: () => string;
    /** The value pill menu's choice of a ratio, which asks for the field it is per. */
    perAnother: () => string;
    /** The ratio's field chooser's head. */
    perField: () => string;
    /** A value's period — the value pill menu's segments. */
    period: () => string;
    /** A period, as its segment says it. */
    periodName: (p: { period: "current" | "previous" | "year_ago" }) => string;
    /** A value's goal. */
    goal: () => string;
    /** Which way a value is better. */
    better: () => string;
    /** A way it is better, as its segment says it. */
    betterName: (p: { better: "higher" | "lower" }) => string;
    /** A value's own label, in place of its name. */
    valueLabel: () => string;
    /** How a value's numbers are shown — the value pill menu's select. */
    format: () => string;
    /** A format, as its segment says it — each short enough for four to stand side by side: as its field's, or one of its own. */
    formatName: (p: { format: "auto" | "number" | "percent" | "currency" }) => string;
    /** What Auto is, under the format's segments. */
    formatHelp: () => string;
    /** A currency format's code. */
    currencyCode: () => string;
    /** Why a currency's code is refused: it is three letters. */
    currencyCodeNeeded: () => string;
    /** The axis a combo's value is drawn against — the value pill menu's segments. */
    axis: () => string;
    /** A side, as its segment says it. */
    axisSide: (p: { right: boolean }) => string;
    /** A value pill's goal, after its name — `goal 450k`. */
    pillGoal: (p: { goal: string }) => string;
    /** A value pill's period other than the page's, after its name — `year ago`. */
    pillPeriod: (p: { period: "previous" | "year_ago" }) => string;
    /** A group's bucket — the group pill popover's segments (EDT-7). */
    bucket: () => string;
    /** A bucket, as its segment and a group pill's chip say it — `Month`. */
    bucketName: (p: { unit: "auto" | "hour" | "day" | "week" | "month" | "quarter" | "year" }) => string;
    /** A group's order. */
    order: () => string;
    /** An order, as its segment and a group pill's chip say it — `Time order` for a date's own. */
    orderName: (p: { sort: "natural" | "high" | "low" | "label"; date: boolean }) => string;
    /** How many groups a visual keeps, the rest folding into Other. */
    keepFirst: () => string;
    /** Under it, what its empty box keeps. */
    keepFirstHelp: () => string;
    /** The rest of a group past its first N, folded. */
    other: () => string;
    /** A quarter, as a chart's axis or a table's row names its bucket — `Q3 2026`. */
    quarterOf: (p: { quarter: number; year: string }) => string;
    /** A visual that shows some of its groups — `Showing 500 of 1,240 groups`. */
    groupsShown: (p: { shown: string; of: string; n: number }) => string;
    /** A page of a records table — `Showing 1–50 of 1,284`. */
    rowsShown: (p: { first: string; last: string; of: string }) => string;
    /** A records column's header with its field's unit — `Revenue AUD`. */
    columnUnit: (p: { label: string; unit: string }) => string;
    /** The Show rows popover's head: whose rows they are — `Rows · Revenue by region`. */
    rowsOf: (p: { name: string }) => string;
    /** At its foot, how many rows there are — `1,284 rows`. */
    rowsCount: (p: { n: number; count: string }) => string;
    /** An export that could not be made — its banner's title. */
    exportFailed: () => string;
    /** The banner's action, which puts it away. */
    dismiss: () => string;
    /** A summary's total row's label. */
    totalRow: () => string;
    /** A cell, a point or a value with none to show. */
    noValue: () => string;
    /** What made a total, before it in a summary's total row (TBL-2) — `sum`, `average`, `ratio`. */
    measureWord: (p: { measure: "count" | "sum" | "mean" | "min" | "max" | "distinct" | "ratio" }) => string;
    /** A cell on the wrong side of its value's goal, as its mark names it (TBL-3) — `below goal`; `above goal` where less is better. */
    goalMissed: (p: { over: boolean }) => string;
    /** A summary's label column's header, its groups — `Region · category`; `second` is mid-sentence. */
    labelHeader: (p: { first: string; second?: string | undefined }) => string;
    /** A pivot's heat legend's top step — `≥ 1,200`. */
    heatTop: (p: { from: string }) => string;
    /** A pivot's heat legend's step — `400–800`. */
    heatStep: (p: { from: string; to: string }) => string;
    /** A page whose live version is asked for before it is published — its heading. */
    notPublished: (p: { page: string }) => string;
    /** Under it. */
    notPublishedHint: () => string;
    /** A page the record does not hold — its heading. */
    noPage: (p: { page: string }) => string;
    /** Under it. */
    noPageHint: (p: { project: string }) => string;
    /** Blank grid's card — what it places. */
    blankSummary: () => string;
    /** A page card's count of placements — `3 components`. */
    placements: (p: { n: number; count: string }) => string;
    /** A page card's action. */
    openInBuilder: () => string;
    /** The Pages row's dashed last card. */
    newPageFromTemplate: () => string;
    /** The inspector's selection block — its eyebrow. */
    selectedComponent: () => string;
    /** Its eyebrow while a visual is selected. */
    selectedVisual: () => string;
    /** Its eyebrow while a text block is selected. */
    selectedText: () => string;
    /** The eyebrow over a visual's view. */
    view: () => string;
    /** The Data block's eyebrow. */
    data: () => string;
    /** A component whose code reads no dataset. */
    readsNothing: () => string;
    /** The Configuration block's eyebrow. */
    configuration: () => string;
    /** Beside it, what the lock says. */
    fixedByDeveloper: () => string;
    /** A component with no description. */
    noDescription: () => string;
    /** The Layout block's eyebrow. */
    layout: () => string;
    /** The span stepper's label. */
    columnSpan: () => string;
    /** The span as the stepper shows it — `8 / 12`. */
    spanOf: (p: { span: string }) => string;
    /** The stepper's minus button. */
    decreaseSpan: () => string;
    /** The stepper's plus button. */
    increaseSpan: () => string;
    /** The row field's label. */
    row: () => string;
    /** The height field's label. */
    height: () => string;
    /** A height that is its content's own. */
    auto: () => string;
    /** A height in px — `240 px`. */
    px: (p: { px: string }) => string;
    /** The alignment's label. */
    align: () => string;
    /** At the row's top. */
    alignTop: () => string;
    /** Centred in the row. */
    alignCenter: () => string;
    /** As tall as the row. */
    alignStretch: () => string;
    /** The inspector's footer. */
    published: () => string;
    /** The inspector with nothing selected — its heading. */
    nothingSelected: () => string;
    /** Under it, what to do. */
    nothingSelectedHint: () => string;
    /** The page library's search, counting what it searches — `Search 4 pages and 4 templates…`. */
    searchLibrary: (p: { pages: string; templates: string; np: number; nt: number }) => string;
    /** The search field's name. */
    searchLabel: () => string;
    /** The search's clear button. */
    clearSearch: () => string;
    /** The Sort menu's trigger. */
    sortByName: () => string;
    /** Name, A to Z. */
    nameAz: () => string;
    /** Name, Z to A. */
    nameZa: () => string;
    /** The primary action — `New page in Ops console`. */
    newPageIn: (p: { project: string }) => string;
    /** The primary action, folded, and the New page popover's head. */
    newPage: () => string;
    /** The pane's projects caption. */
    projects: () => string;
    /** The pane's pages caption, and the Pages section's head. */
    pages: () => string;
    /** The legend's live status. */
    live: () => string;
    /** The legend's draft status. */
    draft: () => string;
    /** The Templates section's head. */
    templates: () => string;
    /** Beside it. */
    cloneToStart: () => string;
    /** Beside the Pages head — `4 in Ops console`, or `1 of 4 in Ops console` while the search narrows. */
    pagesIn: (p: { shown: string; total: string; project: string; narrowed: boolean }) => string;
    /** The New page popover's name field. */
    pageName: () => string;
    /** Under it, while it is empty. */
    pageNameMissing: () => string;
    /** The New page popover's template field. */
    template: () => string;
    /** Blank grid — no template. */
    blankGrid: () => string;
    /** The New page popover's commit. */
    createPage: () => string;
    /** A popover's cancel. */
    cancel: () => string;
    /** A name the project holds already. */
    nameTaken: (p: { name: string }) => string;
    /** The builder toolbar's Save as template, and its popover's head. */
    saveAsTemplate: () => string;
    /** Its popover's name field. */
    templateName: () => string;
    /** Under it, while it is empty. */
    templateNameMissing: () => string;
    /** Its popover's commit. */
    saveTemplate: () => string;
    /** The name it offers — `Overview template`. */
    templateNameFor: (p: { page: string }) => string;
    /** Why it is disabled while a template is open. */
    templateOpen: () => string;
    /** The publish preview's bar — `● Preview`. */
    preview: () => string;
    /** The device strip's accessible name. */
    devices: () => string;
    /** The device the page is drawn for. */
    device: (p: { device: "desktop" | "tablet" | "mobile" }) => string;
    /** The Env pill's label, before the environment's name. */
    env: () => string;
    /** Back to the builder. */
    exit: () => string;
    /** The aside's head while there is something to publish. */
    readyToPublish: () => string;
    /** The aside's head while the page is live as it stands. */
    upToDate: () => string;
    /** The aside's head while a template is open. */
    templateNotPublished: () => string;
    /** A version — `v4`. */
    version: (p: { version: string }) => string;
    /** After the live version in the aside's head — `v4 live`. */
    liveVersion: () => string;
    /** After a template's name in the aside's head. */
    templateKind: () => string;
    /** The change list's head — `3 changes since v3`. */
    changesSince: (p: { n: number; count: string; version: string }) => string;
    /** The change list's head on a first publish — `3 changes · first version`. */
    changesFirst: (p: { n: number; count: string }) => string;
    /** The change list's head while nothing changed — `No changes since v4`. */
    noChangesSince: (p: { version: string }) => string;
    /** A change's verb, before the placement's name — `Added`, `Resized`. */
    changeVerb: (p: { change: "added" | "removed" | "moved" | "resized" | "height" | "aligned" | "retitled" | "configured" }) => string;
    /** The Audience row's label. */
    audience: () => string;
    /** The Rollout row's label. */
    rollout: () => string;
    /** The footer's Apply. */
    saveAsDraft: () => string;
    /** The footer's publish — `Publish v4 to Staging`; with no environment, `Publish v4`; for a template, `Publish`. */
    publishTo: (p: { version?: string | undefined; env?: string | undefined }) => string;
    /** A phone's Components tab: what to do. */
    phoneComponentsIntro: () => string;
    /** A phone's Pages tab: what to do. */
    phonePagesIntro: () => string;
    /** A card's line once its component is on the page. */
    phoneOnPage: () => string;
    /** A phone's inspector's one tab. */
    phoneDetails: () => string;
    /** The strip's Inspector meta — `row 2`. */
    phoneRowMeta: (p: { row: string }) => string;
    /** The inspector's meta line — `row 2 · columns 1–8`. */
    phoneWhere: (p: { row: string; first: string; last: string }) => string;
    /** The inspector's Row readout — `2 of 3`. */
    phoneRowOf: (p: { row: string; rows: string }) => string;
    /** The inspector's Move. */
    phoneMove: () => string;
    /** Nothing selected on a phone: first. */
    phoneNothingFirst: () => string;
    /** Then. */
    phoneNothingThen: () => string;
    /** Save as template's help line on a phone. */
    phoneTemplateHelp: (p: { project: string; page: string }) => string;
    /** Back to the builder, from a phone's preview. */
    phoneBack: () => string;
    /** A phone's preview's Page tab. */
    phonePage: () => string;
    /** A phone's preview's Changes tab. */
    phoneChanges: () => string;
    /** Under Tablet or Desktop — `Desktop · 1,440 px · the layout, each tile by name`. */
    phoneWireCaption: (p: { device: string; px: string }) => string;
}

/** The Studio's English messages — the default table. */
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
    filtersSet: ({ n, count }) => (n === 0 ? "No filters" : n === 1 ? "1 filter" : `${count} filters`),
    filterOn: ({ source, filter }) => `${source}: ${filter}`,
    filterOf: ({ source }) => `Filter · ${source}`,
    filterSource: () => "Source",
    filterSourceGone: ({ source }) => `This page no longer lists ${source}. Remove the filter.`,
    followsLeader: ({ leader }) => `follows ${leader}`,
    leads: ({ count }) => `leads ${count}`,
    followNothing: () => "nothing selected",
    followRemoved: () => "leader removed",
    followsName: ({ leader, selected }) => `Follows ${leader}: ${selected}`,
    followPrompt: ({ field, leader }) => `Pick ${/^[aeiou]/i.test(field) ? "an" : "a"} ${field} in ${leader}`,
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

/**
 * A phrase with its first letter made a capital: a field's label at the start of a value's name.
 *
 * @param phrase - The phrase
 * @returns It, its first letter a capital
 */
export function capitalised(phrase: string): string {
    return phrase.length === 0 ? phrase : phrase[0]!.toUpperCase() + phrase.slice(1);
}

const StudioMessagesContext = createContext<StudioMessages>(studioMessages);

/**
 * The message table in effect — {@link studioMessages} with every
 * {@link StudioMessagesProvider} above overriding it.
 *
 * @returns The table
 */
export function useStudioMessages(): StudioMessages {
    return useContext(StudioMessagesContext);
}

/** Props of {@link StudioMessagesProvider}. */
export interface StudioMessagesProviderProps {
    /** The messages to override — any subset; the rest come from the table above. */
    messages: Partial<StudioMessages>;
    /** The subtree the overrides apply to. */
    children?: ReactNode;
}

/**
 * Override the Studio's words for a subtree — a translation, or a house style.
 * Providers nest: each overrides the table the one above it resolved.
 *
 * @remarks
 * The overrides are read by identity: define them once (module scope, or a
 * memo), as below.
 *
 * @param props - The overrides and the subtree
 * @returns The provider
 *
 * @example
 * ```tsx
 * const GERMAN: Partial<StudioMessages> = {
 *     nothingSelected: () => "Nichts ausgewählt",
 *     columnSpan: () => "Spaltenbreite",
 * };
 *
 * <I18nProvider locale="de-DE">
 *     <StudioMessagesProvider messages={GERMAN}>
 *         <EastChakraComponent value={builder} />
 *     </StudioMessagesProvider>
 * </I18nProvider>
 * ```
 */
export function StudioMessagesProvider({ messages, children }: StudioMessagesProviderProps) {
    const parent = useStudioMessages();
    const value = useMemo(() => ({ ...parent, ...messages }), [parent, messages]);
    return createElement(StudioMessagesContext.Provider, { value }, children);
}
