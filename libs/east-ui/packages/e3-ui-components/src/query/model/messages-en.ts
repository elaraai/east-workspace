/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's English messages (#934): the default of the message
 * table `messages.ts` types — every word the model says, in English.
 *
 * @packageDocumentation
 */

import { withArticle } from "../../shared/article.js";
import { capitalised } from "../../shared/capital.js";
import { lastUnit, type ComparisonKind, type LastUnit, type StepKind } from "../steps/values.js";
import type { PlanCombineKind, PlanTotalRule, QueryMessages, SlotKind } from "./messages.js";
import type { InputKind } from "./refs.js";

const STEP_TITLE: Readonly<Record<Exclude<StepKind, "drill">, string>> = {
    filter: "Keep rows where",
    lookup: "Look up from another dataset",
    group: "Group and total",
    sort: "Sort",
    limit: "Keep the first",
    count: "Count the rows",
    pick: "Show only these fields",
    fill: "Fill in missing values",
    datepart: "Take part of a date",
    walk: "List every part in the tree",
    tabulate: "Try the model over a range",
    jq: "jq step",
};

const STEP_VERB: Readonly<Record<StepKind, string>> = {
    filter: "filter", lookup: "look up", group: "group", sort: "sort", limit: "keep", count: "count", pick: "choose fields from",
    fill: "fill in", drill: "open", datepart: "read dates from", walk: "walk", tabulate: "call", jq: "run",
};

const ADD_STEP_HINT: Readonly<Record<StepKind, string>> = {
    filter: "Keep only the rows that match",
    lookup: "Bring in fields from a lookup table by key",
    group: "One row per group, with totals",
    sort: "Order the rows",
    limit: "The first rows only",
    count: "Gives one number",
    pick: "Pick and rename fields",
    fill: "Use a default where a value is missing",
    drill: "One row per item in a list",
    datepart: "Year, month or weekday",
    walk: "Walk every nested level",
    tabulate: "One row per input value",
    jq: "Write the step in jq",
};

const ADD_STEP_KEYWORDS: Readonly<Record<StepKind, string>> = {
    filter: "filter where select only matching remove exclude",
    lookup: "join lookup bring match",
    group: "group sum total add up count average mean aggregate pivot per by",
    sort: "sort order rank highest lowest top",
    limit: "first top limit head n",
    count: "count how many number length total rows",
    pick: "pick select columns fields rename show only hide choose",
    fill: "missing default null empty fill blank",
    drill: "flatten expand lines unnest open list each items",
    datepart: "date year month week day part time",
    walk: "recurse tree walk nested children parts flatten all",
    tabulate: "call model function range what if tabulate",
    jq: "jq code custom",
};

const COMPARISON: Readonly<Record<ComparisonKind, string>> = {
    eq: "is", ne: "is not", ge: "is at least", le: "is at most", gt: "is more than", lt: "is less than",
    contains: "contains", startsWith: "starts with", missing: "is missing", present: "has a value", yes: "is yes", no: "is no",
    inYear: "is in year", inMonth: "is in month", onOrAfter: "is on or after", before: "is before",
    lengthAtLeast: "has at least", anyWhere: "has any where",
    inLastHours: "is in the last … hours", inLastDays: "is in the last … days", inLastWeeks: "is in the last … weeks",
};

/** The unit an "is in the last" comparison counts in, by that unit: one, and more. */
const LAST_UNIT_WORDS: Readonly<Record<LastUnit, readonly [string, string]>> = {
    hour: ["hour", "hours"], day: ["day", "days"], week: ["week", "weeks"],
};

/** The words of the unit a comparison counts back in; `undefined` for a comparison that is no "is in the last". */
function unitWords(cmp: ComparisonKind): readonly [string, string] | undefined {
    const unit = lastUnit(cmp);
    return unit === undefined ? undefined : LAST_UNIT_WORDS[unit];
}

const SLOT_LABEL: Readonly<Record<SlotKind, string>> = {
    "match": "Match", "group-match": "Match",
    "field": "Field", "cmp": "Compare", "value": "Value",
    "key": "Find by", "dataset": "Dataset", "lookup-add": "Bring in",
    "by": "Group by", "by-add": "Group by", "agg-fn": "Total", "agg-field": "Of", "agg-per": "Per",
    "sort-field": "Sort by", "dir": "Order",
    "pick-field": "Field", "pick-add": "Add field",
    "fill-field": "Field", "drill-field": "List", "via": "List",
    "part": "Part", "date-field": "Date",
    "fixed": "Value",
    "add-step": "Add a step",
};

const PLACEHOLDER: Readonly<Record<SlotKind, string>> = {
    "match": "choose", "group-match": "choose",
    "field": "field", "cmp": "compare", "value": "value",
    "key": "field", "dataset": "dataset", "lookup-add": "field",
    "by": "field", "by-add": "field", "agg-fn": "total", "agg-field": "field", "agg-per": "field",
    "sort-field": "field", "dir": "order",
    "pick-field": "field", "pick-add": "field",
    "fill-field": "field", "drill-field": "list", "via": "list",
    "part": "part", "date-field": "date",
    "fixed": "value",
    "add-step": "step",
};

const INPUT_LABEL: Readonly<Record<InputKind, string>> = {
    "limit-n": "How many", "agg-as": "Total's name", "pick-as": "Field's name", "fill-value": "Value to use", "datepart-as": "Part's name",
    "tab-from": "From", "tab-to": "To", "tab-step": "Every", "tab-as": "Result's name",
};

/** How the pieces' outputs combine, in words; one that ends with a colon has its jq after it. */
const PLAN_COMBINE: Readonly<Record<PlanCombineKind, string>> = {
    concat: "Their rows are joined in order.",
    totals: "Their totals combine, each by its rule:",
    group: "Their rows are grouped by:",
    groupTotals: "Each group's totals combine, each by its rule:",
    groupRows: "Each group's rows are collected.",
    distinct: "Their distinct rows are kept:",
    distinctBy: "The first row of each key is kept, by:",
    reduceAdd: "Their updates combine by key, added:",
    reduceReplace: "Their updates combine by key, the last kept:",
};

/** How a total's parts combine, before its jq. */
const PLAN_TOTAL: Readonly<Record<PlanTotalRule, string>> = {
    count: "Counted:",
    add: "Added up:",
    min: "The lowest kept:",
    max: "The highest kept:",
    first: "The first kept:",
    last: "The last kept:",
    any: "True if any is:",
    all: "True if all are:",
    union: "The distinct values kept:",
};

/** A split run's units, by its stage: one, and more. */
const PLAN_UNITS: Readonly<Record<"partition" | "merge" | "combine", readonly [string, string]>> = {
    partition: ["piece", "pieces"],
    merge: ["merge", "merges"],
    combine: ["fold", "folds"],
};

/** Whether a slot takes a value, typed or offered. */
const takesValue = (slot: SlotKind): boolean => slot === "value" || slot === "fixed";
/** Whether a slot offers fields of the checked type. */
const takesField = (slot: SlotKind): boolean =>
    slot === "field" || slot === "key" || slot === "by" || slot === "by-add" || slot === "agg-field" || slot === "agg-per" || slot === "sort-field"
    || slot === "pick-field" || slot === "pick-add" || slot === "fill-field" || slot === "drill-field" || slot === "via" || slot === "date-field"
    || slot === "lookup-add";

/** `a`, `a and b`, `a, b and c`. */
function englishList(items: readonly string[]): string {
    if (items.length < 2) return items[0] ?? "";
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The query builder's English messages — the default table. */
export const queryMessages: QueryMessages = {
    stepTitle: ({ kind, noun }) => (kind === "drill" ? `Open each ${noun}'s list` : STEP_TITLE[kind]),
    stepVerb: ({ kind }) => STEP_VERB[kind],
    addStepLabel: ({ kind, noun }) => {
        switch (kind) {
            case "filter": return "Keep rows where…";
            case "lookup": return "Look up from another dataset…";
            case "group": return "Group and total…";
            case "sort": return "Sort by…";
            case "limit": return "Keep the first…";
            case "count": return "Count the rows";
            case "pick": return "Show only some fields…";
            case "fill": return "Fill in missing values…";
            case "drill": return `Open each ${noun}'s list…`;
            case "datepart": return "Take part of a date…";
            case "walk": return "List every part in the tree";
            case "tabulate": return "Try the model over a range…";
            case "jq": return "jq step";
        }
    },
    addStepHint: ({ kind }) => ADD_STEP_HINT[kind],
    addStepKeywords: ({ kind }) => ADD_STEP_KEYWORDS[kind],
    quickAddLabel: ({ kind }) => {
        switch (kind) {
            case "filter": return "Keep rows";
            case "group": return "Group and total";
            case "sort": return "Sort by";
            case "limit": return "Keep the first";
            case "pick": return "Show only fields";
            case "walk": return "List every part in the tree";
            case "tabulate": return "Try the model over a range";
            default: return STEP_VERB[kind];
        }
    },
    needsTree: () => "Needs a tree of parts",
    needsCalculation: () => "Needs a calculation",
    nothingToUse: () => "Nothing to use it on here",
    needsRows: ({ shape }) => `Needs rows — the query gives ${shape} here`,
    notFinished: () => "Not in the query until it's finished.",
    noSteps: () => "Add a step to narrow, reshape or total the rows, or start from a saved query.",
    addStepAtEnd: () => "Add a step at the end",
    quickAdd: () => "Quick add",
    insert: () => "Insert",
    startWith: ({ source }) => `Start with ${source}`,

    comparison: ({ cmp }) => COMPARISON[cmp],
    comparisonDetail: ({ cmp }) => (cmp === "anyWhere" ? "check the items in the list" : unitWords(cmp) !== undefined ? "up to the minute the query runs" : ""),
    comparisonSlot: ({ cmp }) => (unitWords(cmp) !== undefined ? "is in the last" : COMPARISON[cmp]),
    lastUnit: ({ cmp, n }) => {
        const words = unitWords(cmp);
        return words === undefined ? "" : words[n === 1 ? 0 : 1];
    },

    kind: ({ kind, items, cases }) => {
        switch (kind) {
            case "text": return "text";
            case "wholeNumber": return "whole number";
            case "number": return "number";
            case "date": return "date";
            case "yesNo": return "yes or no";
            case "nothing": return "nothing";
            case "bytes": return "bytes";
            case "oneOf": return cases === undefined ? "one of" : `one of ${cases}`;
            case "list": return items === undefined ? "list" : `list of ${items}`;
            case "lookupTable": return "lookup table";
            case "calculation": return "calculation";
            case "record": return "record";
            case "tree": return items === undefined ? "tree" : `tree of ${items}`;
            case "value": return "value";
        }
    },
    sometimesMissing: ({ kind }) => `${kind}, sometimes missing`,
    shapeMany: ({ rows }) => `Many ${rows}`,
    shapeUpTo: ({ count, rows }) => `Up to ${count} ${rows}`,
    shapeOne: ({ kind, noun }) => {
        switch (kind) {
            case "wholeNumber": return "One whole number";
            case "number": return "One number";
            case "text": return "One text value";
            case "record": return "One record";
            case "tree": return `One ${noun} tree`;
            case "calculation": return "One calculation";
            case "list": return "One list";
            case "lookupTable": return "One lookup table";
            case "value": return "One value";
        }
    },
    shapeUnknown: () => "Shape not known until the problems above are fixed",
    countRows: ({ count, rows }) => `${count} ${rows}`,
    rows: ({ adjective, noun }) => (adjective === "" ? noun : `${adjective} ${noun}`),
    fieldsAdded: ({ fields }) => `+ ${fields}`,
    gives: ({ shape }) => `Gives ${shape.length === 0 ? shape : shape.charAt(0).toLowerCase() + shape.slice(1)}`,

    match: ({ match }) => match,
    ofThese: ({ match }) => (match === "any" ? "of these is true" : "of these are true"),
    joiner: ({ match }) => (match === "any" ? "or" : "and"),
    find: () => "find",
    inDataset: () => "in",
    bringIn: () => "bring in",
    leftEmpty: ({ noun }) => `Left empty when a ${noun} isn't found.`,
    by: () => "by",
    thenTotal: ({ first }) => (first ? "then" : "and"),
    as: () => "as",
    per: () => "per",
    allRowsTogether: () => "all rows together",
    givesOneWholeNumber: () => "gives one whole number",
    where: () => "where",
    isMissingUse: () => "is missing, use",
    open: () => "open",
    onePer: ({ item, keeping }) => (keeping === undefined ? `one row per ${item}` : `one row per ${item}, keeping the ${keeping} ID`),
    takeThe: () => "take the",
    of: () => "of",
    everyLevel: ({ fields }) => `every level, keeping ${fields}`,
    inputFrom: ({ input }) => `${input} from`,
    to: () => "to",
    every: () => "every",
    callTheResult: () => "call the result",
    addCondition: () => "Add condition",
    addGroup: () => "Add group",
    addTotal: () => "Add a total",
    addField: () => "Add field",
    remove: () => "Remove",
    removeGroup: () => "Remove group",
    placeholder: ({ slot }) => PLACEHOLDER[slot],
    total: ({ fn }) => {
        switch (fn) {
            case "sum": return "add up";
            case "count": return "count";
            case "mean": return "average";
            case "min": return "lowest";
            case "max": return "highest";
            case "distinct": return "count different";
            case "ratio": return "ratio of";
        }
    },
    direction: ({ dir, kind }) => {
        const [desc, asc] = kind === "date" ? ["newest first", "oldest first"] : kind === "text" ? ["Z to A", "A to Z"] : ["highest first", "lowest first"];
        return dir === "desc" ? desc! : asc!;
    },
    part: ({ part }) => part,
    partExample: ({ part }) => (part === "year" ? "2026" : part === "month" ? "2026-03" : "Tuesday"),
    list: ({ items }) => englishList(items),

    slotLabel: ({ slot }) => SLOT_LABEL[slot],
    slotPlaceholder: ({ slot }) => (takesValue(slot) ? "Type or pick a value" : "Type to filter"),
    slotHint: ({ slot }) => (takesValue(slot) ? "Values from the dataset summary"
        : slot === "add-step" ? "Only steps that fit the current shape"
        : slot === "dataset" ? "The lookup tables this builder reads"
        : takesField(slot) ? "Fields from the checked type"
        : ""),
    slotEmpty: ({ slot }) => (takesValue(slot) ? "Type a value, then press ⏎." : "Nothing matches."),
    fieldsGroup: () => "Fields",
    insideGroup: ({ parent }) => `Inside ${parent}`,
    eachGroup: ({ noun }) => `Each ${noun}`,
    onlyCase: ({ rows }) => `${rows} only`,
    compareGroup: () => "Compare",
    casesGroup: () => "Cases",
    valuesGroup: () => "Values in the data",
    fromDataGroup: () => "From the data",
    yearsGroup: () => "Years in the data",
    monthsGroup: () => "Months in the data",
    itemsGroup: () => "Items",
    lastGroup: () => "How far back",
    typedGroup: () => "Typed",
    matchGroup: () => "Match",
    groupGroup: () => "Group",
    totalGroup: () => "Total",
    orderGroup: () => "Order",
    partGroup: () => "Part",
    datasetsGroup: () => "Lookup tables",
    fromDatasetGroup: ({ dataset }) => `From ${dataset}`,
    inputGroup: () => "Values",
    addStepGroup: () => "Add a step",
    savedGroup: () => "Start from a saved query",
    useTyped: ({ text }) => `Use “${text}”`,
    matchDetail: ({ match }) => (match === "any" ? "at least one holds" : "every condition holds"),
    oneRowOfTotals: () => "one row of totals",
    stat: ({ stat }) => stat,
    startOfMonth: ({ rows }) => `start of month · ${rows}`,
    itemsWord: ({ n }) => (n === 1 ? "item" : "items"),
    entries: ({ count, noun }) => `${count} ${noun}`,

    distinctValues: ({ count, n }) => `${count} ${n === 1 ? "value" : "values"}`,
    casesUsed: ({ count, n }) => `${count} ${n === 1 ? "case" : "cases"}`,
    span: ({ from, to }) => `${from} – ${to}`,
    lengths: ({ from, to }) => `${from}–${to} each`,
    missing: ({ count }) => `${count} missing`,
    summaryJoin: ({ parts }) => parts.join(" · "),

    noRowsHere: ({ shape, verb }) => `${shape} — there are no rows to ${verb} here.`,
    choose: ({ what }) => `Choose ${withArticle(what)}.`,
    what: ({ what }) => what,
    wrongKind: ({ label, kind, what }) => `${capitalised(label)} is ${kind} — pick ${withArticle(what)}.`,
    unknownField: ({ name, labels, more }) => `There's no “${name}” here. The rows have ${labels}${more ? "…" : "."}`,
    onlyCaseHas: ({ rows, label }) => `Only ${rows} have a ${label}.`,
    unknownCase: ({ label, cases, value }) => `${capitalised(label)} can be ${cases} — not “${value}”.`,
    wholeVariant: ({ label }) => `Compare the ${label} case, not the whole value.`,
    chooseComparison: () => "Choose how to compare.",
    enterValue: () => "Enter a value.",
    comparisonNotForKind: ({ cmp, kind }) => `“${cmp}” doesn't work on ${kind}.`,
    enterItems: () => "Enter a whole number of items.",
    enterYear: () => "Enter a year, like 2026.",
    enterMonth: () => "Enter a month, like 2026-03.",
    enterDate: () => "Enter a date, like 2026-03-01.",
    enterLast: ({ unit }) => `Enter a whole number of ${unit}.`,
    notANumber: ({ label, kind, value }) => `${capitalised(label)} is a ${kind} — “${value}” isn't one.`,
    neverEqual: ({ label, value }) => `${capitalised(label)} is a whole number, so it can never equal ${value}.`,
    finishInner: () => "Finish the inner condition.",
    emptyGroup: () => "This group is empty.",
    emptyFilter: () => "Add a condition, or remove this step.",
    notLookupTable: ({ dataset }) => `${capitalised(dataset)} can't be looked up by key.`,
    keyKind: ({ dataset, kind, label, keyKind }) => `${capitalised(dataset)} are found by ${kind} ids, but ${label} is ${withArticle(keyKind)}.`,
    noRecordField: ({ noun, field }) => `${capitalised(noun)} records have no “${field}”.`,
    chooseGroupBy: () => "Choose what to group by.",
    cannotAddUp: ({ label, kind }) => `Can't add up ${label} — it's ${kind}. Pick a number, or count instead.`,
    noLowestHighest: ({ label }) => `${capitalised(label)} has no lowest or highest.`,
    duplicateName: ({ name }) => `Two fields are called ${name}; the last one wins.`,
    keepFirstCount: () => "Keep the first needs a whole number, 1 or more.",
    neverMissing: ({ label }) => `${capitalised(label)} is never missing, so this changes nothing.`,
    noTree: () => "There is no tree to walk here.",
    noCalculation: () => "There is no calculation to try here.",
    emptyRange: () => "The range needs a start below the end and a step above 0.",
    longRange: ({ max }) => `That range gives more than ${max} rows; results will be cut off.`,
    strayBracket: () => "The jq has a stray bracket.",
    unclosedText: () => "A text value is missing its closing quote.",
    unclosedBracket: () => "A bracket is never closed.",
    trailingPipe: () => "The query ends with a pipe.",
    emptyQuery: () => "The query is empty.",
    noDataSource: ({ name }) => `There's no data source called “${name}”.`,
    startFromSource: () => "Start the query from a data source.",
    customJq: () => "Custom jq step.",
    excludedBuiltin: ({ name }) => `${name} isn't available in queries.`,
    rowsMoreThanOnce: () => "Rows can appear more than once.",

    fixNarrow: ({ rows }) => `Keep only ${rows} first`,
    fixUse: ({ label }) => `Use ${label}`,
    fixUnwhole: ({ field }) => `Use .${field}.type`,
    fixRemoveStep: () => "Remove this step",
    fixBindNow: () => "Bind $now, the minute the query is asked",

    describeModel: ({ result, input, from, to, step, fixed }) =>
        `${capitalised(result)} over ${input} from ${from} to ${to} in steps of ${step}${fixed.map(f => `, ${f}`).join("")}`,
    describeFixed: ({ name, value }) => `${name} ${value}`,
    describeAllTotals: ({ totals, source, where }) => `${capitalised(totals)} across ${source}${where}`,
    describeTopGroups: ({ n, groups, sort, source, where }) => `Top ${n} ${groups} by ${sort} from ${source}${where}`,
    describeGroups: ({ totals, group, source, where, sorted }) => `${capitalised(totals)} per ${group} from ${source}${where}${sorted}`,
    describeCount: ({ source, where }) => `Count of ${source}${where}`,
    describeFirst: ({ top, n, source, sort, where, with: withs }) => `${top ? "Top" : "First"} ${n} ${source}${sort}${where}${withs}`,
    describeRows: ({ source, where, with: withs, sorted }) => `${capitalised(source)}${where}${withs}${sorted}`,
    describeWhere: ({ conditions }) => (conditions.length === 0 ? "" : ` where ${conditions.join(" and ")}`),
    describeConditions: ({ match, conditions }) => (match === "any" ? conditions.join(" or ") : englishList(conditions)),
    describeGroup: ({ match, conditions }) => (conditions.length > 1 ? `(${conditions.join(match === "any" ? " or " : " and ")})` : conditions[0] ?? ""),
    describeCondition: ({ field, cmp, value, n }) => {
        // "is in the last … days 7" reads as "is in the last 7 days".
        const unit = unitWords(cmp);
        if (unit !== undefined) return `${field} is in the last ${value} ${unit[n === 1 ? 0 : 1]}`;
        // "is in year 2026" reads better as "is in 2026".
        const words = cmp === "inYear" || cmp === "inMonth" ? "is in" : COMPARISON[cmp];
        return value === "" ? `${field} ${words}` : `${field} ${words} ${value}`;
    },
    chipCondition: ({ field, cmp, value, n }) => {
        // What it holds after its field, the comparison's "is" left out: `Region: NSW`, `Units: more than 1`.
        const unit = unitWords(cmp);
        const held = unit !== undefined ? `in the last ${value} ${unit[n === 1 ? 0 : 1]}`
            : cmp === "eq" ? value
            : `${(cmp === "inYear" || cmp === "inMonth" ? "is in" : COMPARISON[cmp]).replace(/^is /, "")}${value === "" ? "" : ` ${value}`}`;
        return `${capitalised(field)}: ${held}`;
    },
    chipMore: ({ count }) => `+${count}`,
    describeWith: ({ lookups }) => (lookups.length === 0 ? "" : `, with ${lookups.map(l => `${l.fields} from ${l.dataset}`).join(" and ")}`),
    describeSorted: ({ field, desc }) => `, sorted by ${field}${desc ? ", highest first" : ""}`,
    describeBy: ({ field }) => ` by ${field}`,
    describeDrilled: ({ noun, list }) => `${noun} ${list}`,
    describeWalked: ({ noun }) => `every ${noun} in the tree`,
    ellipsis: () => "…",

    outlineLookup: ({ fields, dataset, key }) => `${fields} from ${dataset} by ${key}`,
    outlineGroup: ({ totals, group }) => (group === undefined ? `${totals} of all rows` : `${totals} per ${group}`),
    outlineSort: ({ field, direction }) => `by ${field}, ${direction}`,
    outlineLimit: ({ rows }) => rows,
    outlineFill: ({ field, value }) => `${value} where ${field} is missing`,
    outlineDatePart: ({ part, field, name }) => `the ${part} of ${field} as ${name}`,
    outlineModel: ({ input, from, to, step, fixed }) => `${input} from ${from} to ${to} every ${step}${fixed.map(f => `, ${f}`).join("")}`,

    viewLabel: () => "View",
    view: ({ view }) => (view === "visual" ? "Visual" : "jq"),
    copyJq: () => "Copy jq",
    copied: () => "Copied",
    saveAs: () => "Save…",
    run: () => "Run",
    running: () => "Running",
    runKeys: () => "⌘⏎",
    runTip: () => "Run · ⌘⏎",
    more: () => "More",
    stepsLabel: () => "Steps",
    stepNumber: ({ n }) => n,
    moveUp: () => "Move up",
    moveDown: () => "Move down",
    removeStep: () => "Remove step",
    insertHere: () => "Insert a step here",
    checksClean: () => "Checks clean",
    toFinish: ({ count }) => `${count} to finish`,
    problemCount: ({ count, n }) => `${count} ${n === 1 ? "problem" : "problems"}`,
    warningCount: ({ count, n }) => `${count} ${n === 1 ? "warning" : "warnings"}`,
    typeHover: ({ type, multiplicity }) => `${type} · ${multiplicity}`,
    givesFields: ({ fields }) => (fields.length === 0 ? "" : `· ${fields.join(", ")}`),
    sourceLine: ({ path, kind }) => (kind === "" ? path : `${path} · ${kind}`),
    inputLabel: ({ input }) => INPUT_LABEL[input],
    saveState: ({ state }) => (state === "saved" ? "Saved" : state === "unsaved" ? "Unsaved changes" : "Not saved"),
    unfinishedLeftOut: ({ count, n }) => (n === 1
        ? `${count} unfinished step is left out of the jq until it is finished.`
        : `${count} unfinished steps are left out of the jq until they are finished.`),
    fixSyntaxFirst: () => "Fix the syntax problem first — the visual steps are built from the jq.",
    jqPartsStay: ({ count, n }) => (n === 1
        ? `${count} part of the jq doesn't match a visual step, so it stays as jq.`
        : `${count} parts of the jq don't match a visual step, so they stay as jq.`),
    jqLabel: () => "jq query",
    setGesture: ({ what }) => `Set ${what}`,
    addStepGesture: ({ step }) => `Add ${step}`,
    removeStepGesture: ({ n }) => `Remove step ${n}`,
    moveStepGesture: ({ n, up }) => `Move step ${n} ${up ? "up" : "down"}`,
    editJqGesture: () => "Edit the jq",
    nameGesture: () => "Name the query",

    pane: () => "Query",
    tab: ({ tab }) => (tab === "query" ? "Query" : tab === "datasets" ? "Datasets" : "Library"),
    untitled: ({ source }) => `Untitled ${source} query`,
    savedUnreadable: ({ message }) => `The saved queries couldn't be read: ${message}`,
    queryGone: ({ name }) => `“${name}” isn't saved here`,
    queryGoneHint: () => "It was renamed or removed. Open another from the Library tab, or start a new query from the Datasets tab.",
    sourceThroughIndex: ({ name, index }) => `${capitalised(name)} reads through the index ${index}; bind the record itself to query it.`,
    sourceUnbound: ({ name }) => `${capitalised(name)} isn't bound on this page yet.`,
    rootMissing: ({ name }) => `Reads ${name}, which isn't here`,
    rootElsewhere: ({ path, name }) => `Reads ${path}, not this builder's ${name}`,
    nameTaken: ({ name }) => `Another query took the name ${name} first — choose another.`,
    savedChanged: ({ name, by }) => `${name} changed since this edit began${by === undefined ? "" : ` — last changed by ${by}`}. Discard your changes to see it, or save under another name.`,

    saveQuery: () => "Save query",
    queryName: () => "Query name",
    queryNameMissing: () => "Give the query a name to save it.",
    queryNameHeld: ({ name }) => `${name} is taken`,
    descriptionPlaceholder: () => "What the query answers, in one sentence",
    descriptionGenerated: () => "Generated from the steps · edit to write your own",
    descriptionCount: ({ count, max }) => `${count}/${max} · shown under the name in the library`,
    restoreGenerated: () => "Use generated",
    saveConfirm: () => "Save",
    cancel: () => "Cancel",

    jqCheck: ({ problems, n, warnings, w }) => {
        const warned = `${warnings} ${w === 1 ? "warning" : "warnings"}`;
        if (n > 0) return `${problems} ${n === 1 ? "problem" : "problems"}${w > 0 ? ` · ${warned}` : ""}`;
        return w > 0 ? warned : "Checks clean";
    },
    jqHint: () => "ctrl space · suggestions",
    jqProblemsLabel: () => "Problems",
    jqProblemCode: ({ code, note }) => (note ? "note" : code.replace(/_/g, " ")),
    jqProblemAt: ({ line, column }) => `L${line}:${column}`,
    jqCompletionsLabel: () => "Completions",
    jqCompletionLine: ({ label, detail }) => (detail === "" ? label : `${label} · ${detail}`),
    jqCompletionKeys: () => "↑↓ · ⏎ · esc",

    resultControls: () => "Result controls",
    resultViewLabel: () => "Result view",
    resultView: ({ view }) => (view === "table" ? "Table" : "Tree"),
    resultViewPicked: ({ view }) => (view === "table" ? "Table · picked for many rows" : "Tree · picked for one value"),
    download: () => "Download",
    downloadFormat: ({ format }) => (format === "csv" ? "CSV" : "BEAST2"),
    downloadFormatMeta: ({ format }) => (format === "csv" ? "table" : "typed"),
    downloaded: ({ format, file, count }) => (format === "csv"
        ? `Downloaded ${file} — ${count}, one row per output.`
        : `Downloaded ${file} — the result as the run returned it, with its type.`),
    staleTag: () => "Stale",
    staleResult: () => "The query changed after this run.",
    runAgain: () => "Run again",
    notRunProblems: () => "Not run — the checker found problems",
    notRun: () => "Not run",
    stoppedAfter: ({ seconds }) => `Stopped after ${seconds} s`,
    stoppedHint: () => "Narrow the query, or ask for fewer rows.",
    tooLarge: () => "The result is too large",
    tooLargeHint: ({ bytes, limit }) => `${bytes} is over the ${limit} limit. Total or narrow the query.`,
    needsPlatform: () => "Not run — the query calls a function this server can't run",
    needsPlatformHint: ({ functions }) => `It needs ${functions}.`,
    unreachable: () => "Couldn't reach the server",
    idleTitle: () => "Run the query to see results",
    idleChecks: () => "Checks run as you edit; nothing reads data yet.",
    idleRun: () => "Press Run or ⌘⏎ to read the datasets the query uses.",
    idleRunPhone: () => "Press Run to read the datasets the query uses.",
    clearTheSearch: () => "Clear the search",
    reading: ({ sources }) => `Reading ${sources}`,
    runningWord: () => "Running…",
    noResult: () => "No result",
    noResultYet: () => "No result yet",
    showing: ({ shown, total }) => `Showing 1–${shown} of ${total}`,
    atLeast: ({ count }) => `${count}+`,
    runLine: ({ n, time, ms }) => `run #${n} · ${time} · ${ms} ms`,
    readsLine: ({ sources }) => (sources.length === 0 ? "" : `reads ${sources.map(s => `${s.name} #${s.hash}`).join(" · ")}`),
    rowCount: ({ count, n }) => `${count} ${n === 1 ? "row" : "rows"}`,
    oneValue: () => "1 value",
    byteSize: ({ value, unit }) => `${value} ${unit}`,
    duration: ({ value, unit }) => `${value} ${unit}`,

    planBadge: ({ kind, detail }) => {
        if (kind === "one_shot") return "One call";
        const word = kind === "rekey" ? "Re-keyed join" : "Split call";
        return detail === "" ? word : `${word} · ${detail}`;
    },
    planTitle: () => "How this run reads its data",
    notRunYet: () => "not run",
    thisResult: () => "This result",
    thisResultQuery: () => "Query",
    thisResultGives: () => "Gives",
    thisResultRun: () => "Run",
    thisResultReads: () => "Reads",
    thisResultPlan: () => "Plan",
    dismissNotice: () => "Dismiss",
    queryEyebrow: ({ state, n, count }) => (n === 0 ? `${state} · no steps` : `${state} · ${count} ${n === 1 ? "step" : "steps"}`),
    stepActions: () => "Step actions",
    backToStep: () => "Back to the step",
    removeCondition: () => "Remove condition",
    checkerFound: ({ n, count, text }) => `The checker found ${count} ${n === 1 ? "problem" : "problems"}: ${text.charAt(0).toLowerCase()}${text.slice(1)}`,
    clearSearchEvery: () => "Clear the search to see every query.",
    rowsFromRun: ({ n, time }) => `The rows below are from run #${n} at ${time}.`,
    showProblem: () => "Show the problem",
    thisResultDownload: () => "Download",
    savedAs: ({ slug }) => `Saved as ${slug}.csv or .beast2`,
    readingShort: () => "Reading",
    noStepsYet: () => "No steps yet",
    noStepsAdd: () => "Add a step to narrow, reshape or total the rows.",
    noStepsSaved: () => "Or start from a saved query in Library.",
    openLibrary: () => "Open Library",
    tapDataset: () => "Tap a dataset to start a new query on it.",
    tapQuery: () => "Tap a query to open it and run it.",
    nameLabel: () => "Name",
    nameHelp: () => "A name another query holds is refused; this one's own updates it.",
    descriptionLabel: () => "Description",
    changesCount: ({ n, count }) => `${count} ${n === 1 ? "change" : "changes"}`,
    filterSlot: ({ what }) => `Filter ${what}`,
    quickAddGroup: () => "Quick add",
    moreStepsGroup: () => "More steps",
    atEnd: () => "at the end",
    beforeStep: ({ n }) => `before step ${n}`,
    stepContext: ({ n }) => `Step ${n}`,
    conditionContext: ({ n, c }) => `Step ${n} · condition ${c}`,
    stepFitNote: () => "A step that doesn't fit the rows here says why.",
    savedNotice: ({ name, time }) => `Saved “${name}” · ${time}`,
    planSplit: ({ over, heaviest, bytes, piece }) => (heaviest === over
        ? `Split call over ${over}: it weighs ${bytes}, more than one piece (${piece}).`
        : `Split call over ${over}: ${heaviest}, cut with it, weighs ${bytes}, more than one piece (${piece}).`),
    planCopartitioned: ({ over, names, n }) => `${capitalised(names)} ${n === 1 ? "is" : "are"} cut at the same keys as ${over}: each piece reads only its own keys of ${n === 1 ? "it" : "them"}.`,
    planRekey: ({ name }) => `Re-key: both sides large and unaligned — ${name} weighs more than one piece too.`,
    planRekeyStage: ({ over, name, bytes }) => `First, ${over} is re-keyed by this, about ${bytes}, and each piece then reads ${name} cut at the same keys:`,
    planTop: ({ count, n }) => (n === 1
        ? "The first row of the sort is kept, each piece's and then theirs together, by:"
        : `The first ${count} rows of the sort are kept, each piece's and then theirs together, by:`),
    planFirst: ({ count, n }) => (n === 1
        ? "The first row, in input order, is kept: each piece stops at its first, and the call once the pieces before the rest have one:"
        : `The first ${count} rows, in input order, are kept: each piece stops once it has ${count}, and the call once the pieces before the rest have them:`),
    planSmall: ({ over, bytes, piece }) => `One call: ${over} weighs ${bytes}, within one piece (${piece}).`,
    planUnweighed: ({ over }) => `One call: what ${over} weighs isn't known.`,
    planSplitBy: ({ over, why }) => (why === "time"
        ? `Split call over ${over}: estimated faster than one call.`
        : why === "memory"
            ? `Split call over ${over}: one call would hold more memory than it may use.`
            : `Split call over ${over}: one call's answer was too large for one, and a split call's is read a page at a time.`),
    planFaster: ({ over }) => `One call: estimated faster than a split call over ${over}.`,
    planEstimateOneCall: ({ seconds, peak, memory, over }) => {
        const may = memory === undefined ? "" : over ? `, more than the ${memory} it may use` : `, within the ${memory} it may use`;
        return `As one call: about ${seconds}, holding about ${peak}${may}.`;
    },
    planEstimateSplit: ({ rekey, seconds, pieces, n, cores, peak }) => {
        const cut = `${pieces} ${n === 1 ? "piece" : "pieces"}`;
        return rekey
            ? `As a re-keyed join: about ${seconds}, two calls of ${cut}, ${cores} at a time, each holding about ${peak}.`
            : `As a split call: about ${seconds}, ${cut}, ${cores} at a time, each holding about ${peak}.`;
    },
    planAssumed: ({ rows, n, over, first, oneCall, piece, held }) => {
        const holding = held === undefined ? "" : `, one call holding every row at about ${held} each`;
        const stopping = first === undefined ? "" : first.n === 1 ? "; both paths stop after the first" : `; both paths stop after the first ${first.count}`;
        return `Assumed: ${rows} ${n === 1 ? "row" : "rows"} of ${over}, each about ${oneCall} µs in one call and ${piece} µs in a piece${holding}${stopping}.`;
    },
    planUnsplit: ({ message }) => `One call: the split call couldn't be made — ${message}`,
    planWhole: ({ code, name, at }) => {
        const end = at ? ":" : ".";
        switch (code) {
            case "no_stream":
                return name === undefined
                    ? "One call: it reads a count, a key or a value, and works through no data source's rows."
                    : `One call: it reads a count, a key or a value of ${name}, and works through none of its rows.`;
            case "nested": return `One call: it works through rows inside an expression, not as its own pipeline${end}`;
            case "stops_early":
                return at
                    ? "One call: it keeps only its first outputs, and one call stops as soon as it has them:"
                    : `One call: its outputs stream from ${name ?? "a data source"}, and one call stops once it has as many as a run returns.`;
            case "position": return `One call: it takes rows by their position, and one call reads only as far as it needs${end}`;
            case "every_row": return `One call: a step needs every row at once, and no work is done row by row before it${end}`;
            case "state": return `One call: a step carries state from row to row${end}`;
            case "calls": return `One call: the work on each row calls a function value, which may call a platform function the runner doesn't load${end}`;
            case "reads_again": return `One call: it reads ${name ?? "a data source"} again, outside the rows it works through${end}`;
            case "key": return `One call: it groups by a key that isn't one value a lookup table can hold${end}`;
            case "shape": return `One call: it isn't a pipeline the planner splits${end}`;
        }
    },
    planPiece: ({ over }) => `Each piece of ${over} runs:`,
    planCombine: ({ kind }) => PLAN_COMBINE[kind],
    planTotal: ({ rule }) => PLAN_TOTAL[rule],
    planThen: () => "Then, once, over what they combine to:",
    planBroadcast: ({ names }) => `Every piece reads ${names} whole.`,
    planPieces: ({ over, count, n, size }) => `${capitalised(over)} is cut into ${count} ${n === 1 ? "piece" : "pieces"}, about ${size} each.`,
    planPieceCount: ({ count, n }) => `${count} ${n === 1 ? "piece" : "pieces"}`,
    planCachedCount: ({ count, n, whole }) => (whole ? "all cached" : `${count} ${n === 1 ? "unit" : "units"} cached`),
    planUnits: ({ kind, cached, ran, units, n }) => {
        switch (kind) {
            case "whole": return "The cache served the whole call: no unit ran.";
            case "some": return `The cache served ${cached} of its ${units} ${n === 1 ? "unit" : "units"}, and ${ran} ran.`;
            case "none": return n === 1 ? "Its one unit ran: the cache didn't hold it." : `All ${units} of its units ran: the cache held none.`;
        }
    },
    planProgress: ({ phase, done, units, n }) => `${done} of ${units} ${PLAN_UNITS[phase][n === 1 ? 0 : 1]} done`,
    planPruning: ({ kind, name }) => (kind === "count" ? `Reads the count from the index of ${name}, and no segment:`
        : kind === "seek" ? `Reads only the segment of ${name} that holds the key:`
            : `Reads only the segments of ${name} it reaches before it stops:`),

    resultValue: () => "value",
    resultMissing: () => "—",
    resultList: ({ count, noun }) => `${count} ${noun}`,
    resultEntries: ({ count, n }) => `${count} ${n === 1 ? "entry" : "entries"}`,
    resultGrid: ({ rows, cols }) => `${rows} × ${cols}`,
    resultJoin: ({ parts }) => parts.join(" · "),
    resultFunction: () => "function",

    datasetGroup: ({ kind }) => (kind === "rows" ? "Rows" : kind === "lookups" ? "Lookups" : kind === "values" ? "Values" : "Models"),
    dataSourceNoun: ({ n }) => (n === 1 ? "data source" : "data sources"),
    sourceRows: ({ count, noun }) => `${count} ${noun}`,
    sourceLookup: ({ count, noun }) => `${count} ${noun} by ID`,
    sourceTree: () => "one tree",
    sourceRecord: () => "one record",
    sourceModel: ({ inputs, output }) => `${inputs} → ${output}`,
    sourceMeta: ({ size, hash }) => (hash === undefined ? size : size === "" ? `#${hash}` : `${size} · #${hash}`),
    sourceRole: ({ role }) => (role === "source" ? "Source" : "Looked up"),
    savedNoun: ({ n }) => (n === 1 ? "query" : "queries"),
    recentGroup: () => "Recent",
    startedOn: ({ name }) => `Started a new query on ${name}.`,
    openedFromLibrary: ({ name }) => `Opened “${name}” from the library.`,
    openedFromQueryLibrary: ({ name }) => `Opened “${name}” from the query library.`,
    opened: ({ name }) => `Opened “${name}”.`,

    dropToOpen: ({ name }) => `Drop to open “${name}”`,
    dropSteps: ({ count, n }) => `${count} ${n === 1 ? "step" : "steps"}.`,
    dropTargetName: () => "the query builder",
    dropRefusedName: ({ reason }) => `the query builder (${reason})`,

    librarySearch: ({ count, n }) => `Search ${count} ${n === 1 ? "query" : "queries"}…`,
    librarySearchLabel: () => "Search queries",
    clearSearch: () => "Clear search",
    librarySort: ({ sort }) => `Sort · ${sort === "recent" ? "Recent" : "Name"}`,
    librarySortOption: ({ sort }) => (sort === "recent" ? "Recent" : "Name"),
    newQueryOn: ({ source }) => `New query on ${source}`,
    newQuery: () => "New query",
    dataSources: () => "Data sources",
    allQueries: () => "All queries",
    openInBuilder: () => "Open in builder →",
    libraryByline: ({ source, steps, gives, when, run }) => [
        source,
        steps === undefined ? "jq" : `${steps.count} ${steps.n === 1 ? "step" : "steps"}`,
        gives.length === 0 ? gives : gives.charAt(0).toLowerCase() + gives.slice(1),
        `${run ? "ran" : "saved"} ${when}`,
    ].filter((part) => part !== "").join(" · "),
    moreSteps: ({ count }) => `+${count} more`,
    jqProgram: () => "jq",
    noMatch: ({ text }) => `No queries match “${text}”`,
    checkSpelling: () => "Check the spelling",
    clearFilter: () => "Clear the filter to search every query",
    searchWhat: () => "Search by query name, description or data source",
    noQueries: () => "No queries yet",
    saveInBuilder: () => "Save a query in the builder",
    noRecent: () => "No recent runs",
    runInBuilder: () => "Run a query in the builder to see it here",
};
