/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * IR-level type-shape contract checker.
 *
 * Walks the registered components in `UIComponentType` and verifies that
 * every variant follows the §0.10 split:
 *   - main struct fields = content / state / config / behaviour (callbacks)
 *   - visual fields live inside `style: OptionType(XxxStyleType)` ONLY
 *
 * Prints a non-compliance report. Non-zero exit on violations.
 *
 * Run via: `tsx scripts/check-contracts.ts` from `packages/east-ui`.
 */

import { UIComponentType } from "../src/component.js";

// ===========================================================================
// Rules
// ===========================================================================

/**
 * Visual fields that must live INSIDE `style`, never on the main struct.
 * Drawn from §0.10 (`README.md` and `0-conventions.md`).
 */
const VISUAL_FIELDS = new Set([
    // Visual presets
    "variant", "size", "colorPalette", "elevation",
    // Layout / sizing
    "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight",
    "flex", "padding", "margin", "gap", "overflow", "overflowX", "overflowY",
    // Positioning
    "position", "top", "right", "bottom", "left", "zIndex",
    // Border
    "borderWidth", "borderStyle", "borderRadius", "border", "borderColor",
    // Typography
    "textStyle", "fontWeight", "fontStyle", "fontSize", "fontFamily",
    "fontVariantNumeric", "textAlign", "textDecoration", "textTransform",
    "textOverflow", "whiteSpace", "lineHeight", "letterSpacing",
    // Colour (foreground / background)
    "color", "background",
    // Opacity / motion / shadow
    "opacity", "boxShadow", "transform", "transition", "animation", "cursor",
    // Geometric presentation
    "orientation", "direction", "align", "justifyContent", "alignItems",
    "flexDirection", "flexWrap", "placement", "hasArrow", "hoverIntent",
    "curveType",
]);

/**
 * Documented exceptions — variants whose main struct can carry
 * what would otherwise look like a visual field.
 *
 * Per §0.10 "Where the rule does not apply":
 * - charts: their functional sub-configs (`xAxis`, `yAxis`, `tooltip`,
 *   `legend`, `margin`, `brush`) are compound configs, not visual style.
 * - imperative platform calls: not UIComponent variants.
 * - helper namespaces: not primitives.
 *
 * Keys are variant tags in `UIComponentType`. Values are field names
 * that are exempt from the visual-on-main check on that variant.
 */
const EXEMPTIONS: Record<string, Set<string>> = {
    // Charts — functional sub-configs that travel on main, not in style.
    // `curveType` is an interpolation-method config (linear / monotone / step),
    // a data-rendering algorithm, not a visual preset.
    AreaChart: new Set(["xAxis", "yAxis", "tooltip", "legend", "margin", "brush", "curveType"]),
    AreaRangeChart: new Set(["xAxis", "yAxis", "tooltip", "legend", "margin", "brush", "curveType"]),
    BarChart: new Set(["xAxis", "yAxis", "tooltip", "legend", "margin", "brush", "layout"]),
    LineChart: new Set(["xAxis", "yAxis", "tooltip", "legend", "margin", "brush", "curveType"]),
    ScatterChart: new Set(["xAxis", "yAxis", "tooltip", "legend", "margin", "brush"]),
    PieChart: new Set(["tooltip", "legend", "margin"]),
    RadarChart: new Set(["tooltip", "legend", "margin"]),
    ComposedChart: new Set(["xAxis", "yAxis", "tooltip", "legend", "margin", "brush", "curveType"]),
    Sparkline: new Set(["margin", "tooltip"]),

    // Note — `variant` here is content classification (narrative / callout /
    // quote), affecting semantics + ARIA, not visual preset.
    Note: new Set(["variant"]),
};

// ===========================================================================
// Walker
// ===========================================================================

interface Violation {
    variant: string;
    field: string;
    rule: "visual-on-main" | "missing-style" | "non-struct-variant";
    detail?: string;
}

function isStruct(t: any): t is { type: "Struct"; fields: Record<string, any> } {
    return t && typeof t === "object" && t.type === "Struct" && t.fields;
}

function isOption(t: any): t is { type: "Variant"; cases: { none: any; some: any } } {
    return t && typeof t === "object" && t.type === "Variant"
        && t.cases && "none" in t.cases && "some" in t.cases;
}

function check(): Violation[] {
    const violations: Violation[] = [];

    // UIComponentType is a RecursiveType wrapping a VariantType.
    // The variant cases are the registered components.
    const root: any = UIComponentType;
    const inner: any = root.type === "Recursive" ? root.node : root;
    if (!inner || inner.type !== "Variant") {
        throw new Error(
            `UIComponentType inner is not a VariantType — check script needs an update. ` +
            `Got: type=${inner?.type}, keys=${inner ? Object.keys(inner).join(",") : "n/a"}`,
        );
    }

    const cases: Record<string, any> = inner.cases;

    for (const [tag, struct] of Object.entries(cases)) {
        // Some variants are leaf StructType instances (e.g. Tooltip).
        // Others reference an external `XxxType` — same shape after import.
        if (!isStruct(struct)) {
            // Variant case is not a struct (e.g. NullType, primitive).
            continue;
        }

        const exempt = EXEMPTIONS[tag] ?? new Set<string>();
        const fields = Object.keys(struct.fields);

        // Find visual fields living on main.
        for (const fieldName of fields) {
            if (fieldName === "style") continue;
            if (exempt.has(fieldName)) continue;
            if (VISUAL_FIELDS.has(fieldName)) {
                violations.push({
                    variant: tag,
                    field: fieldName,
                    rule: "visual-on-main",
                });
            }
        }

        // Style sub-struct: must be OptionType<StructType>
        if ("style" in struct.fields) {
            const styleField = struct.fields.style;
            if (!isOption(styleField)) {
                violations.push({
                    variant: tag,
                    field: "style",
                    rule: "missing-style",
                    detail: "style field is not OptionType<StructType>",
                });
            } else if (!isStruct(styleField.cases.some)) {
                violations.push({
                    variant: tag,
                    field: "style",
                    rule: "missing-style",
                    detail: "style.some is not a StructType",
                });
            }
        }
    }

    return violations;
}

// ===========================================================================
// Report
// ===========================================================================

function report(violations: Violation[]): void {
    if (violations.length === 0) {
        console.log("✓ All component variants comply with the §0.10 type-shape convention.");
        return;
    }

    console.error(`✗ ${violations.length} non-compliance${violations.length === 1 ? "" : "s"}:\n`);

    // Group by variant.
    const byVariant = new Map<string, Violation[]>();
    for (const v of violations) {
        if (!byVariant.has(v.variant)) byVariant.set(v.variant, []);
        byVariant.get(v.variant)!.push(v);
    }
    const sortedTags = Array.from(byVariant.keys()).sort();
    for (const tag of sortedTags) {
        console.error(`  ${tag}:`);
        for (const v of byVariant.get(tag)!) {
            const detail = v.detail ? ` — ${v.detail}` : "";
            console.error(`    [${v.rule}] ${v.field}${detail}`);
        }
    }

    console.error(`\nTotal: ${violations.length} violation${violations.length === 1 ? "" : "s"} across ${byVariant.size} variant${byVariant.size === 1 ? "" : "s"}.`);
}

const violations = check();
report(violations);
process.exit(violations.length === 0 ? 0 : 1);
