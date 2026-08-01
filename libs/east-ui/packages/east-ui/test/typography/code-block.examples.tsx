/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, CodeBlock, Reactive, Separator, VStack } from "@elaraai/east-ui";

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
// CodeBlock — languages, line numbers, sizing (variant panel)
// ============================================================================

export const codeBlockVariants = example({
    keywords: ["CodeBlock", "Root", "language", "typescript", "showLineNumbers", "line numbers", "highlightLines", "emphasis", "maxHeight", "scroll", "scrollable", "python", "json", "bash", "terminal", "Reactive", "State", "interactive", "counter"],
    description: "CodeBlock variant panel — block with language (TypeScript code block), block line numbers (line numbers displayed), block highlighted (specific lines emphasized), block max height (scrollable code block), block python (Python code example), block json (JSON data example), block bash (terminal commands), block interactive (reactive code block whose contents update from a counter)",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <VStack gap="4" align="stretch">
                <Separator label="BLOCK WITH LANGUAGE" align="start" />
                <CodeBlock language="typescript">{"function greet(name: string): string {\n\treturn `Hello, ${name}!`;\n}"}</CodeBlock>
                <Separator label="BLOCK LINE NUMBERS" align="start" />
                <CodeBlock language="typescript" showLineNumbers>
                        {"import { East } from \"@elaraai/east\";\nconst value = East.value(42);\nconsole.log(value);"}
                    </CodeBlock>
                <Separator label="BLOCK HIGHLIGHTED" align="start" />
                <CodeBlock language="typescript" showLineNumbers highlightLines={[4n]}>
                        {"function calculate() {\n\tconst a = 10;\n\tconst b = 20;\n\treturn a + b;  // Important line\n}"}
                    </CodeBlock>
                <Separator label="BLOCK MAX HEIGHT" align="start" />
                <CodeBlock language="typescript" showLineNumbers maxHeight="150px">
                        {"// Long code example\nfunction processData(data) {\n  const results = [];\n\n  for (const item of data) {\n    const processed = transform(item);\n    results.push(processed);\n  }\n\n  return results;\n}\n\nfunction transform(item) {\n  return {\n    ...item,\n    processed: true,\n  };\n}"}
                    </CodeBlock>
                <Separator label="BLOCK PYTHON" align="start" />
                <CodeBlock language="python" showLineNumbers>
                        {"def fibonacci(n):\nif n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)\n\nprint(fibonacci(10))"}
                    </CodeBlock>
                <Separator label="BLOCK JSON" align="start" />
                <CodeBlock language="json">
                        {"{\n\t\"name\": \"east-ui\",\n\t\"version\": \"1.0.0\",\n\t\"dependencies\": {\n\t\t\"@elaraai/east\": \"^1.0.0\"\n\t}\n}"}
                    </CodeBlock>
                <Separator label="BLOCK BASH" align="start" />
                <CodeBlock language="bash">{"$ npm install @elaraai/east-ui\n$ npm run build\n$ npm test"}</CodeBlock>
                <Separator label="BLOCK INTERACTIVE" align="start" />
                <Reactive>{$ => {
                        const counter = $.let(State.bind([IntegerType], "code_block_counter", 0n));
                        const value = $.let(counter.read());
                        const increment = $.const(East.function([], NullType, $ => {
                            const cur = $.let(counter.read());
                            $(counter.write(cur.add(1n)));
                        }));
                        return (
                            <VStack gap="3" align="stretch">
                                <CodeBlock language="typescript" showLineNumbers>{East.str`function f() {\n  return ${East.print(value)};\n}`}</CodeBlock>
                                <Button onClick={increment}>Increment</Button>
                            </VStack>
                        );
                    }}</Reactive>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Diff — unified-diff highlighting (scenario-edit semantics)
// ============================================================================

export const codeBlockDiff = example({
    keywords: ["CodeBlock", "Root", "language", "diff", "patch"],
    description: "Unified-diff highlighting for scenario edits",
    fn: East.function([], UIComponentType, (_$) => {
        const patch = [
            "--- a/scenario.yaml",
            "+++ b/scenario.yaml",
            "@@ -1,5 +1,5 @@",
            " name: Q2 plan",
            "-target: 1.80M",
            "+target: 1.84M",
            " horizon: 2026-06-30",
            " assumptions:",
            "-  service_level: 0.85",
            "+  service_level: 0.92",
        ].join("\n");
        return <CodeBlock language="diff" showLineNumbers title="scenario.yaml">{patch}</CodeBlock>;
    }),
    inputs: [],
});
