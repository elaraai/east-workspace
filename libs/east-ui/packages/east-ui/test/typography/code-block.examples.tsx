/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, BooleanType, IntegerType, NullType, StringType, StructType, example, variant } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, CodeBlock, Configurator, HStack, SegmentGroup, Select, Switch, Text, VStack, Reactive } from "@elaraai/east-ui";

// ============================================================================
// Basic — the search-index front door
// ============================================================================

export const codeBlockBasic = example({
    keywords: ["CodeBlock", "Root", "basic", "multi-line"],
    description: "Simple multi-line code",
    fn: East.function([], UIComponentType, (_$) => {
        return <CodeBlock>{"const x = 1;\nconst y = 2;\nconsole.log(x + y);"}</CodeBlock>;
    }),
    inputs: [],
});

// ============================================================================
// CodeBlock — live configurator over every block axis
// ============================================================================

export const codeBlockVariants = example({
    keywords: ["CodeBlock", "Root", "language", "typescript", "showLineNumbers", "line numbers", "highlightLines", "emphasis", "maxHeight", "scroll", "scrollable", "python", "json", "bash", "terminal", "diff", "patch", "Reactive", "State", "interactive", "counter", "SegmentGroup", "Switch", "Configurator", "getTag", "configurator"],
    description: "CodeBlock configurator — language-preset and max-height axes plus line-number / highlight switches driving one live block; the aside grows a reactive snippet",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <Reactive>{$ => {
                // Language is the one axis that needs a struct: a snippet is
                // only legible in the language it was written for, so each
                // entry carries the code and the line worth emphasising. The
                // language's own `getTag()` still names the segment — there is
                // no separate key column.
                const snippets = $.const([
                    {
                        language: variant("typescript", null),
                        code: "// Long code example\nfunction processData(data) {\n  const results = [];\n\n  for (const item of data) {\n    const processed = transform(item);\n    results.push(processed);\n  }\n\n  return results;\n}\n\nfunction transform(item) {\n  return {\n    ...item,\n    processed: true,\n  };\n}",
                        line: 6n,
                    },
                    {
                        language: variant("python", null),
                        code: "def fibonacci(n):\nif n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)\n\nprint(fibonacci(10))",
                        line: 4n,
                    },
                    {
                        language: variant("json", null),
                        code: "{\n\t\"name\": \"east-ui\",\n\t\"version\": \"1.0.0\",\n\t\"dependencies\": {\n\t\t\"@elaraai/east\": \"^1.0.0\"\n\t}\n}",
                        line: 3n,
                    },
                    {
                        language: variant("bash", null),
                        code: "$ npm install @elaraai/east-ui\n$ npm run build\n$ npm test",
                        line: 2n,
                    },
                    {
                        language: variant("diff", null),
                        code: "--- a/scenario.yaml\n+++ b/scenario.yaml\n@@ -1,5 +1,5 @@\n name: Q2 plan\n-target: 1.80M\n+target: 1.84M\n horizon: 2026-06-30\n assumptions:\n-  service_level: 0.85\n+  service_level: 0.92",
                        line: 5n,
                    },
                ], ArrayType(StructType({ language: CodeBlock.Types.Language, code: StringType, line: IntegerType })));

                // A max height is a CSS length token, so the axis is a bare
                // array of the value itself — "none" leaves the block unclipped.
                const heights = $.const(["none", "150px", "300px"], ArrayType(StringType));

                const languageBind  = $.let(State.bind([StringType], "code_block_language", "typescript"));
                const heightBind    = $.let(State.bind([StringType], "code_block_maxheight", "none"));
                const linesBind     = $.let(State.bind([BooleanType], "code_block_lines", true));
                const highlightBind = $.let(State.bind([BooleanType], "code_block_highlight", false));
                const counter       = $.let(State.bind([IntegerType], "code_block_counter", 0n));

                const lKey  = $.let(languageBind.read());
                const hKey  = $.let(heightBind.read());
                const lines = $.let(linesBind.read());
                const count = $.let(counter.read());

                const onLanguage  = $.const(East.function([StringType], NullType, ($, next) => { $(languageBind.write(next)); }));
                const onHeight    = $.const(East.function([StringType], NullType, ($, next) => { $(heightBind.write(next)); }));
                const onLines     = $.const(East.function([BooleanType], NullType, ($, next) => { $(linesBind.write(next)); }));
                const inc         = $.const(East.function([], NullType, $ => {
                    const cur = $.let(counter.read());
                    $(counter.write(cur.add(1n)));
                }));

                // Each selection is a lookup into the same array the control renders.
                const snippet = $.let(snippets.filter((_$, o) => o.language.getTag().equal(lKey)).get(0n));
                const maxHeight = $.let(heights.filter((_$, s) => s.equal(hKey)).get(0n));

                // ONE block — the highlighted line composes on permanently
                // (its line number is snippet DATA).
                const block = $.const(
                    <CodeBlock language={snippet.language} showLineNumbers={lines} highlightLines={[snippet.line]} maxHeight={maxHeight}>{snippet.code}</CodeBlock>,
                );

                return (
                    <Configurator
                        controls={[
                            Configurator.Control("Language", lKey,
                                <Select value={lKey} onChange={onLanguage} size="sm"
                                    items={snippets.map((_$, o) => Select.Item(o.language.getTag(), o.language.getTag()))} />),
                            Configurator.Control("Max height", hKey,
                                <SegmentGroup value={hKey} onChange={onHeight} size="sm"
                                    items={heights.map((_$, s) => SegmentGroup.Item(s, <Text>{s.upperCase()}</Text>))} />),
                            // A Slot, not a Control: the two switches report as
                            // the Line numbers / Highlight spec rows below
                            // rather than as one value.
                            Configurator.Slot("Wiring",
                                <HStack gap="5" align="center" wrap="wrap">
                                    <Switch checked={lines} label="Line numbers" onChange={onLines} />
                                </HStack>),
                        ]}
                        preview={block}
                        aside={{
                            label: "Count · Reactive",
                            body: (
                                <VStack gap="3" align="stretch">
                                    <CodeBlock language="typescript" showLineNumbers>{East.str`function f() {\n  return ${East.print(count)};\n}`}</CodeBlock>
                                    <Button size="xs" onClick={inc}>Increment</Button>
                                </VStack>
                            ),
                        }}
                        spec={[
                            Configurator.Spec("Line numbers", lines.ifElse(_$ => "shown", _$ => "hidden")),
                        ]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// Diff — unified-diff highlighting (scenario-edit semantics)
