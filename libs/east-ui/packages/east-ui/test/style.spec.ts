/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Style } from "@elaraai/east-ui/internal";
import * as ex from "./style.examples.js";

// -----------------------------------------------------------------------------
// Tombstone: the style.ts TableVariantType(simple|striped|unstyled) was
// removed — it clashed with the canonical `TableVariantType(line|outline)`
// in `collections/table/types.ts`. The line below documents the deletion so
// a grep in CI can assert absence.
// DO NOT re-introduce: // Style.TableVariant("striped")  <-- deliberately removed
// -----------------------------------------------------------------------------

describeEast("Style", (test) => {
    Assert.examples(test, {
        textStyleScale: ex.textStyleScale,
        densityKnob: ex.densityKnob,
        elevationScale: ex.elevationScale,
        motionDurationSwatches: ex.motionDurationSwatches,
        statusPalette: ex.statusPalette,
    });

    // =========================================================================
    // Position
    // =========================================================================

    test("Position helper round-trip — static", $ => {
        const p = $.let(Style.Position("static"), Style.Types.Position);
        $(Assert.equal(p.hasTag("static"), true));
        $(Assert.equal(p.hasTag("sticky"), false));
    });

    test("Position helper round-trip — sticky", $ => {
        const p = $.let(Style.Position("sticky"));
        $(Assert.equal(p.hasTag("sticky"), true));
    });

    test("Position helper round-trip — fixed / absolute / relative", $ => {
        $(Assert.equal(Style.Position("fixed").hasTag("fixed"), true));
        $(Assert.equal(Style.Position("absolute").hasTag("absolute"), true));
        $(Assert.equal(Style.Position("relative").hasTag("relative"), true));
    });

    // =========================================================================
    // Cursor
    // =========================================================================

    test("Cursor helper round-trip — help", $ => {
        const c = $.let(Style.Cursor("help"));
        $(Assert.equal(c.hasTag("help"), true));
        $(Assert.equal(c.hasTag("pointer"), false));
    });

    test("Cursor helper round-trip — col-resize / row-resize / not-allowed", $ => {
        $(Assert.equal(Style.Cursor("col-resize").hasTag("col-resize"), true));
        $(Assert.equal(Style.Cursor("row-resize").hasTag("row-resize"), true));
        $(Assert.equal(Style.Cursor("not-allowed").hasTag("not-allowed"), true));
    });

    // =========================================================================
    // Font Family / Font Variant Numeric
    // =========================================================================

    test("FontFamily helper round-trip — mono", $ => {
        const f = $.let(Style.FontFamily("mono"));
        $(Assert.equal(f.hasTag("mono"), true));
        $(Assert.equal(f.hasTag("sans"), false));
    });

    test("FontFamily helper round-trip — sans / serif", $ => {
        $(Assert.equal(Style.FontFamily("sans").hasTag("sans"), true));
        $(Assert.equal(Style.FontFamily("serif").hasTag("serif"), true));
    });

    test("FontVariantNumeric helper round-trip — tabular-nums", $ => {
        const v = $.let(Style.FontVariantNumeric("tabular-nums"));
        $(Assert.equal(v.hasTag("tabular-nums"), true));
        $(Assert.equal(v.hasTag("normal"), false));
    });

    test("FontVariantNumeric helper round-trip — oldstyle-nums / slashed-zero", $ => {
        $(Assert.equal(Style.FontVariantNumeric("oldstyle-nums").hasTag("oldstyle-nums"), true));
        $(Assert.equal(Style.FontVariantNumeric("slashed-zero").hasTag("slashed-zero"), true));
    });

    // =========================================================================
    // Box Shadow / Radius
    // =========================================================================

    test("BoxShadow helper round-trip — md", $ => {
        const s = $.let(Style.BoxShadow("md"));
        $(Assert.equal(s.hasTag("md"), true));
        $(Assert.equal(s.hasTag("xl"), false));
    });

    test("BoxShadow helper round-trip — all tokens", $ => {
        $(Assert.equal(Style.BoxShadow("none").hasTag("none"), true));
        $(Assert.equal(Style.BoxShadow("xs").hasTag("xs"), true));
        $(Assert.equal(Style.BoxShadow("sm").hasTag("sm"), true));
        $(Assert.equal(Style.BoxShadow("lg").hasTag("lg"), true));
        $(Assert.equal(Style.BoxShadow("xl").hasTag("xl"), true));
    });

    test("Radius helper round-trip — full", $ => {
        const r = $.let(Style.Radius("full"));
        $(Assert.equal(r.hasTag("full"), true));
        $(Assert.equal(r.hasTag("none"), false));
    });

    test("Radius helper round-trip — all tokens", $ => {
        $(Assert.equal(Style.Radius("none").hasTag("none"), true));
        $(Assert.equal(Style.Radius("xs").hasTag("xs"), true));
        $(Assert.equal(Style.Radius("sm").hasTag("sm"), true));
        $(Assert.equal(Style.Radius("md").hasTag("md"), true));
        $(Assert.equal(Style.Radius("lg").hasTag("lg"), true));
    });

    // =========================================================================
    // Animation Preset / Z-Index Token
    // =========================================================================

    test("AnimationPreset helper round-trip — pulse", $ => {
        const a = $.let(Style.AnimationPreset("pulse"));
        $(Assert.equal(a.hasTag("pulse"), true));
        $(Assert.equal(a.hasTag("none"), false));
    });

    test("AnimationPreset helper round-trip — all tokens", $ => {
        $(Assert.equal(Style.AnimationPreset("none").hasTag("none"), true));
        $(Assert.equal(Style.AnimationPreset("spin").hasTag("spin"), true));
        $(Assert.equal(Style.AnimationPreset("bounce").hasTag("bounce"), true));
        $(Assert.equal(Style.AnimationPreset("fade-in").hasTag("fade-in"), true));
        $(Assert.equal(Style.AnimationPreset("shimmer").hasTag("shimmer"), true));
    });

    test("ZIndexToken helper round-trip — sticky", $ => {
        const z = $.let(Style.ZIndexToken("sticky"));
        $(Assert.equal(z.hasTag("sticky"), true));
        $(Assert.equal(z.hasTag("base"), false));
    });

    test("ZIndexToken helper round-trip — all tokens", $ => {
        $(Assert.equal(Style.ZIndexToken("base").hasTag("base"), true));
        $(Assert.equal(Style.ZIndexToken("dropdown").hasTag("dropdown"), true));
        $(Assert.equal(Style.ZIndexToken("banner").hasTag("banner"), true));
        $(Assert.equal(Style.ZIndexToken("overlay").hasTag("overlay"), true));
        $(Assert.equal(Style.ZIndexToken("modal").hasTag("modal"), true));
        $(Assert.equal(Style.ZIndexToken("popover").hasTag("popover"), true));
        $(Assert.equal(Style.ZIndexToken("toast").hasTag("toast"), true));
        $(Assert.equal(Style.ZIndexToken("tooltip").hasTag("tooltip"), true));
    });

    // =========================================================================
    // Semantic layer — TextStyle
    // =========================================================================

    test("TextStyle helper round-trip — mono-kpi", $ => {
        const t = $.let(Style.TextStyle("mono-kpi"));
        $(Assert.equal(t.hasTag("mono-kpi"), true));
        $(Assert.equal(t.hasTag("body-md"), false));
    });

    test("TextStyle helper round-trip — display scale", $ => {
        $(Assert.equal(Style.TextStyle("display-lg").hasTag("display-lg"), true));
        $(Assert.equal(Style.TextStyle("display-md").hasTag("display-md"), true));
        $(Assert.equal(Style.TextStyle("display-sm").hasTag("display-sm"), true));
    });

    test("TextStyle helper round-trip — heading scale", $ => {
        $(Assert.equal(Style.TextStyle("heading-lg").hasTag("heading-lg"), true));
        $(Assert.equal(Style.TextStyle("heading-md").hasTag("heading-md"), true));
        $(Assert.equal(Style.TextStyle("heading-sm").hasTag("heading-sm"), true));
        $(Assert.equal(Style.TextStyle("heading-xs").hasTag("heading-xs"), true));
    });

    test("TextStyle helper round-trip — body / label / caption / overline", $ => {
        $(Assert.equal(Style.TextStyle("body-lg").hasTag("body-lg"), true));
        $(Assert.equal(Style.TextStyle("body-md").hasTag("body-md"), true));
        $(Assert.equal(Style.TextStyle("body-sm").hasTag("body-sm"), true));
        $(Assert.equal(Style.TextStyle("label-md").hasTag("label-md"), true));
        $(Assert.equal(Style.TextStyle("label-sm").hasTag("label-sm"), true));
        $(Assert.equal(Style.TextStyle("caption").hasTag("caption"), true));
        $(Assert.equal(Style.TextStyle("overline").hasTag("overline"), true));
    });

    test("TextStyle helper round-trip — code", $ => {
        $(Assert.equal(Style.TextStyle("code-sm").hasTag("code-sm"), true));
        $(Assert.equal(Style.TextStyle("code-md").hasTag("code-md"), true));
    });

    // =========================================================================
    // Semantic layer — Density / Verbosity
    // =========================================================================

    test("Density helper round-trip — compact", $ => {
        const d = $.let(Style.Density("compact"));
        $(Assert.equal(d.hasTag("compact"), true));
        $(Assert.equal(d.hasTag("comfortable"), false));
    });

    test("Density helper round-trip — comfortable / condensed", $ => {
        $(Assert.equal(Style.Density("comfortable").hasTag("comfortable"), true));
        $(Assert.equal(Style.Density("condensed").hasTag("condensed"), true));
    });

    test("Verbosity helper round-trip — detailed", $ => {
        const v = $.let(Style.Verbosity("detailed"));
        $(Assert.equal(v.hasTag("detailed"), true));
        $(Assert.equal(v.hasTag("minimal"), false));
    });

    test("Verbosity helper round-trip — minimal / standard", $ => {
        $(Assert.equal(Style.Verbosity("minimal").hasTag("minimal"), true));
        $(Assert.equal(Style.Verbosity("standard").hasTag("standard"), true));
    });

    // =========================================================================
    // Semantic layer — Elevation
    // =========================================================================

    test("Elevation helper round-trip — overlay", $ => {
        const e = $.let(Style.Elevation("overlay"));
        $(Assert.equal(e.hasTag("overlay"), true));
        $(Assert.equal(e.hasTag("flat"), false));
    });

    test("Elevation helper round-trip — all tokens", $ => {
        $(Assert.equal(Style.Elevation("flat").hasTag("flat"), true));
        $(Assert.equal(Style.Elevation("raised").hasTag("raised"), true));
        $(Assert.equal(Style.Elevation("floating").hasTag("floating"), true));
        $(Assert.equal(Style.Elevation("modal").hasTag("modal"), true));
    });

    // =========================================================================
    // Semantic layer — Motion / Transition
    // =========================================================================

    test("MotionDuration helper round-trip — fast", $ => {
        const d = $.let(Style.MotionDuration("fast"));
        $(Assert.equal(d.hasTag("fast"), true));
        $(Assert.equal(d.hasTag("slow"), false));
    });

    test("MotionDuration helper round-trip — all tokens", $ => {
        $(Assert.equal(Style.MotionDuration("instant").hasTag("instant"), true));
        $(Assert.equal(Style.MotionDuration("normal").hasTag("normal"), true));
        $(Assert.equal(Style.MotionDuration("slow").hasTag("slow"), true));
    });

    test("MotionEasing helper round-trip — emphasized", $ => {
        const e = $.let(Style.MotionEasing("emphasized"));
        $(Assert.equal(e.hasTag("emphasized"), true));
        $(Assert.equal(e.hasTag("standard"), false));
    });

    test("MotionEasing helper round-trip — all tokens", $ => {
        $(Assert.equal(Style.MotionEasing("standard").hasTag("standard"), true));
        $(Assert.equal(Style.MotionEasing("decelerated").hasTag("decelerated"), true));
        $(Assert.equal(Style.MotionEasing("accelerated").hasTag("accelerated"), true));
    });

    test("Transition helper round-trip — colors", $ => {
        const t = $.let(Style.Transition("colors"));
        $(Assert.equal(t.hasTag("colors"), true));
        $(Assert.equal(t.hasTag("none"), false));
    });

    test("Transition helper round-trip — all tokens", $ => {
        $(Assert.equal(Style.Transition("none").hasTag("none"), true));
        $(Assert.equal(Style.Transition("shadows").hasTag("shadows"), true));
        $(Assert.equal(Style.Transition("transform").hasTag("transform"), true));
        $(Assert.equal(Style.Transition("layout").hasTag("layout"), true));
        $(Assert.equal(Style.Transition("all").hasTag("all"), true));
    });

    // =========================================================================
    // Semantic layer — Focus / Hover Intent
    // =========================================================================

    test("FocusStyle helper round-trip — emphasis", $ => {
        const f = $.let(Style.FocusStyle("emphasis"));
        $(Assert.equal(f.hasTag("emphasis"), true));
        $(Assert.equal(f.hasTag("default"), false));
    });

    test("FocusStyle helper round-trip — all tokens", $ => {
        $(Assert.equal(Style.FocusStyle("default").hasTag("default"), true));
        $(Assert.equal(Style.FocusStyle("subtle").hasTag("subtle"), true));
        $(Assert.equal(Style.FocusStyle("none").hasTag("none"), true));
    });

    test("HoverIntent helper round-trip — standard", $ => {
        const h = $.let(Style.HoverIntent("standard"));
        $(Assert.equal(h.hasTag("standard"), true));
        $(Assert.equal(h.hasTag("instant"), false));
    });

    test("HoverIntent helper round-trip — all tokens", $ => {
        $(Assert.equal(Style.HoverIntent("instant").hasTag("instant"), true));
        $(Assert.equal(Style.HoverIntent("brief").hasTag("brief"), true));
        $(Assert.equal(Style.HoverIntent("patient").hasTag("patient"), true));
    });

    // =========================================================================
    // Semantic layer — Status Token
    // =========================================================================

    test("StatusToken helper round-trip — success", $ => {
        const s = $.let(Style.StatusToken("success"));
        $(Assert.equal(s.hasTag("success"), true));
        $(Assert.equal(s.hasTag("danger"), false));
    });

    test("StatusToken helper round-trip — warning / danger / info / neutral", $ => {
        $(Assert.equal(Style.StatusToken("warning").hasTag("warning"), true));
        $(Assert.equal(Style.StatusToken("danger").hasTag("danger"), true));
        $(Assert.equal(Style.StatusToken("info").hasTag("info"), true));
        $(Assert.equal(Style.StatusToken("neutral").hasTag("neutral"), true));
    });

    // =========================================================================
    // ColorScheme extension — semantic palette
    // =========================================================================

    test("ColorScheme — hue tokens still round-trip", $ => {
        $(Assert.equal(Style.ColorScheme("gray").hasTag("gray"), true));
        $(Assert.equal(Style.ColorScheme("red").hasTag("red"), true));
        $(Assert.equal(Style.ColorScheme("teal").hasTag("teal"), true));
        $(Assert.equal(Style.ColorScheme("purple").hasTag("purple"), true));
    });

    test("ColorScheme — success semantic token", $ => {
        const c = $.let(Style.ColorScheme("success"));
        $(Assert.equal(c.hasTag("success"), true));
        $(Assert.equal(c.hasTag("green"), false));
    });

    test("ColorScheme — all five semantic tokens", $ => {
        $(Assert.equal(Style.ColorScheme("success").hasTag("success"), true));
        $(Assert.equal(Style.ColorScheme("warning").hasTag("warning"), true));
        $(Assert.equal(Style.ColorScheme("danger").hasTag("danger"), true));
        $(Assert.equal(Style.ColorScheme("info").hasTag("info"), true));
        $(Assert.equal(Style.ColorScheme("neutral").hasTag("neutral"), true));
    });

    // =========================================================================
    // Style namespace tombstone — plain-JS compile-time guards.
    //
    // Namespace registration is enforced at build time by `src/style/namespace.ts`
    // (missing imports fail `tsc`). The `@ts-expect-error` lines below assert
    // that `Style.TableVariant` and `Style.Types.TableVariant` no longer exist
    // — if someone re-introduces them, TypeScript will report the expected
    // error as unused and fail the build.
    // =========================================================================

    test("Style namespace no longer exposes deleted TableVariant", _$ => {
        // @ts-expect-error — TableVariant has been removed from Style
        const _tombstone: undefined = Style.TableVariant;
        // @ts-expect-error — Style.Types.TableVariant has been removed
        const _tombstoneType: undefined = Style.Types.TableVariant;
        void _tombstone;
        void _tombstoneType;
    });
}, { platformFns: TestImpl });
