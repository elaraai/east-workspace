/**
 * Beast2 v2 benchmark — profiles encode/decode of a massive UI component tree
 * with deeply nested recursive components containing function closures that
 * themselves return complex nested UI trees with more closures.
 *
 * Target: 10+ MB encoded size, hundreds of closures, deep nesting.
 *
 * Usage: npx tsx contrib/examples/beast2_v2_benchmark.ts
 */
import {
  East,
  RecursiveType, VariantType, ArrayType, OptionType, StructType,
  StringType, IntegerType, FloatType, BooleanType, FunctionType, NullType, DictType,
} from "../../src/index.js";
import { encodeBeast2For as v2Encode, decodeBeast2For as v2Decode } from "../../src/serialization/beast2.js";
import { variant } from "../../src/containers/variant.js";
import { IRType } from "../../src/ir.js";
import { EAST_IR_SYMBOL } from "../../src/compile.js";

// =============================================================================
// 1. Define UIType — recursive variant with closures at many positions
// =============================================================================

const StyleType = StructType({
  color: OptionType(StringType), fontSize: OptionType(StringType),
  padding: OptionType(StringType), margin: OptionType(StringType),
  width: OptionType(StringType), height: OptionType(StringType),
  display: OptionType(StringType), background: OptionType(StringType),
  border: OptionType(StringType), borderRadius: OptionType(StringType),
  opacity: OptionType(FloatType), zIndex: OptionType(IntegerType),
});

const EventType = StructType({ target: StringType, value: OptionType(StringType) });

const UIType = RecursiveType(self => VariantType({
  Text: StructType({ content: StringType, style: OptionType(StyleType) }),
  Heading: StructType({ level: IntegerType, content: StringType }),
  Code: StructType({ content: StringType, language: OptionType(StringType) }),
  Link: StructType({ href: StringType, label: StringType }),
  Box: StructType({ children: ArrayType(self), style: OptionType(StyleType) }),
  Stack: StructType({ children: ArrayType(self), direction: OptionType(StringType) }),
  Grid: StructType({ children: ArrayType(self), columns: IntegerType }),
  Button: StructType({ label: StringType, onClick: FunctionType([EventType], self), style: OptionType(StyleType) }),
  Toggle: StructType({ checked: BooleanType, onChange: FunctionType([BooleanType], self) }),
  Select: StructType({
    value: StringType,
    options: ArrayType(StructType({ label: StringType, value: StringType })),
    onChange: FunctionType([StringType], self),
  }),
  TextInput: StructType({ value: StringType, onChange: FunctionType([StringType], self) }),
  Slider: StructType({ value: FloatType, min: FloatType, max: FloatType, onChange: FunctionType([FloatType], self) }),
  Checkbox: StructType({ checked: BooleanType, label: StringType, onChange: FunctionType([BooleanType], self) }),
  Computed: StructType({ render: FunctionType([], self) }),
  Conditional: StructType({ condition: FunctionType([], BooleanType), then: self, else: OptionType(self) }),
  ListRender: StructType({ items: ArrayType(StringType), renderItem: FunctionType([StringType, IntegerType], self) }),
  Card: StructType({ header: OptionType(self), body: ArrayType(self), footer: OptionType(self) }),
  Accordion: StructType({ items: ArrayType(StructType({ title: StringType, content: self })) }),
  Tabs: StructType({ items: ArrayType(StructType({ label: StringType, content: self })), activeIndex: IntegerType }),
  Dialog: StructType({ trigger: self, body: ArrayType(self), onClose: FunctionType([], self) }),
  Tooltip: StructType({ trigger: self, content: StringType }),
  Badge: StructType({ content: StringType, style: OptionType(StyleType) }),
  Progress: StructType({ value: FloatType, max: FloatType }),
  Tag: StructType({ content: StringType }),
  Stat: StructType({ label: StringType, value: self }),
  DataTable: StructType({
    columns: ArrayType(StructType({ header: StringType, accessor: StringType })),
    data: ArrayType(DictType(StringType, StringType)),
    onRowClick: OptionType(FunctionType([IntegerType], self)),
  }),
  Separator: NullType,
  Spacer: NullType,
}));

// =============================================================================
// 2. Helper factories
// =============================================================================

const none = variant("none", null);
const some = <T>(v: T) => variant("some", v);

let closureCount = 0;

/** Create a Computed component with a render closure that builds nested UI */
function computed(bodyFn: ($: any) => any): any {
  closureCount++;
  const fn = East.compile(East.function([], UIType, bodyFn), []);
  return variant("Computed", { render: fn });
}

/** Create a button with an onClick closure that returns a nested UI subtree */
function button(label: string, responseFn: ($: any, e: any) => any): any {
  closureCount++;
  const handler = East.compile(East.function([EventType], UIType, responseFn), []);
  return variant("Button", { label, onClick: handler, style: none });
}

/** Create a toggle with onChange closure */
function toggle(checked: boolean, changeFn: ($: any, v: any) => any): any {
  closureCount++;
  const handler = East.compile(East.function([BooleanType], UIType, changeFn), []);
  return variant("Toggle", { checked, onChange: handler });
}

/** Create a dialog with onClose closure and nested body closures */
function dialog(trigger: any, bodyItems: any[]): any {
  closureCount++;
  const closeFn = East.compile(East.function([], UIType, $ =>
    $.const(variant("Spacer"), UIType)
  ), []);
  return variant("Dialog", { trigger, body: bodyItems, onClose: closeFn });
}

function text(s: string): any { return variant("Text", { content: s, style: none }); }
function heading(level: bigint, s: string): any { return variant("Heading", { level, content: s }); }
function badge(s: string): any { return variant("Badge", { content: s, style: none }); }
function tag(s: string): any { return variant("Tag", { content: s }); }
function progress(v: number): any { return variant("Progress", { value: v, max: 1.0 }); }
function spacer(): any { return variant("Spacer"); }
function separator(): any { return variant("Separator"); }
function box(children: any[]): any { return variant("Box", { children, style: none }); }
function stack(children: any[], dir?: string): any { return variant("Stack", { children, direction: dir ? some(dir) : none }); }

// =============================================================================
// 3. Build a DEEP, COMPLEX tree
// =============================================================================

/** Generate a form section — each field has an onChange closure */
function generateForm(prefix: string, numFields: number): any {
  return stack(
    Array.from({ length: numFields }, (_, i) => {
      const fieldName = `${prefix}_field_${i}`;
      return box([
        text(fieldName),
        toggle(i % 2 === 0, ($, checked) => {
          // Closure returns a nested UI subtree
          return $.const(variant("Stack", {
            children: [
              $.const(variant("Text", { content: checked.ifElse(
                () => East.value("Enabled"),
                () => East.value("Disabled"),
              ), style: none }), UIType),
              $.const(variant("Badge", { content: fieldName, style: none }), UIType),
              $.const(variant("Progress", { value: 0.5, max: 1.0 }), UIType),
            ],
            direction: some("column"),
          }), UIType);
        }),
      ]);
    }),
    "column",
  );
}

/** Generate a data panel — computed metrics with nested closures */
function generateDataPanel(prefix: string, numMetrics: number): any {
  return variant("Card", {
    header: some(heading(3n, `${prefix} Data`)),
    body: Array.from({ length: numMetrics }, (_, i) =>
      computed($ => {
        const val = $.const(BigInt(100 + i), IntegerType);
        const label = $.const(`${prefix}-metric-${i}`, StringType);
        // Return a complex nested structure from the closure
        return $.const(variant("Box", {
          children: [
            $.const(variant("Stat", {
              label: label,
              value: $.const(variant("Text", { content: val.toString(), style: none }), UIType),
            }), UIType),
            $.const(variant("Progress", { value: (i + 1) / numMetrics, max: 1.0 }), UIType),
            // Nested button INSIDE the computed closure — closure within closure
            $.const(variant("Button", {
              label: East.str`Details for ${label}`,
              onClick: $.const(East.function([EventType], UIType, (_$2, _e) =>
                $.const(variant("Text", { content: East.str`Showing ${label}`, style: none }), UIType)
              )),
              style: none,
            }), UIType),
          ],
          style: none,
        }), UIType);
      })
    ),
    footer: some(text(`${prefix} footer`)),
  });
}

/** Generate a settings panel with deeply nested interactive components */
function generateSettingsPanel(prefix: string, numGroups: number, fieldsPerGroup: number): any {
  return variant("Accordion", {
    items: Array.from({ length: numGroups }, (_, g) => ({
      title: `${prefix} Group ${g}`,
      content: variant("Stack", {
        children: [
          generateForm(`${prefix}_g${g}`, fieldsPerGroup),
          // Dialog inside each group
          dialog(
            button(`Configure ${prefix} G${g}`, ($, _e) =>
              $.const(variant("Text", { content: `Config for group ${g}`, style: none }), UIType)
            ),
            Array.from({ length: 3 }, (_, d) =>
              computed($ =>
                $.const(variant("Stack", {
                  children: [
                    $.const(variant("Text", { content: `Dialog item ${d}`, style: none }), UIType),
                    $.const(variant("Tag", { content: `tag-${d}` }), UIType),
                  ],
                  direction: none,
                }), UIType)
              )
            ),
          ),
        ],
        direction: some("column"),
      }),
    })),
  });
}

/** Generate a full dashboard page — tabs with nested panels */
function generateDashboard(id: number): any {
  return variant("Card", {
    header: some(stack([
      heading(2n, `Dashboard ${id}`),
      badge(`v${id}.0`),
    ], "row")),
    body: [
      // Tab bar with 4 tabs, each containing deep content
      variant("Tabs", {
        items: [
          {
            label: "Overview",
            content: stack([
              generateDataPanel(`d${id}-overview`, 8),
              separator(),
              stack(Array.from({ length: 4 }, (_, i) =>
                button(`Action ${i}`, ($, _e) =>
                  $.const(variant("Box", {
                    children: [
                      $.const(variant("Text", { content: `Action ${i} result`, style: none }), UIType),
                      $.const(variant("Badge", { content: "new", style: none }), UIType),
                    ],
                    style: none,
                  }), UIType)
                )
              ), "row"),
            ], "column"),
          },
          {
            label: "Analytics",
            content: generateDataPanel(`d${id}-analytics`, 10),
          },
          {
            label: "Settings",
            content: generateSettingsPanel(`d${id}-settings`, 4, 5),
          },
          {
            label: "Advanced",
            content: stack([
              generateForm(`d${id}-advanced`, 6),
              generateDataPanel(`d${id}-adv-data`, 5),
              // Deeply nested dialog with more closures
              dialog(
                button(`Deep Action ${id}`, ($, _e) =>
                  $.const(variant("Text", { content: "deep", style: none }), UIType)
                ),
                [
                  generateDataPanel(`d${id}-deep`, 4),
                  generateForm(`d${id}-deep-form`, 3),
                ],
              ),
            ], "column"),
          },
        ],
        activeIndex: 0n,
      }),
    ],
    footer: some(stack([text(`Dashboard ${id} — `), badge("active")], "row")),
  });
}

console.log("Building component tree...");
const t0 = performance.now();

const NUM_DASHBOARDS = 20;
const page = variant("Grid", {
  children: Array.from({ length: NUM_DASHBOARDS }, (_, i) => generateDashboard(i)),
  columns: 3n,
});

const t1 = performance.now();
console.log(`Built ${NUM_DASHBOARDS} dashboards with ${closureCount} closures in ${(t1 - t0).toFixed(0)}ms`);

// =============================================================================
// 4. Benchmark
// =============================================================================

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function bench(label: string, fn: () => void, iterations: number = 10): number {
  fn(); // warmup
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;
  const perCall = elapsed / iterations;
  console.log(`  ${label}: ${perCall.toFixed(1)} ms/call (${iterations}× = ${(elapsed / 1000).toFixed(1)}s)`);
  return perCall;
}

import inspector from "node:inspector";
import fs from "node:fs";

async function cpuProfile(label: string, fn: () => void): Promise<void> {
  const session = new inspector.Session();
  session.connect();
  session.post("Profiler.enable");
  session.post("Profiler.start");

  fn();

  return new Promise((resolve) => {
    session.post("Profiler.stop", (err: Error | null, { profile }: any) => {
      const filename = `beast2_${label}.cpuprofile`;
      fs.writeFileSync(filename, JSON.stringify(profile));
      console.log(`  wrote ${filename}`);
      session.disconnect();
      resolve();
    });
  });
}

console.log("\n=== v2 (flat type table + string table) ===");
const v2Encoder = v2Encode(UIType);
let v2Blob: Uint8Array = v2Encoder(page);
console.log(`  encoded size: ${humanSize(v2Blob.length)}`);
const v2HeaderLen = v2Blob[8]!;
console.log(`  type table header: ${humanSize(v2HeaderLen + 1)}`);

// Write blob to file for C profiler
fs.writeFileSync("/tmp/ui.beast2", v2Blob);
console.log(`  wrote /tmp/ui.beast2`);

// Also write a beast2 IR file: a function that returns the UI tree
// This can be loaded and executed by east-c CLI
const uiFn = East.compile(East.function([], UIType, ($) => {
  return $.const(page, UIType);
}), []);
const irValue = (uiFn as any)[EAST_IR_SYMBOL];
if (irValue) {
  const irEncoder = v2Encode(IRType);
  const irBlob = irEncoder(irValue);
  fs.writeFileSync("/tmp/ui_fn.beast2", irBlob);
  console.log(`  wrote /tmp/ui_fn.beast2 (${humanSize(irBlob.length)})`);
}

// Warmup
v2Encoder(page);
const v2Decoder = v2Decode(UIType);
v2Decoder(v2Blob);

// Profile encode
const ENCODE_ITERS = 10;
console.log(`\n  Profiling encode (${ENCODE_ITERS} iterations)...`);
const encStart = performance.now();
await cpuProfile("encode", () => {
  for (let i = 0; i < ENCODE_ITERS; i++) v2Blob = v2Encoder(page);
});
const encElapsed = performance.now() - encStart;
console.log(`  encode: ${(encElapsed / ENCODE_ITERS).toFixed(1)} ms/call`);

// Profile decode
const DECODE_ITERS = 5;
console.log(`\n  Profiling decode (${DECODE_ITERS} iterations)...`);
const decStart = performance.now();
await cpuProfile("decode", () => {
  for (let i = 0; i < DECODE_ITERS; i++) v2Decoder(v2Blob);
});
const decElapsed = performance.now() - decStart;
console.log(`  decode: ${(decElapsed / DECODE_ITERS).toFixed(1)} ms/call`);

console.log("\n=== Summary ===");
console.log(`  size: ${humanSize(v2Blob.length)}`);
console.log(`  encode: ${(encElapsed / ENCODE_ITERS).toFixed(1)} ms`);
console.log(`  decode: ${(decElapsed / DECODE_ITERS).toFixed(1)} ms`);
