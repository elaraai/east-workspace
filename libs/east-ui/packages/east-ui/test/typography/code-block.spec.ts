/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { CodeBlock } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./code-block.examples.js";

describeEast("CodeBlock", (test) => {
    Assert.examples(test, {
        codeBlockBasic: ex.codeBlockBasic,
        codeBlockVariants: ex.codeBlockVariants,
        codeBlockDiff: ex.codeBlockDiff,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#459).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("codeBlockVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.codeBlockVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 8n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "BLOCK WITH LANGUAGE"));
        $(Assert.equal(rows.get(1n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "BLOCK LINE NUMBERS"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "BLOCK HIGHLIGHTED"));
        $(Assert.equal(rows.get(3n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "BLOCK MAX HEIGHT"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "BLOCK PYTHON"));
        $(Assert.equal(rows.get(5n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "BLOCK JSON"));
        $(Assert.equal(rows.get(6n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "BLOCK BASH"));
        $(Assert.equal(rows.get(7n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "BLOCK INTERACTIVE"));
    });

    // =========================================================================
    // Basic Creation — { code, language?, showLineNumbers?, highlightLines?,
    //                  showCopyButton?, wordWrap?, title?, style? } shape
    // =========================================================================

    test("creates code block with code string", $ => {
        const block = $.let(CodeBlock.Root("const x = 1;"));

        $(Assert.equal(block.unwrap().unwrap("CodeBlock").code, "const x = 1;"));
    });

    test("creates code block with no style — all options are none", $ => {
        const block = $.let(CodeBlock.Root("console.log('hello')"));

        $(Assert.equal(block.unwrap().unwrap("CodeBlock").code, "console.log('hello')"));
        $(Assert.equal(block.unwrap().unwrap("CodeBlock").language.hasTag("none"), true));
        $(Assert.equal(block.unwrap().unwrap("CodeBlock").showLineNumbers.hasTag("none"), true));
        $(Assert.equal(block.unwrap().unwrap("CodeBlock").highlightLines.hasTag("none"), true));
        $(Assert.equal(block.unwrap().unwrap("CodeBlock").style.hasTag("none"), true));
    });

    test("creates code block with multiline code", $ => {
        const code = `function hello() {
  console.log("Hello!");
}`;
        const block = $.let(CodeBlock.Root(code));

        $(Assert.equal(block.unwrap().unwrap("CodeBlock").code, code));
    });

    // =========================================================================
    // Language (on main)
    // =========================================================================

    test("creates code block with typescript language", $ => {
        const block = $.let(CodeBlock.Root("const x: number = 1;", { language: "typescript" }));
        $(Assert.equal(block.unwrap().unwrap("CodeBlock").language.hasTag("some"), true));
        $(Assert.equal(block.unwrap().unwrap("CodeBlock").language.unwrap("some").hasTag("typescript"), true));
    });

    test("creates code block with javascript language", $ => {
        const block = $.let(CodeBlock.Root("const x = 1;", { language: "javascript" }));
        $(Assert.equal(block.unwrap().unwrap("CodeBlock").language.unwrap("some").hasTag("javascript"), true));
    });

    test("creates code block with python language", $ => {
        const block = $.let(CodeBlock.Root("print('hello')", { language: "python" }));
        $(Assert.equal(block.unwrap().unwrap("CodeBlock").language.unwrap("some").hasTag("python"), true));
    });

    test("creates code block with json language", $ => {
        const block = $.let(CodeBlock.Root('{ "key": "value" }', { language: "json" }));
        $(Assert.equal(block.unwrap().unwrap("CodeBlock").language.unwrap("some").hasTag("json"), true));
    });

    test("creates code block with diff language", $ => {
        const patch = "--- a\n+++ b\n-old line\n+new line";
        const block = $.let(CodeBlock.Root(patch, { language: "diff" }));
        $(Assert.equal(block.unwrap().unwrap("CodeBlock").language.unwrap("some").hasTag("diff"), true));
    });

    // =========================================================================
    // Line Numbers (on main — wiring flag)
    // =========================================================================

    test("creates code block with line numbers enabled", $ => {
        const block = $.let(CodeBlock.Root("line 1\nline 2", { showLineNumbers: true }));
        $(Assert.equal(block.unwrap().unwrap("CodeBlock").showLineNumbers.hasTag("some"), true));
        $(Assert.equal(block.unwrap().unwrap("CodeBlock").showLineNumbers.unwrap("some"), true));
    });

    test("creates code block with line numbers disabled", $ => {
        const block = $.let(CodeBlock.Root("code", { showLineNumbers: false }));
        $(Assert.equal(block.unwrap().unwrap("CodeBlock").showLineNumbers.unwrap("some"), false));
    });

    // =========================================================================
    // Highlight Lines (on main)
    // =========================================================================

    test("creates code block with single highlighted line", $ => {
        const block = $.let(CodeBlock.Root("line 1\nline 2\nline 3", { highlightLines: [2n] }));
        $(Assert.equal(block.unwrap().unwrap("CodeBlock").highlightLines.hasTag("some"), true));
    });

    test("creates code block with multiple highlighted lines", $ => {
        const block = $.let(CodeBlock.Root("a\nb\nc\nd", { highlightLines: [1n, 3n] }));
        $(Assert.equal(block.unwrap().unwrap("CodeBlock").highlightLines.hasTag("some"), true));
    });

    // =========================================================================
    // Max Height (inside style)
    // =========================================================================

    test("creates code block with maxHeight in style", $ => {
        const block = $.let(CodeBlock.Root("// long code", { maxHeight: "400px" }));
        const style = block.unwrap().unwrap("CodeBlock").style.unwrap("some");
        $(Assert.equal(style.maxHeight.hasTag("some"), true));
        $(Assert.equal(style.maxHeight.unwrap("some"), "400px"));
    });

    test("creates code block with percentage maxHeight", $ => {
        const block = $.let(CodeBlock.Root("code", { maxHeight: "50vh" }));
        const style = block.unwrap().unwrap("CodeBlock").style.unwrap("some");
        $(Assert.equal(style.maxHeight.unwrap("some"), "50vh"));
    });

    // =========================================================================
    // Colour escape hatches (inside style)
    // =========================================================================

    test("creates code block with explicit colour slots", $ => {
        const block = $.let(CodeBlock.Root("code", {
            background: "#0b0f17",
            borderColor: "#1a2234",
            headerBackground: "#151b27",
            lineNumberColor: "#6a758c",
            highlightBackground: "#ffd70022",
        }));
        const style = block.unwrap().unwrap("CodeBlock").style.unwrap("some");
        $(Assert.equal(style.background.unwrap("some"), "#0b0f17"));
        $(Assert.equal(style.borderColor.unwrap("some"), "#1a2234"));
        $(Assert.equal(style.headerBackground.unwrap("some"), "#151b27"));
        $(Assert.equal(style.lineNumberColor.unwrap("some"), "#6a758c"));
        $(Assert.equal(style.highlightBackground.unwrap("some"), "#ffd70022"));
    });

    // =========================================================================
    // Combined Options
    // =========================================================================

    test("creates code block with all options", $ => {
        const code = `function hello() {
  console.log("Hello!");
}`;
        const block = $.let(CodeBlock.Root(code, {
            language: "typescript",
            showLineNumbers: true,
            highlightLines: [2n],
            maxHeight: "300px",
        }));
        const main = block.unwrap().unwrap("CodeBlock");
        const style = main.style.unwrap("some");

        $(Assert.equal(main.code, code));
        $(Assert.equal(main.language.unwrap("some").hasTag("typescript"), true));
        $(Assert.equal(main.showLineNumbers.unwrap("some"), true));
        $(Assert.equal(main.highlightLines.hasTag("some"), true));
        $(Assert.equal(style.maxHeight.unwrap("some"), "300px"));
    });

    test("creates documentation code example", $ => {
        const code = `import { East } from "@elaraai/east";

const value = East.value(42);`;
        const block = $.let(CodeBlock.Root(code, {
            language: "typescript",
            showLineNumbers: true,
        }));

        $(Assert.equal(block.unwrap().unwrap("CodeBlock").language.unwrap("some").hasTag("typescript"), true));
        $(Assert.equal(block.unwrap().unwrap("CodeBlock").showLineNumbers.unwrap("some"), true));
    });

    test("creates terminal output block", $ => {
        const output = `$ npm install
added 100 packages`;
        const block = $.let(CodeBlock.Root(output, { language: "bash" }));

        $(Assert.equal(block.unwrap().unwrap("CodeBlock").language.unwrap("some").hasTag("bash"), true));
    });
}, { platformFns: TestImpl });
