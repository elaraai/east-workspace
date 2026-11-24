/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A face's capitals at the middle of a room (east-workspace#1748): the faces'
 * metrics are the font files' own, the rows they take at each size are those
 * a browser lays out and paints, and each bar's words spread the line and the
 * padding that centre their capitals in the bar's room. Where the page draws
 * them is measured in the browser (`bar-capitals.spec.ts`).
 */

import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { FACE_METRICS, capitalsBox, centredCapitals, faceRows, type FaceMetrics, type FaceName } from "./face-capitals.js";
import { recordSlotRecipe } from "./slot-recipes/record.js";
import { sheetSlotRecipe } from "./slot-recipes/sheet.js";

/** WOFF2's known table tags, by their index in a table's flags (the WOFF2 specification, §5.1). */
const KNOWN_TAGS = [
    "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
    "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
    "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
    "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

/**
 * A WOFF2 file's vertical metrics: its em, its typographic ascender and descender, its `hhea` table's, whether it says
 * to use the typographic ones, and its capitals' height.
 */
function woff2Metrics(path: string): FaceMetrics & { readonly hhea: readonly [number, number]; readonly typographic: boolean } {
    const file = readFileSync(path);
    let at = 48;
    const base128 = () => {
        let value = 0;
        for (let i = 0; i < 5; i++) {
            const byte = file[at++]!;
            value = value * 128 + (byte & 0x7f);
            if ((byte & 0x80) === 0) return value;
        }
        throw new Error(`${path}: a length of more than five bytes`);
    };
    const tables: { tag: string; length: number }[] = [];
    for (let i = file.readUInt16BE(12); i > 0; i--) {
        const flags = file[at++]!;
        const tag = (flags & 0x3f) === 0x3f ? file.toString("latin1", at, (at += 4)) : KNOWN_TAGS[flags & 0x3f]!;
        const version = (flags >> 6) & 3;
        let length = base128();
        // A transformed table stores its transformed length after its own: glyf and loca at version 0, any other at 1–3.
        if ((tag === "glyf" || tag === "loca") ? version === 0 : version !== 0) length = base128();
        tables.push({ tag, length });
    }
    const data = brotliDecompressSync(file.subarray(at, at + file.readUInt32BE(20)));
    const table: Record<string, Buffer> = {};
    let offset = 0;
    for (const { tag, length } of tables) {
        table[tag] = data.subarray(offset, offset + length);
        offset += length;
    }
    const head = table["head"]!, hhea = table["hhea"]!, os2 = table["OS/2"]!;
    return {
        unitsPerEm: head.readUInt16BE(18),
        ascender: os2.readInt16BE(68),
        descender: -os2.readInt16BE(70),
        capHeight: os2.readInt16BE(88),
        hhea: [hhea.readInt16BE(4), -hhea.readInt16BE(6)],
        typographic: (os2.readUInt16BE(62) & 0x80) !== 0,
    };
}

/** Each face's upright file, as `@elaraai/east-ui-components/fonts` registers it. */
const FILES: Readonly<Record<FaceName, string>> = {
    heading: "dm-sans/files/dm-sans-latin-wght-normal.woff2",
    body: "inter-tight/files/inter-tight-latin-wght-normal.woff2",
    mono: "chivo-mono/files/chivo-mono-latin-wght-normal.woff2",
};

describe("a face's metrics", () => {
    test.each(Object.entries(FILES) as [FaceName, string][])("%s's are its font file's own: its em, its typographic ascender and descender, its capitals", (face, file) => {
        const read = woff2Metrics(new URL(`../../node_modules/@fontsource-variable/${file}`, import.meta.url).pathname);
        expect({ unitsPerEm: read.unitsPerEm, ascender: read.ascender, descender: read.descender, capHeight: read.capHeight }).toEqual(FACE_METRICS[face]);
        // A browser lays its lines out by these alone: the face says to use them, and its `hhea` table's are the same.
        expect(read.typographic).toBe(true);
        expect(read.hhea).toEqual([read.ascender, read.descender]);
    });
});

describe("the rows a face takes at a size", () => {
    // As Chrome lays the faces out (a canvas's font box) and paints their capitals (the rows an H inks), measured on the
    // showcase's own page: its ascent and its descent rounded to the pixel, and its capitals' height to the nearest row.
    test.each([
        ["mono", "label.xs", { ascent: 9, descent: 2, capitals: 7 }],
        ["mono", "label.sm", { ascent: 9, descent: 3, capitals: 7 }],
        ["mono", "label.md", { ascent: 10, descent: 3, capitals: 7 }],
        ["mono", "label.lg", { ascent: 10, descent: 3, capitals: 8 }],
        ["mono", "body", { ascent: 12, descent: 3, capitals: 9 }],
        ["body", "body.sm", { ascent: 12, descent: 3, capitals: 9 }],
    ] as const)("%s at %s: %o", (face, size, rows) => {
        expect(faceRows(face, size)).toEqual(rows);
    });
});

describe("a face's capitals at the middle of the rooms a part is centred in", () => {
    test("a face whose line leans over its capitals is padded on the side short of rows: mono's 10px, a row over them", () => {
        // 9 rows over the baseline and 3 under, 7 of capitals: the line leaves 2 over them and 3 under, so a row goes over the line.
        expect(centredCapitals("mono", "label.sm", 31)).toEqual({ fontFamily: "mono", fontSize: "label.sm", lineHeight: "12px", paddingTop: "1px", paddingBottom: "0px" });
    });

    test("a face whose line holds its capitals at its middle takes no padding: Inter's 12.5px, mono's 10.5px", () => {
        expect(centredCapitals("body", "body.sm", 31)).toEqual({ fontFamily: "body", fontSize: "body.sm", lineHeight: "15px", paddingTop: "0px", paddingBottom: "0px" });
        expect(centredCapitals("mono", "label.md", [31, 35, 27])).toEqual({ fontFamily: "mono", fontSize: "label.md", lineHeight: "13px", paddingTop: "0px", paddingBottom: "0px" });
    });

    test("each room leaves as many rows over the capitals as under them, the box standing a whole number of rows under the room's top", () => {
        for (const [face, size] of [["mono", "label.xs"], ["mono", "label.sm"], ["mono", "label.md"], ["mono", "body"], ["body", "body.sm"]] as const) {
            const rows = faceRows(face, size);
            const got = centredCapitals(face, size, 41);
            const [line, top, bottom] = [got.lineHeight, got.paddingTop, got.paddingBottom].map((px) => Number.parseInt(px, 10)) as [number, number, number];
            const box = line + top + bottom;
            const boxTop = (41 - box) / 2;
            const baseline = boxTop + top + rows.ascent;
            expect(Number.isInteger(boxTop), `${face} at ${size}`).toBe(true);
            expect(baseline - rows.capitals, `${face} at ${size}: rows over its capitals`).toBe(41 - baseline);
        }
    });

    test("is refused where no whole number of rows centres the capitals: an even number of them in an odd room, an odd number in an even one", () => {
        expect(() => centredCapitals("mono", "label.lg", 35)).toThrow(/8 rows of capitals, which no whole number of rows centres in 35px/);
        expect(() => centredCapitals("mono", "label.sm", 26)).toThrow(RangeError);
        expect(() => centredCapitals("mono", "label.sm", [35, 26])).toThrow(/in 26px/);
        expect(() => centredCapitals("mono", "label.sm", 31.5)).toThrow(RangeError);
    });
});

describe("a face's capitals at the middle of a box of its own height", () => {
    test("the box's height is the face's line and the rows its capitals leave over and under them, split evenly", () => {
        expect(capitalsBox("mono", "body", 23)).toEqual({ fontFamily: "mono", fontSize: "body", lineHeight: "15px", paddingTop: "4px", paddingBottom: "4px" });
        expect(capitalsBox("mono", "body", 29)).toEqual({ fontFamily: "mono", fontSize: "body", lineHeight: "15px", paddingTop: "7px", paddingBottom: "7px" });
        // Mono's 10px keeps its row over the line in a box too.
        expect(capitalsBox("mono", "label.sm", 15)).toEqual({ fontFamily: "mono", fontSize: "label.sm", lineHeight: "12px", paddingTop: "2px", paddingBottom: "1px" });
    });

    test("is refused for a box shorter than the face's line, or one no whole number of rows centres the capitals in", () => {
        expect(() => capitalsBox("mono", "body", 13)).toThrow(RangeError);
        expect(() => capitalsBox("mono", "body", 24)).toThrow(/centres in a box 24px tall/);
    });
});

/** A slot's words as it sets them: the face, the size, the line and the padding over and under it. */
const words = (styles: unknown) => {
    const { fontFamily, fontSize, lineHeight, paddingTop, paddingBottom } = styles as Readonly<Record<string, unknown>>;
    return { fontFamily, fontSize, lineHeight, paddingTop, paddingBottom };
};

/** A slot of a recipe's base, or a rule nested in it, by the keys down to it. */
const slot = (base: unknown, ...keys: string[]) => keys.reduce<unknown>((at, key) => (at as Readonly<Record<string, unknown>>)[key], base);

describe("the bars' words", () => {
    const record = recordSlotRecipe.base;
    const sheet = sheetSlotRecipe.base;

    test("the Record's strip: its label, its words and its keys, each with its capitals at the middle of the 31 under its rule", () => {
        expect(words(slot(record, "stripLabel"))).toEqual(centredCapitals("mono", "label.sm", 31));
        expect(words(slot(record, "stripText"))).toEqual(centredCapitals("body", "body.sm", 31));
        expect(words(slot(record, "stripKeys"))).toEqual(centredCapitals("mono", "label.md", 31));
    });

    test("the Record's footer: its counts, its note, its legend's names and the status line's words, in the 35 under its rule", () => {
        for (const part of ["footerCount", "footerNote", "legendName"]) expect(words(slot(record, part)), part).toEqual(centredCapitals("mono", "label.md", 35));
        expect(words(slot(record, "footerLive", "&[data-band]"))).toEqual(centredCapitals("mono", "label.md", 35));
        expect(words(slot(record, "footerLive", "[data-phone] &"))).toEqual(centredCapitals("mono", "label.md", 35));
    });

    test("the Sheet's strip: its label, its meta, its keys and its page count in every room it stands in; its chips 23 tall, 29 on a touch screen", () => {
        for (const part of ["stripLabel", "stripMeta", "stripKeys", "stripPageCount"]) {
            const face = part === "stripLabel" ? "label.sm" : "label.md";
            expect(words(slot(sheet, part)), part).toEqual(centredCapitals("mono", face, [31, 35, 37, 41]));
        }
        for (const part of ["stripChip", "stripChipOn", "stripChipFlat"]) expect(words(slot(sheet, part)), part).toEqual(capitalsBox("mono", "body", 23));
        // A chip a person picks grows on a touch screen; a flat one, which takes no gesture, keeps its 23.
        for (const part of ["stripChip", "stripChipOn"]) {
            expect(words({ ...(slot(sheet, part) as object), ...(slot(sheet, part, "_coarse") as object) }), `${part} on a touch screen`).toEqual(capitalsBox("mono", "body", 29));
        }
    });

    test("the Sheet's footer: its counts, its hint and its message, in the 27 under its rule", () => {
        expect(words(slot(sheet, "footerCounts"))).toEqual(centredCapitals("mono", "label.md", 27));
        expect(words(slot(sheet, "footerHint"))).toEqual(centredCapitals("mono", "label.sm", 27));
        expect(words(slot(sheet, "footerMessage"))).toEqual(centredCapitals("mono", "label.md", 27));
    });
});
