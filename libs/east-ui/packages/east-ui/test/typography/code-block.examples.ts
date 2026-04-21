/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, IntegerType, NullType, example } from "@elaraai/east";
import { Button, CodeBlock, Reactive, Stack, State, UIComponentType } from "@elaraai/east-ui";

export const codeBlockBasic = example({
    keywords: ["CodeBlock", "Root", "basic", "multi-line"],
    description: "Simple multi-line code",
    fn: East.function([], UIComponentType, (_$) => {
        return CodeBlock.Root("const x = 1;\nconst y = 2;\nconsole.log(x + y);");
    }),
    inputs: [],
});

export const codeBlockWithLanguage = example({
    keywords: ["CodeBlock", "Root", "language", "typescript"],
    description: "TypeScript code block",
    fn: East.function([], UIComponentType, (_$) => {
        return CodeBlock.Root("function greet(name: string): string {\n\treturn `Hello, ${name}!`;\n}", { language: "typescript" });
    }),
    inputs: [],
});

export const codeBlockLineNumbers = example({
    keywords: ["CodeBlock", "Root", "showLineNumbers", "line numbers"],
    description: "Code with line numbers displayed",
    fn: East.function([], UIComponentType, (_$) => {
        return CodeBlock.Root("import { East } from \"@elaraai/east\";\nconst value = East.value(42);\nconsole.log(value);", {
            language: "typescript",
            showLineNumbers: true,
        });
    }),
    inputs: [],
});

export const codeBlockHighlighted = example({
    keywords: ["CodeBlock", "Root", "highlightLines", "emphasis"],
    description: "Specific lines emphasized",
    fn: East.function([], UIComponentType, (_$) => {
        return CodeBlock.Root("function calculate() {\n\tconst a = 10;\n\tconst b = 20;\n\treturn a + b;  // Important line\n}", {
            language: "typescript",
            showLineNumbers: true,
            highlightLines: [4n],
        });
    }),
    inputs: [],
});

export const codeBlockMaxHeight = example({
    keywords: ["CodeBlock", "Root", "maxHeight", "scroll", "scrollable"],
    description: "Scrollable code block",
    fn: East.function([], UIComponentType, (_$) => {
        return CodeBlock.Root("// Long code example\nfunction processData(data) {\n  const results = [];\n\n  for (const item of data) {\n    const processed = transform(item);\n    results.push(processed);\n  }\n\n  return results;\n}\n\nfunction transform(item) {\n  return {\n    ...item,\n    processed: true,\n  };\n}", {
            language: "typescript",
            showLineNumbers: true,
            maxHeight: "150px",
        });
    }),
    inputs: [],
});

export const codeBlockPython = example({
    keywords: ["CodeBlock", "Root", "language", "python"],
    description: "Python code example",
    fn: East.function([], UIComponentType, (_$) => {
        return CodeBlock.Root("def fibonacci(n):\nif n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)\n\nprint(fibonacci(10))", {
            language: "python",
            showLineNumbers: true,
        });
    }),
    inputs: [],
});

export const codeBlockJson = example({
    keywords: ["CodeBlock", "Root", "language", "json"],
    description: "JSON data example",
    fn: East.function([], UIComponentType, (_$) => {
        return CodeBlock.Root("{\n\t\"name\": \"east-ui\",\n\t\"version\": \"1.0.0\",\n\t\"dependencies\": {\n\t\t\"@elaraai/east\": \"^1.0.0\"\n\t}\n}", {
            language: "json",
        });
    }),
    inputs: [],
});

export const codeBlockBash = example({
    keywords: ["CodeBlock", "Root", "language", "bash", "terminal"],
    description: "Terminal commands",
    fn: East.function([], UIComponentType, (_$) => {
        return CodeBlock.Root("$ npm install @elaraai/east-ui\n$ npm run build\n$ npm test", {
            language: "bash",
        });
    }),
    inputs: [],
});

export const codeBlockInteractive = example({
    keywords: ["CodeBlock", "Reactive", "State", "interactive", "counter"],
    description: "Reactive code block whose contents update from a counter",
    fn: East.function([], UIComponentType, (_$) => {
        return Reactive.Root(East.function([], UIComponentType, $ => {
            const counter = $.let(State.bind([IntegerType], "code_block_counter", 0n));
            const value = $.let(counter.read());
            const increment = $.const(East.function([], NullType, $ => {
                const cur = $.let(counter.read());
                $(counter.write(cur.add(1n)));
            }));
            return Stack.VStack([
                CodeBlock.Root(East.str`function f() {\n  return ${East.print(value)};\n}`, {
                    language: "typescript",
                    showLineNumbers: true,
                }),
                Button.Root("Increment", { onClick: increment }),
            ], { gap: "3", align: "stretch" });
        }));
    }),
    inputs: [],
});
