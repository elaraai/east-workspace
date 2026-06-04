/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { State, UIComponentType } from "@elaraai/east-ui";
import { Button, CodeBlock, Reactive, VStack } from "@elaraai/east-ui/jsx";

export const codeBlockBasic = example({
    keywords: ["CodeBlock", "Root", "basic", "multi-line"],
    description: "Simple multi-line code",
    fn: East.function([], UIComponentType, (_$) => {
        return <CodeBlock>{"const x = 1;\nconst y = 2;\nconsole.log(x + y);"}</CodeBlock>;
    }),
    inputs: [],
});

export const codeBlockWithLanguage = example({
    keywords: ["CodeBlock", "Root", "language", "typescript"],
    description: "TypeScript code block",
    fn: East.function([], UIComponentType, (_$) => {
        return <CodeBlock language="typescript">{"function greet(name: string): string {\n\treturn `Hello, ${name}!`;\n}"}</CodeBlock>;
    }),
    inputs: [],
});

export const codeBlockLineNumbers = example({
    keywords: ["CodeBlock", "Root", "showLineNumbers", "line numbers"],
    description: "Code with line numbers displayed",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <CodeBlock language="typescript" showLineNumbers>
                {"import { East } from \"@elaraai/east\";\nconst value = East.value(42);\nconsole.log(value);"}
            </CodeBlock>
        );
    }),
    inputs: [],
});

export const codeBlockHighlighted = example({
    keywords: ["CodeBlock", "Root", "highlightLines", "emphasis"],
    description: "Specific lines emphasized",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <CodeBlock language="typescript" showLineNumbers highlightLines={[4n]}>
                {"function calculate() {\n\tconst a = 10;\n\tconst b = 20;\n\treturn a + b;  // Important line\n}"}
            </CodeBlock>
        );
    }),
    inputs: [],
});

export const codeBlockMaxHeight = example({
    keywords: ["CodeBlock", "Root", "maxHeight", "scroll", "scrollable"],
    description: "Scrollable code block",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <CodeBlock language="typescript" showLineNumbers maxHeight="150px">
                {"// Long code example\nfunction processData(data) {\n  const results = [];\n\n  for (const item of data) {\n    const processed = transform(item);\n    results.push(processed);\n  }\n\n  return results;\n}\n\nfunction transform(item) {\n  return {\n    ...item,\n    processed: true,\n  };\n}"}
            </CodeBlock>
        );
    }),
    inputs: [],
});

export const codeBlockPython = example({
    keywords: ["CodeBlock", "Root", "language", "python"],
    description: "Python code example",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <CodeBlock language="python" showLineNumbers>
                {"def fibonacci(n):\nif n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)\n\nprint(fibonacci(10))"}
            </CodeBlock>
        );
    }),
    inputs: [],
});

export const codeBlockJson = example({
    keywords: ["CodeBlock", "Root", "language", "json"],
    description: "JSON data example",
    fn: East.function([], UIComponentType, (_$) => {
        return (
            <CodeBlock language="json">
                {"{\n\t\"name\": \"east-ui\",\n\t\"version\": \"1.0.0\",\n\t\"dependencies\": {\n\t\t\"@elaraai/east\": \"^1.0.0\"\n\t}\n}"}
            </CodeBlock>
        );
    }),
    inputs: [],
});

export const codeBlockBash = example({
    keywords: ["CodeBlock", "Root", "language", "bash", "terminal"],
    description: "Terminal commands",
    fn: East.function([], UIComponentType, (_$) => {
        return <CodeBlock language="bash">{"$ npm install @elaraai/east-ui\n$ npm run build\n$ npm test"}</CodeBlock>;
    }),
    inputs: [],
});

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

export const codeBlockInteractive = example({
    keywords: ["CodeBlock", "Reactive", "State", "interactive", "counter"],
    description: "Reactive code block whose contents update from a counter",
    fn: East.function([], UIComponentType, (_$) => (
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
    )),
    inputs: [],
});
