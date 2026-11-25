/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A box of a fixed height that holds one line of words (#1636): its line is
 * the room inside its edge, so the words start a whole number of pixels under
 * the edge and the two land on the screen's pixels together. The Record's
 * chips, its legend's, its initials, its title's count and its checkbox are
 * each such a box at every density, and so are the other chips and key caps:
 * a tag's chip, the rail's search hint, the bare `kbd`, every control of a
 * toolbar's row that holds words (a chip, a segment, a stepper, the Sheet's
 * tabs), and the Sheet's insert choices, its small tags and its action menu's
 * key caps. No part of their recipes centres a line of `1` in a fixed height
 * again. What the page lays out from them is measured in the browser
 * (`record-cells.spec.ts`, `one-line-words.spec.ts`).
 *
 * The other small boxes (#1638) hold more than their one line of words, or
 * stand in a row that centres them: each takes a whole line that leaves an
 * even number of pixels over in its room (`centredLine`), a line its box's own
 * height, or is a one-line box. Every example of the showcase is measured for
 * it in the browser (`box-rows.spec.ts`).
 *
 * Words that stand in a toolbar's row with no control around them (#1775) —
 * what a Save is doing, a title, a readout, a state's word — take the row's
 * own line, by one rule of the theme's (`toolbar-row.ts`): what a held Save's
 * words lay out is measured in the browser (`toolbar-words.spec.ts`), and
 * every example's row at rest with the small boxes.
 */

import { describe, expect, test } from "vitest";
import { globalCss } from "./global-css.js";
import { centredLine, oneLineBox } from "./one-line-box.js";
import { chipRecipe } from "./recipes/chip.js";
import { allocationBuilderSlotRecipe } from "./slot-recipes/allocationBuilder.js";
import { allocationInspectorSlotRecipe } from "./slot-recipes/allocationInspector.js";
import { avatarSlotRecipe } from "./slot-recipes/avatar.js";
import { builderFooterLineSlotRecipe, builderFooterSlotRecipe } from "./slot-recipes/builder-footer.js";
import { builderFrameSlotRecipe } from "./slot-recipes/builderFrame.js";
import { calendarSlotRecipe } from "./slot-recipes/calendar.js";
import { chipRailSlotRecipe } from "./slot-recipes/chipRail.js";
import { dateFieldSlotRecipe } from "./slot-recipes/dateField.js";
import { dockSlotRecipe } from "./slot-recipes/dock.js";
import { editConflictsSlotRecipe } from "./slot-recipes/editConflicts.js";
import { editHistorySlotRecipe } from "./slot-recipes/editHistory.js";
import { comboboxSlotRecipe } from "./slot-recipes/combobox.js";
import { studioPublishSlotRecipe } from "./slot-recipes/studioPublish.js";
import { editableChipSlotRecipe } from "./slot-recipes/editableChip.js";
import { flowchartSlotRecipe } from "./slot-recipes/flowchart.js";
import { iconButtonSlotRecipe } from "./slot-recipes/iconButton.js";
import { librarySlotRecipe } from "./slot-recipes/library.js";
import { loadingSlotRecipe } from "./slot-recipes/loading.js";
import { matrixSlotRecipe } from "./slot-recipes/matrix.js";
import { metricChipSlotRecipe } from "./slot-recipes/metricChip.js";
import { planSlotRecipe } from "./slot-recipes/plan.js";
import { queryBuilderSlotRecipe } from "./slot-recipes/queryBuilder.js";
import { queryLibrarySlotRecipe } from "./slot-recipes/queryLibrary.js";
import { queryPhoneSlotRecipe } from "./slot-recipes/queryPhone.js";
import { queryResultsSlotRecipe } from "./slot-recipes/queryResults.js";
import { recordSlotRecipe } from "./slot-recipes/record.js";
import { reviewChromeSlotRecipe } from "./slot-recipes/reviewChrome.js";
import { rosterBuilderSlotRecipe } from "./slot-recipes/rosterBuilder.js";
import { segSlotRecipe } from "./slot-recipes/seg.js";
import { segmentGroupSlotRecipe } from "./slot-recipes/segmentGroup.js";
import { selectSlotRecipe } from "./slot-recipes/select.js";
import { sheetSlotRecipe } from "./slot-recipes/sheet.js";
import { sheetActionSlotRecipe } from "./slot-recipes/sheetAction.js";
import { sheetInspectorSlotRecipe } from "./slot-recipes/sheetInspector.js";
import { sliceFrameSlotRecipe } from "./slot-recipes/sliceFrame.js";
import { snapGridSlotRecipe } from "./slot-recipes/snapGrid.js";
import { statusSlotRecipe } from "./slot-recipes/status.js";
import { stepperSlotRecipe } from "./slot-recipes/stepper.js";
import { studioInspectorSlotRecipe } from "./slot-recipes/studioInspector.js";
import { studioLibrarySlotRecipe } from "./slot-recipes/studioLibrary.js";
import { studioPhoneSlotRecipe } from "./slot-recipes/studioPhone.js";
import { studioVisualSlotRecipe } from "./slot-recipes/studioVisual.js";
import { tableSlotRecipe } from "./slot-recipes/table.js";
import { tagSlotRecipe } from "./slot-recipes/tag.js";
import { tagsInputSlotRecipe } from "./slot-recipes/tagsInput.js";
import { timeNavigatorSlotRecipe } from "./slot-recipes/timeNavigator.js";
import { traceSlotRecipe } from "./slot-recipes/trace.js";
import { valueTreeSlotRecipe } from "./slot-recipes/valueTree.js";
import { IN_TOOLBAR_ROW, ON_TOOLBAR_LINE, TOOLBAR_CONTROL_HEIGHT, TOOLBAR_WORDS, TOOLBAR_WORDS_LINE, toolbarControlBox } from "./toolbar-row.js";

type Styles = Readonly<Record<string, unknown>>;

/** Whether a value is a style object: a slot's styles, or a rule nested in them. */
const isStyles = (value: unknown): value is Styles => value !== null && typeof value === "object" && !Array.isArray(value);

/** The Record's slots at rest. */
const base = recordSlotRecipe.base as Readonly<Record<string, Styles>>;

/** What a density changes of each slot. */
const densities = (recordSlotRecipe.variants as { readonly density: Readonly<Record<string, Readonly<Record<string, Styles>>>> }).density;

/** A slot's height and its line's at a density: the density's own where it sets them, else the slot's at rest. */
const box = (slot: string, density: string): readonly [unknown, unknown] => {
    const styles = { ...base[slot], ...densities[density]![slot] };
    return [styles.height, styles.lineHeight];
};

describe("a one-line box", () => {
    test("its line is the room inside its edge: the height less the edge at the top and at the bottom", () => {
        expect(oneLineBox(22)).toEqual({ height: "22px", lineHeight: "20px" });
        expect(oneLineBox(15)).toEqual({ height: "15px", lineHeight: "13px" });
        expect(oneLineBox(44, 1.5)).toEqual({ height: "44px", lineHeight: "41px" });
    });

    test("a box with no edge has a line its own height", () => {
        expect(oneLineBox(16, 0)).toEqual({ height: "16px", lineHeight: "16px" });
    });

    test("the Record's chip is one at every density: 22 tall with a 20 line, 15 with a 13 line at compact and condensed", () => {
        expect(box("chip", "comfortable")).toEqual(["22px", "20px"]);
        expect(box("chip", "compact")).toEqual(["15px", "13px"]);
        expect(box("chip", "condensed")).toEqual(["15px", "13px"]);
    });

    test("the Record's initials are one at every density: 24 tall with a 22 line, 20 with an 18 line at compact and condensed", () => {
        expect(box("avatar", "comfortable")).toEqual(["24px", "22px"]);
        expect(box("avatar", "compact")).toEqual(["20px", "18px"]);
        expect(box("avatar", "condensed")).toEqual(["20px", "18px"]);
    });

    test("the Record's legend chip, its title's count and its checkbox are each one", () => {
        for (const density of Object.keys(densities)) {
            expect(box("legendChip", density), density).toEqual(["15px", "13px"]);
            expect(box("titleCount", density), density).toEqual(["16px", "16px"]);
            expect(box("box", density), density).toEqual(["14px", "12px"]);
            expect(box("tick", density), density).toEqual(["14px", "12px"]);
        }
    });

    test("a density that changes a one-line box's height sets its line with it", () => {
        const stale = Object.entries(densities).flatMap(([density, slots]) => Object.entries(slots)
            .filter(([slot, styles]) => "height" in styles && "lineHeight" in base[slot]! && !("lineHeight" in styles))
            .map(([slot]) => `${slot} at ${density}`));
        expect(stale).toEqual([]);
    });

    test("no part of the Record's recipe centres a line of 1 in a fixed height: its words would start at a fraction of a pixel under its edge", () => {
        const found: string[] = [];
        const walk = (where: string, styles: Styles): void => {
            const line = styles.lineHeight;
            if (typeof styles.height === "string" && /^[\d.]+px$/.test(styles.height) && (line === "1" || line === 1)) found.push(where);
            for (const [key, value] of Object.entries(styles)) if (isStyles(value)) walk(`${where} › ${key}`, value);
        };
        for (const [slot, styles] of Object.entries(base)) walk(slot, styles);
        for (const [density, slots] of Object.entries(densities)) for (const [slot, styles] of Object.entries(slots)) walk(`${slot} at ${density}`, { ...base[slot], ...styles });
        // An icon's own square (`fontAwesomeSize`) is as tall as its glyph: a line of 1 is the square.
        expect(found.filter((where) => !/svg$/.test(where))).toEqual([]);
    });
});

/** A part's styles, or a rule nested in them, by the keys down to it. */
const at = (styles: unknown, ...keys: string[]): Styles => {
    let found = styles;
    for (const key of keys) found = (found as Readonly<Record<string, unknown>>)[key];
    if (!isStyles(found)) throw new Error(`no styles at ${keys.join(" › ")}`);
    return found;
};

/** A part's height and its line's. */
const sized = (styles: Styles): readonly [unknown, unknown] => [styles.height, styles.lineHeight];

describe("a control of a toolbar's row that holds words", () => {
    test("is a one-line box as tall as every control there: its line 26 inside an edge, 28 with none", () => {
        expect(TOOLBAR_CONTROL_HEIGHT).toBe("28px");
        expect(toolbarControlBox()).toEqual({ height: "28px", lineHeight: "26px" });
        expect(toolbarControlBox(0)).toEqual({ height: "28px", lineHeight: "28px" });
    });

    test("a chip is one in the row, in its 1px edge", () => {
        expect(sized(at(chipRecipe.base, IN_TOOLBAR_ROW))).toEqual(["28px", "26px"]);
    });

    test("a segment fills its strip's 26 of room in the row, its label on a line as tall, and its icon an even glyph in it", () => {
        expect(at(segSlotRecipe.base, "root", IN_TOOLBAR_ROW).height).toBe("28px");
        expect(at(segSlotRecipe.base, "item", IN_TOOLBAR_ROW)).toEqual({ paddingBlock: "0", lineHeight: "26px", "& svg": { fontSize: "10px" } });
    });

    test("a segment centres what it holds, its icon an odd glyph on its odd 13px line outside a row, and holding its icon alone it is as tall as one holding words", () => {
        const item = at(segSlotRecipe.base, "item");
        expect([item.display, item.alignItems, item.justifyContent]).toEqual(["inline-flex", "center", "center"]);
        expect([item.lineHeight, item.paddingBlock, item.minHeight]).toEqual(["13px", "5px", "23px"]);
        expect(at(item, "& svg")).toEqual({ flex: "none", fontSize: "11px" });
    });

    test("the Studio preview's device icon is an even glyph in the even 26px of its device, out of the line's baseline", () => {
        expect(at(studioPublishSlotRecipe.base, "deviceIcon")).toEqual({ display: "inline-flex", fontSize: "10px" });
    });

    test("a stepper is one at both sizes, in its 1px edge", () => {
        expect(sized(at(stepperSlotRecipe.variants, "size", "sm", "root"))).toEqual(["28px", "26px"]);
        expect(sized(at(stepperSlotRecipe.variants, "size", "md", "root"))).toEqual(["28px", "26px"]);
    });

    test("the Sheet's tabs are each one: a tab, `+n` and the folded strip with no edge, `+ TAB` in its 1px edge", () => {
        const sheet = sheetSlotRecipe.base;
        expect(sized(at(sheet, "tab"))).toEqual(["28px", "28px"]);
        expect(sized(at(sheet, "tabMore"))).toEqual(["28px", "28px"]);
        expect(sized(at(sheet, "tabMenu"))).toEqual(["28px", "28px"]);
        expect(sized(at(sheet, "tabAdd"))).toEqual(["28px", "26px"]);
    });
});

describe("words that stand in a toolbar's row with no control around them", () => {
    test("are set as the row's chips and its date are, in a box of the row's height whose line is as tall: their baseline is the chips'", () => {
        expect(TOOLBAR_WORDS).toEqual({ fontFamily: "mono", fontSize: "11.5px", whiteSpace: "nowrap", height: "28px", lineHeight: "28px" });
        // A chip's face and size in the row, its line the room inside its edge; the date's.
        expect([chipRecipe.base?.fontFamily, chipRecipe.base?.fontSize]).toEqual([TOOLBAR_WORDS.fontFamily, `min(var(--cr-fs, 12px), ${TOOLBAR_WORDS.fontSize})`]);
        const date = at(timeNavigatorSlotRecipe.base, "trigger");
        expect([date.fontFamily, date.fontSize]).toEqual([TOOLBAR_WORDS.fontFamily, TOOLBAR_WORDS.fontSize]);
    });

    test("what a Save is doing, and the Record's last gesture, are those words: one rule, each part adding its own ink", () => {
        expect(at(editHistorySlotRecipe.base, "status")).toMatchObject({ ...TOOLBAR_WORDS, color: "fg.muted" });
        expect(at(recordSlotRecipe.base, "status")).toMatchObject({ ...TOOLBAR_WORDS, color: "fg.muted" });
    });

    test("in a phone's row, what a Save is doing stands where the drafts' count stands, as it does: its face's size, on the line of its box", () => {
        const history = editHistorySlotRecipe.base;
        expect(at(history, "status", "[data-history-form=phone] &")).toEqual({ fontSize: "label.lg", height: "24px", lineHeight: "24px" });
        // The count, a chip or not, and the box that holds either.
        expect([at(history, "changes").fontSize, at(history, "changes").lineHeight, at(history, "summary").height]).toEqual(["label.lg", "24px", "24px"]);
        expect(at(history, "changes", "&[data-changes]").lineHeight).toBeUndefined();
    });

    test("words in a face of their own take the row's line: the Snap grid's saved time and its readout, the Record's title, the Calendar's count", () => {
        expect(TOOLBAR_WORDS_LINE).toBe("28px");
        expect(at(snapGridSlotRecipe.base, "saved").lineHeight).toBe(TOOLBAR_WORDS_LINE);
        expect(at(snapGridSlotRecipe.base, "readout").lineHeight).toBe(TOOLBAR_WORDS_LINE);
        expect(at(recordSlotRecipe.base, "titleText").lineHeight).toBe(TOOLBAR_WORDS_LINE);
        expect(at(calendarSlotRecipe.base, "toolbarText").lineHeight).toBe(TOOLBAR_WORDS_LINE);
    });

    test("a part that stands elsewhere too takes the row's line in the row alone: a state's word, a filter group's name, the Library's grouping, secondary fact and caption", () => {
        expect(ON_TOOLBAR_LINE).toEqual({ [IN_TOOLBAR_ROW]: { lineHeight: TOOLBAR_WORDS_LINE } });
        const parts: ReadonlyArray<readonly [string, Styles]> = [
            ["a state's word", at(statusSlotRecipe.base, "label")],
            ["a filter group's name", at(sliceFrameSlotRecipe.base, "railGroupLabel")],
            ["the Library's grouping", at(librarySlotRecipe.base, "groupTrigger")],
            ["the Library's secondary fact", at(librarySlotRecipe.base, "dimTrigger")],
            ["the Library's caption", at(librarySlotRecipe.base, "hint")],
        ];
        for (const [part, styles] of parts) expect(at(styles, IN_TOOLBAR_ROW), part).toEqual({ lineHeight: TOOLBAR_WORDS_LINE });
        // Its own line outside a row: a state's word keeps the 13 its odd rooms centre.
        expect(at(statusSlotRecipe.base, "label").lineHeight).toBe("13px");
    });
});

describe("a chip or a key cap", () => {
    test("a tag's chip is a one-line box: 22 tall with a 20 line, the typed box beside it as tall", () => {
        expect(sized(at(tagsInputSlotRecipe.base, "itemPreview"))).toEqual(["22px", "20px"]);
        expect(at(tagsInputSlotRecipe.base, "input").height).toBe("22px");
    });

    test("the rail's search hint is one: 16 tall with a 14 line", () => {
        expect(sized(at(sliceFrameSlotRecipe.base, "searchKbd"))).toEqual(["16px", "14px"]);
    });

    test("a bare kbd is one: 20 tall with an 18 line", () => {
        expect(sized(at(globalCss, "kbd"))).toEqual(["20px", "18px"]);
    });

    test("the Sheet action menu's key cap is one: 20 tall with an 18 line", () => {
        expect(sized(at(sheetActionSlotRecipe.base, "menuKbd"))).toEqual(["20px", "18px"]);
    });

    test("the Sheet's insert choice, its checkbox, its toolbar badge, its lock tags and a phone's band status are each one", () => {
        const sheet = sheetSlotRecipe.base;
        expect(sized(at(sheet, "insertChoice"))).toEqual(["22px", "20px"]);
        expect(sized(at(sheet, "checkbox"))).toEqual(["14px", "12px"]);
        expect(sized(at(sheet, "toolbarBadge"))).toEqual(["20px", "20px"]);
        expect(sized(at(sheet, "lockTag"))).toEqual(["20px", "20px"]);
        expect(sized(at(sheet, "lockWarn"))).toEqual(["20px", "20px"]);
        expect(sized(at(sheet, "groupCell", "[data-sheet-card][data-phone] &"))).toEqual(["22px", "22px"]);
        // A half's label is as tall as a chip, its words on its cell's line: no edge of its own to stand them in.
        expect(sized(at(sheet, "halfLabel"))).toEqual(["20px", "inherit"]);
    });

    test("none of their recipes centres a line of 1 in a fixed height: its words would start at a fraction of a pixel under its edge", () => {
        const found: string[] = [];
        const walk = (where: string, styles: Styles): void => {
            const line = styles.lineHeight;
            // An icon's own square (`fontAwesomeSize`) is as tall as its glyph: a line of 1 is the square.
            const square = styles.height === styles.fontSize;
            if (typeof styles.height === "string" && /^[\d.]+px$/.test(styles.height) && (line === "1" || line === 1) && !square) found.push(where);
            for (const [key, value] of Object.entries(styles)) if (isStyles(value)) walk(`${where} › ${key}`, value);
        };
        const recipes = {
            chip: chipRecipe, seg: segSlotRecipe, stepper: stepperSlotRecipe, sheet: sheetSlotRecipe, sheetAction: sheetActionSlotRecipe,
            sliceFrame: sliceFrameSlotRecipe, tagsInput: tagsInputSlotRecipe, kbd: { base: at(globalCss, "kbd") },
        };
        for (const [name, recipe] of Object.entries(recipes)) {
            walk(`${name} at rest`, at(recipe, "base"));
            if ("variants" in recipe) walk(`${name}'s variants`, at(recipe, "variants"));
        }
        expect(found).toEqual([]);
    });
});

describe("a line of words centred in a room taller than it (#1638)", () => {
    test("is a whole number of pixels that leaves an even number over: half above the words, half below", () => {
        expect(centredLine(24, 14)).toBe("14px");
        expect(centredLine(31, 19)).toBe("19px");
        expect(centredLine(22, 22)).toBe("22px");
    });

    test("is refused where it would start the words at a fraction: a line or a room a fraction of a pixel tall, or an odd pixel left over", () => {
        expect(() => centredLine(24, 14.25)).toThrow(RangeError);
        expect(() => centredLine(21.5, 14)).toThrow(RangeError);
        expect(() => centredLine(28, 15)).toThrow(RangeError);
    });

    test("in a part that stands in rooms of several sizes, holds in every one, and is refused in the one of the other parity (#1646's review)", () => {
        expect(centredLine([36, 32, 28], 14)).toBe("14px");
        expect(() => centredLine([26, 30, 41], 16)).toThrow(/centred in 41px of room/);
    });
});

describe("the small boxes whose words are centred in them (#1638)", () => {
    const plan = planSlotRecipe.base;
    const roster = rosterBuilderSlotRecipe.base;
    const allocation = allocationBuilderSlotRecipe.base;
    const sheet = sheetSlotRecipe.base;
    const record = recordSlotRecipe.base;

    /** Each part and the line its words stand on: a whole number of pixels of its room's parity, or its box's own height. */
    const lines: ReadonlyArray<readonly [string, Styles, string]> = [
        ["a segment's label", at(segmentGroupSlotRecipe.base, "itemText"), "14px"],
        ["a segment's label, xs", at(segmentGroupSlotRecipe.variants, "size", "xs", "itemText"), "12px"],
        ["a segment's label, sm", at(segmentGroupSlotRecipe.variants, "size", "sm", "itemText"), "14px"],
        ["a segment's label, md", at(segmentGroupSlotRecipe.variants, "size", "md", "itemText"), "14px"],
        ["a segment's label, lg", at(segmentGroupSlotRecipe.variants, "size", "lg", "itemText"), "16px"],
        ["a Select's value, sm", at(selectSlotRecipe.variants, "size", "sm", "valueText"), "16px"],
        ["a Select's value, md", at(selectSlotRecipe.variants, "size", "md", "valueText"), "16px"],
        ["a Select's value, lg", at(selectSlotRecipe.variants, "size", "lg", "valueText"), "18px"],
        ["the status word", at(statusSlotRecipe.base, "label"), "13px"],
        ["the builders' footer line", at(builderFooterLineSlotRecipe.base, "root"), "15px"],
        ["every builder's footer (east-workspace#1748)", at(builderFooterSlotRecipe.base, "root"), "15px"],
        ["a Matrix segment's label", at(matrixSlotRecipe.base, "seg"), "14px"],
        ["a Trace step's value, comfortable", at(traceSlotRecipe.variants, "density", "comfortable", "step"), "12px"],
        ["an icon button's count", at(iconButtonSlotRecipe.base, "badge"), "10px"],
        ["an avatar's initials", at(avatarSlotRecipe.base, "fallback"), "100cqh"],
        ["a metric chip, comfortable", at(metricChipSlotRecipe.variants, "density", "comfortable", "root"), "14px"],
        ["a tag, comfortable", at(tagSlotRecipe.variants, "density", "comfortable", "root"), "13px"],
        ["an editable chip, comfortable", at(editableChipSlotRecipe.variants, "density", "comfortable", "root"), "13px"],
        ["a Table's column label, sm: the smallest density's 27px header", at(tableSlotRecipe.variants, "size", "sm", "columnHeaderLabel"), "20px"],
        ["a Table's column label, md", at(tableSlotRecipe.variants, "size", "md", "columnHeaderLabel"), "19px"],
        ["a Table's column label, lg", at(tableSlotRecipe.variants, "size", "lg", "columnHeaderLabel"), "19px"],
        ["a phone Table's column label", at(tableSlotRecipe.base, "phoneHeaderSort"), "19px"],
        ["a phone Table's column group", at(tableSlotRecipe.base, "phoneGroup"), "12px"],
        ["a phone Table's decision column", at(reviewChromeSlotRecipe.base, "decisionHeader", "[data-table-phone] &"), "19px"],
        ["a gallery card's foot", at(librarySlotRecipe.base, "galleryFoot"), "18px"],
        ["a Value tree's row", at(valueTreeSlotRecipe.base, "row"), "20px"],
        ["a Value tree's toolbar button", at(valueTreeSlotRecipe.base, "toolbarBtn"), "18px"],
        ["a Snap grid's column number", at(snapGridSlotRecipe.base, "rulerMark"), "14px"],
        ["a Calendar event's title", at(calendarSlotRecipe.base, "eventTitle"), "16px"],
        ["a Calendar event's detail", at(calendarSlotRecipe.base, "eventDetail"), "12px"],
        ["a Calendar event's resource", at(calendarSlotRecipe.base, "eventResource"), "14px"],
        ["a compact Calendar event's title", at(calendarSlotRecipe.base, "eventTitle", "[data-compact]:not([data-chip]) &"), "100cqh"],
        ["a compact Calendar event's detail", at(calendarSlotRecipe.base, "eventDetail", "[data-compact]:not([data-chip]) &"), "100cqh"],
        ["a compact Calendar event's resource", at(calendarSlotRecipe.base, "eventResource", "[data-compact]:not([data-chip]) &"), "100cqh"],
        ["a Calendar month chip's title", at(calendarSlotRecipe.base, "eventTitle", "[data-chip] &"), "19px"],
        ["a Calendar month chip's detail", at(calendarSlotRecipe.base, "eventDetail", "[data-chip] &"), "19px"],
        ["a Calendar month chip's resource", at(calendarSlotRecipe.base, "eventResource", "[data-chip] &"), "19px"],
        ["a Query step's slot", at(queryBuilderSlotRecipe.base, "slotText"), "16px"],
        ["a conflict's choice, its name", at(editConflictsSlotRecipe.base, "choiceName"), "16px"],
        ["a conflict's choice, its value", at(editConflictsSlotRecipe.base, "choiceValue"), "20px"],
        ["the conflicts' count", at(editHistorySlotRecipe.base, "conflictsCount"), "16px"],
        ["the key search's status", at(comboboxSlotRecipe.base, "searchStatus"), "16px"],
        ["a failed read's line", at(loadingSlotRecipe.base, "failedMessage"), "19px"],
        ["a failed read's line, in the Sheet's smallest density", at(sheetSlotRecipe.variants, "size", "sm", "runRow", "& :is([data-loading-failed-message], [data-loading-empty-message])"), "20px"],
        ["a failed read's line, in a Record on a coarse pointer", at(record, "runRow", "& :is([data-loading-failed-message], [data-loading-empty-message])", "_coarse"), "20px"],
        ["an Allocation resource's bin, in the inspector", at(allocationInspectorSlotRecipe.base, "mate"), "16px"],
        ["a date field's segments, sm", at(dateFieldSlotRecipe.variants, "size", "sm", "input"), "16px"],
        ["a date field's segments, xs", at(dateFieldSlotRecipe.variants, "size", "xs", "input"), "16px"],
        ["a date field's segments, md", at(dateFieldSlotRecipe.variants, "size", "md", "input"), "16px"],
        ["a date field's segments, lg", at(dateFieldSlotRecipe.variants, "size", "lg", "input"), "18px"],
        ["a date field's segments, on a coarse pointer", at(dateFieldSlotRecipe.variants, "size", "md", "input", "_coarse"), "20px"],
        ["a Roster card's small words", at(roster, "assignment"), "14px"],
        ["a Roster card's name", at(roster, "assignmentName"), "18px"],
        ["a Roster column head", at(roster, "shiftLabel"), "16px"],
        ["a Roster column head's figures", at(roster, "shiftMeta"), "16px"],
        ["a Roster person's name", at(roster, "personName"), "19px"],
        ["a Roster month's mark", at(roster, "mark"), "14px"],
        ["a Roster lane's figures", at(roster, "laneLine"), "11px"],
        ["a Plan row's name", at(plan, "gutterName"), "17px"],
        // A laned row's every line, its lane's caption on it, in the row's voice (#1680's review).
        ["a Plan laned row's line", at(plan, "gutterLane"), "17px"],
        ["a Plan group's name", at(plan, "groupName"), "15px"],
        ["a Plan heat value", at(plan, "heatLabel"), "100cqh"],
        ["a Plan table numeral", at(plan, "tableCellText"), "15px"],
        ["a Plan mark's label", at(plan, "markLabel"), "15px"],
        ["a Plan chart tick", at(plan, "chartTickLeft"), "14px"],
        ["a Plan segment's label", at(plan, "segmentPart"), "var(--plan-segment-h)"],
        // The line a tile's parts stand on is its own height (#1735); its words have a line of their own (below).
        ["a Plan tile", at(plan, "tile"), "var(--plan-tile-h)"],
        ["a Plan `+n`", at(plan, "tileMore"), "var(--plan-tile-h)"],
        ["a Plan chip", at(plan, "cardChip"), "calc(var(--plan-chip-h) - 4px)"],
        ["the Plan's `← All rows`", at(plan, "focusBack"), "19px"],
        ["an Allocation chip", at(allocation, "tableChip"), "16px"],
        ["an Allocation placeholder", at(allocation, "tablePlaceholder"), "16px"],
        ["a Record cell", at(record, "cell"), "20px"],
        ["a Record column's label", at(record, "headerLabel"), "14px"],
        ["a Record column's label, on a coarse pointer", at(record, "headerLabel", "_coarse"), "15px"],
        ["the Record's strip", at(record, "strip"), "15px"],
        ["the Record's strip's words: Inter's own 12.5px line, its capitals at the strip's middle (east-workspace#1748)", at(record, "stripText"), "15px"],
        ["a Sheet cell", at(sheet, "cell"), "19px"],
        ["a Sheet cell, at the smallest density", at(sheetSlotRecipe.variants, "size", "sm", "cell"), "20px"],
        ["a Sheet cell, on a coarse pointer", at(sheet, "cell", "_coarse"), "20px"],
        ["a Sheet cell, in a phone's frame", at(sheet, "cell", "[data-sheet-card][data-phone] &"), "19px"],
        ["a Sheet row's number", at(sheet, "gutterNumber"), "19px"],
        ["a Sheet row's number, at the smallest density", at(sheetSlotRecipe.variants, "size", "sm", "gutterNumber"), "20px"],
        ["a Sheet row's number, on a coarse pointer", at(sheet, "gutterNumber", "_coarse"), "20px"],
        ["a Sheet row's number, in a phone's frame", at(sheet, "gutterNumber", "[data-sheet-card][data-phone] &"), "19px"],
        ["a Sheet half's label", at(sheet, "halfLabel"), "inherit"],
        ["a Sheet date editor's segments: the cell's line", at(sheet, "editorDate", "& :has(> [role=spinbutton])"), "inherit"],
        ["the Sheet's strip", at(sheet, "strip"), "15px"],
        ["a Sheet strip's chip: mono's own 13px line, its capitals at the chip's middle (east-workspace#1748)", at(sheet, "stripChip"), "15px"],
        ["the Query builder's status line", at(queryBuilderSlotRecipe.base, "status"), "19px"],
        ["the Query results' footer", at(queryResultsSlotRecipe.base, "footer"), "17px"],
        ["a Query library's row", at(queryLibrarySlotRecipe.base, "paneRow"), "20px"],
        ["a phone Query's Table · Tree", at(queryPhoneSlotRecipe.base, "segItem"), "16px"],
        ["a phone Query's Run", at(queryPhoneSlotRecipe.base, "run"), "18px"],
        ["a Studio library's row", at(studioLibrarySlotRecipe.base, "paneRow"), "20px"],
    ];

    test.each(lines)("%s: its words on a whole line of its room's parity, or its box's own height", (_part, styles, line) => {
        expect(styles.lineHeight).toBe(line);
    });

    /** Each part that is a one-line box, its height and its line: the room inside its edge. */
    const boxes: ReadonlyArray<readonly [string, Styles, string, string]> = [
        ["the Dock's count", at(dockSlotRecipe.base, "badge"), "18px", "16px"],
        ["a Flowchart card's tag", at(flowchartSlotRecipe.base, "tag"), "15px", "13px"],
        ["a Roster agency badge", at(roster, "agencyBadge"), "16px", "14px"],
        ["a Roster skill tag", at(roster, "skillTag"), "16px", "14px"],
        ["an Allocation band's count", at(allocation, "bandCount"), "16px", "16px"],
        ["a Table group head's count", at(tableSlotRecipe.base, "rowCount"), "16px", "16px"],
        ["a metric chip: the 20px DeltaPill in its clear edge", at(metricChipSlotRecipe.base, "root"), "20px", "18px"],
        ["the Allocation inspector's resource field", at(allocationInspectorSlotRecipe.base, "resourceField"), "32px", "30px"],
        ["the Studio preview's device", at(studioPublishSlotRecipe.base, "device"), "26px", "26px"],
        ["the Studio preview's environment", at(studioPublishSlotRecipe.base, "env"), "26px", "24px"],
        ["the Studio preview's Exit", at(studioPublishSlotRecipe.base, "exit"), "28px", "26px"],
        ["a phone inspector's draft chip", at(sheetInspectorSlotRecipe.base, "phoneChip"), "20px", "20px"],
        ["the Allocation inspector's rank", at(allocationInspectorSlotRecipe.base, "rank"), "16px", "16px"],
        ["the Allocation drop list's rank", at(allocationInspectorSlotRecipe.base, "dropRank"), "16px", "16px"],
        ["the Allocation issues' count", at(allocationInspectorSlotRecipe.base, "issueCount"), "16px", "16px"],
        ["an Allocation fit's rank", at(allocation, "rank"), "16px", "16px"],
        ["an Allocation run's label", at(allocation, "runLabel"), "20px", "18px"],
        ["the Allocation's fits marker", at(allocation, "fitsMarker"), "28px", "26px"],
        ["a Query card's wire row", at(queryLibrarySlotRecipe.base, "wireRow"), "17px", "15px"],
        ["a phone Studio's button", at(studioPhoneSlotRecipe.base, "box"), "32px", "30px"],
        ["the Snap grid's chip", at(snapGridSlotRecipe.base, "chip"), "20px", "18px"],
        ["the Snap grid's selected tile's badge", at(snapGridSlotRecipe.base, "tileBadge"), "18px", "18px"],
        ["a Studio pill's aggregate", at(studioInspectorSlotRecipe.base, "pillAgg"), "22px", "22px"],
        ["the Studio's fields' count", at(studioInspectorSlotRecipe.base, "count"), "16px", "16px"],
        ["the Snap grid's drag ghost", at(snapGridSlotRecipe.base, "ghost"), "32px", "30px"],
    ];

    test.each(boxes)("%s is a one-line box", (_part, styles, height, line) => {
        expect(sized(styles)).toEqual([height, line]);
    });

    test("a box whose height its recipe does not know is a size container, its words' line its own height", () => {
        // A bucket cell holds no words: its tiles stand at the whole pixels its row sets (#1735).
        expect(at(plan, "heatCell").containerType).toBe("size");
        expect(at(avatarSlotRecipe.base, "root").containerType).toBe("size");
        // A compact Calendar event, as tall as its duration (#1646's review); a month's chip keeps its own line.
        expect(at(calendarSlotRecipe.base, "event", "&[data-compact]:not([data-chip])").containerType).toBe("size");
    });

    test("a Plan tile's label and its `+n` chip's count stand on a 13px line with a pixel over it, a pixel low in the tile's even room: the face's 13px glyph box a whole 4px under its top edge, its digits 6 | 8 | 6 (#1735)", () => {
        const words = { lineHeight: "13px", paddingTop: "1px" };
        expect(at(plan, "tileLabel")).toMatchObject(words);
        expect(at(plan, "tileMore", "& > [data-tile-more-count]", "& > *")).toMatchObject(words);
        // Nothing trims them to a cap height, which the face's metrics put at a fraction of a pixel.
        expect(JSON.stringify([at(plan, "tileLabel"), at(plan, "tileMore")])).not.toContain("text-box");
    });

    test("a Plan gutter line alone in an even room — a buckets row's 25px lane — stands a pixel low, its glyph box 6px under the lane's top (#1735)", () => {
        expect(at(plan, "gutterName", "&[data-plan-even-room]")).toEqual({ paddingTop: "1px" });
        expect(at(plan, "gutterLane", "&[data-plan-even-room]")).toEqual({ paddingTop: "1px" });
        expect(at(plan, "gutterLane").boxSizing).toBe("border-box");
    });

    test("the Sheet's action cell takes the line of its room's parity, which the Sheet's cell says beside its own (#1646's review)", () => {
        const action = sheetActionSlotRecipe.base;
        for (const part of ["root", "state", "summary", "start", "absent"]) expect(at(action, part).lineHeight, part).toBe("var(--sheet-action-line, 17px)");
        // Odd in the odd rooms — 36px and 42px rows, a phone's 32px and 44px — even in the smallest density's 27px row and a
        // touch screen's 45px, and in the inspector's field.
        expect(at(sheet, "cell")["--sheet-action-line"]).toBe("17px");
        expect(at(sheet, "cell", "[data-sheet-card][data-phone] &")["--sheet-action-line"]).toBe("17px");
        expect(at(sheet, "cell", "_coarse")["--sheet-action-line"]).toBe("16px");
        expect(at(sheetSlotRecipe.variants, "size", "sm", "cell")["--sheet-action-line"]).toBe("16px");
        expect(at(action, "panelState")["--sheet-action-line"]).toBe("16px");
    });

    test("a Sheet cell in a phone's frame keeps its line with its padding: one key, the phone's of the cells' lines (#1646's review)", () => {
        const phone = at(sheet, "cell", "[data-sheet-card][data-phone] &");
        expect([phone.lineHeight, phone.paddingX, phone.paddingY]).toEqual(["19px", "8px", "0"]);
    });

    test("a Plan ruler of one band, on the canvas and on a phone, is the ruler's height less its rule (#1646's review)", () => {
        for (const slot of ["ruler", "narrowRuler"]) {
            expect(at(plan, slot, "&:not([data-time])")["--time-ruler-row-h"], slot).toBe("calc(var(--plan-ruler-h) - 1px)");
        }
    });

    test("a band that centres its row over the rule at its foot has an even room: a pixel of padding over the row balances the rule", () => {
        const frame = builderFrameSlotRecipe.base;
        // The frame's toolbar: 44 less its rule and the pixel over its 28px row, which stands 8px under its top edge. On a
        // coarse pointer it keeps the middle of the 43px over its rule: a control's 44px tap target reaches both edges from there.
        expect([at(frame, "toolbar").height, at(frame, "toolbar").borderBottomWidth, at(frame, "toolbar").paddingTop]).toEqual(["44px", "1px", "1px"]);
        expect(at(frame, "toolbar", "_coarse").paddingTop).toBe("0");
        // A phone's pads nothing over its 44px items, with a mouse as under a finger (#1646's review).
        expect(at(frame, "toolbar", "[data-phone] > &").paddingTop).toBe("0");
        // A phone's second row: 56, its 44px controls 6px under its top edge.
        expect([at(frame, "sessionRow").height, at(frame, "sessionRow").borderBottomWidth, at(frame, "sessionRow").paddingTop]).toEqual(["56px", "1px", "1px"]);
        // A phone Table's column group stands the header's 32 over its rule: one line of 12px 10px under its edge, two 4px.
        expect(at(tableSlotRecipe.base, "phoneGroup", "[data-table-phone] &").paddingY).toBe("1px 0");
        // A conflict's second choice stands under a rule: a pixel under what it holds.
        expect(at(editConflictsSlotRecipe.base, "choice", "& + &").paddingBottom).toBe("1px");
    });

    test("a Record cell has an even room at every pointer, and each part in it an even height: all start a whole number of pixels under the row's edge", () => {
        // A fine pointer's row is 36, 32 or 28 with its rule: a pixel over the cell leaves 34, 30 or 26. A coarse one's is 45: 44 with none.
        expect([at(record, "cell").paddingTop, at(record, "cell", "_coarse").paddingTop]).toEqual(["1px", "0"]);
        const even = (px: unknown) => typeof px === "string" && /^\d+px$/.test(px) && Number.parseInt(px, 10) % 2 === 0;
        for (const slot of ["chip", "avatar", "nobody", "box", "tick", "pip", "markDot", "staleDot", "pendingDot", "lock"]) expect(even(at(record, slot).height), slot).toBe(true);
        expect(even(at(record, "cell").lineHeight)).toBe(true);
        // A compact chip's 15 is odd: a pixel under it stands it as an even part stands.
        for (const density of ["compact", "condensed"]) {
            const chip = at(recordSlotRecipe.variants, "density", density, "chip");
            expect([chip.height, chip.marginBottom], density).toEqual(["15px", "1px"]);
        }
        // The header's box, a pixel above its row's middle: its margin leaves an even number of pixels over at either pointer.
        expect([at(record, "tick", "[data-tick] > &").marginBottom, at(record, "tick", "[data-tick] > &", "_coarse").marginBottom]).toEqual(["2px", "1px"]);
    });

    test("a Studio tile's eyebrow strip centres its row in an even room: a pixel of padding over it balances its rule (#1671)", () => {
        const tile = studioVisualSlotRecipe.base;
        expect([at(tile, "head").height, at(tile, "head").borderBottomWidth, at(tile, "head").paddingTop]).toEqual(["36px", "1px", "1px"]);
        // On a touch screen it stands 44, its room an even 42: its 24px controls stand 10 under its top edge, their 44px tap
        // targets the strip's whole height.
        expect(at(tile, "head", "_coarse").height).toBe("44px");
        // Its name and its meta on a whole, even line: 12 in the 34 and in the 42, and in the 24 of the menu the meta stands beside.
        expect([at(tile, "name").lineHeight, at(tile, "meta").lineHeight]).toEqual(["12px", "12px"]);
    });

    test("a Studio list's row pads its words a whole number of pixels under its edge, and centres none (#1671)", () => {
        const list = studioVisualSlotRecipe.base;
        // A name alone 16 under the row's top, a name over its caption 8; with the ranking bar, 10.
        expect([at(list, "listRow").justifyContent, at(list, "listRow").paddingTop]).toEqual(["flex-start", "16px"]);
        expect(at(list, "listRow", "&[data-caption]").paddingTop).toBe("8px");
        expect(at(list, "listRow", "&[data-bar]").paddingBlock).toBe("10px");
        // Each of its words on a whole line: the name's 16, the caption's 15 a pixel under it, a value's 15 and its unit's 13.
        expect(["listName", "listCaption", "listValue", "listUnit"].map((slot) => at(list, slot).lineHeight)).toEqual(["16px", "15px", "15px", "13px"]);
        expect(at(list, "listText").gap).toBe("1px");
    });

    test("a rail's chip has a whole padding and a whole line at every density: 15, 22 and 33 tall in its edge", () => {
        const of = (density: string) => { const root = at(chipRailSlotRecipe.variants, "density", density, "root"); return [root["--cr-py"], root["--cr-lh"]]; };
        expect(of("condensed")).toEqual(["2px", "9px"]);
        expect(of("compact")).toEqual(["5px", "10px"]);
        expect(of("comfortable")).toEqual(["9px", "13px"]);
        expect(at(tagSlotRecipe.variants, "density", "comfortable", "root").paddingY).toBe("9px");
        expect(at(editableChipSlotRecipe.variants, "density", "comfortable", "root").paddingY).toBe("9px");
        expect(at(metricChipSlotRecipe.variants, "density", "comfortable", "root").paddingY).toBe("9px");
        expect(chipRecipe.base?.lineHeight).toBe("var(--cr-lh, 1)");
        // A Tag takes the rail's line at size md alone, beside the rail's face and padding; sm and lg keep a line of 1 (#1646's review).
        expect(at(tagSlotRecipe.base, "root").lineHeight).toBe("1");
        expect(at(tagSlotRecipe.variants, "size", "md", "root").lineHeight).toBe("var(--cr-lh, 1)");
        expect([at(tagSlotRecipe.variants, "size", "sm", "root").lineHeight, at(tagSlotRecipe.variants, "size", "lg", "root").lineHeight]).toEqual([undefined, undefined]);
    });
});
