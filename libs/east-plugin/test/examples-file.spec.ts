import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseExamplesFile } from '../scripts/examples-file.js';

// An apostrophe in JSX text, then one in a description: a text scan read the
// first as an unclosed string and dropped the example, and cut the second's
// description short at it (#846).
const FIXTURE = [
  '/** @jsxImportSource @elaraai/east-ui */',
  'import { East, example } from "@elaraai/east";',
  'import { Text, UIComponentType } from "@elaraai/east-ui";',
  '',
  '// ---',
  '// Captions',
  '// ---',
  '',
  'export const caption = example({',
  '    keywords: ["Text", "caption"],',
  '    description: "A caption over a sheet",',
  '    fn: East.function([], UIComponentType, (_$) => (',
  "        <Text>A task's seam inserts a task into its package</Text>",
  '    )),',
  '    inputs: [],',
  '});',
  '',
  'export const after = example({',
  '    keywords: ["Text"],',
  "    description: \"The example after it: nothing's dropped\",",
  '    fn: East.function([], UIComponentType, (_$) => <Text>after</Text>),',
  '    inputs: [],',
  '});',
  '',
].join('\n');

// An example that binds a dataset declared beside it, the type that dataset
// holds, a declaration only a JSX attribute is named like, and the file's
// prose and a divider above them: the example's source carries what its fn
// reaches, each under its own doc comment, and nothing else (#1178).
const BOUND_FIXTURE = [
  '/** @jsxImportSource @elaraai/e3-ui */',
  'import { DictType, East, StringType, StructType, example, variant } from "@elaraai/east";',
  'import { Stat, UIComponentType } from "@elaraai/east-ui";',
  'import { Data } from "@elaraai/e3-ui";',
  'import e3 from "@elaraai/e3";',
  '',
  '// The file\'s prose, about every example below.',
  '',
  '// ---',
  '// Bound',
  '// ---',
  '',
  '/** A machine. */',
  'export const Machine = StructType({ line: StringType });',
  '',
  '/** Nothing reaches this: the attributes below are only named like it. */',
  'export const label = "Machines";',
  '',
  '// A note, not a doc comment.',
  'export const machines = e3.input("machines", DictType(StringType, Machine), variant("value", new Map()));',
  '',
  'export const bound = example({',
  '    keywords: ["Data.bind"],',
  '    description: "A count of the machines",',
  '    fn: East.function([], UIComponentType, (_$) => {',
  '        const ops = $.let(Data.bind(machines));',
  '        return <Stat label="Machines" value={East.print(ops.read().size())} />;',
  '    }),',
  '    inputs: [],',
  '});',
  '',
  'export const literal = example({',
  '    keywords: ["Stat"],',
  '    description: "A literal stat",',
  '    fn: East.function([], UIComponentType, (_$) => <Stat label="Machine" value="none" />),',
  '    inputs: [],',
  '});',
  '',
].join('\n');

test('an example\'s source carries the module-scope declarations its fn reaches, under their doc comments', () => {
  const dir = mkdtempSync(join(tmpdir(), 'east-examples-'));
  try {
    const file = join(dir, 'bound.examples.tsx');
    writeFileSync(file, BOUND_FIXTURE);
    const [bound, literal] = parseExamplesFile(file);
    assert.equal(bound!.source, [
      '// A count of the machines',
      '// inputs: []',
      '/** A machine. */',
      'export const Machine = StructType({ line: StringType });',
      '',
      'export const machines = e3.input("machines", DictType(StringType, Machine), variant("value", new Map()));',
      '',
      'East.function([], UIComponentType, (_$) => {',
      '        const ops = $.let(Data.bind(machines));',
      '        return <Stat label="Machines" value={East.print(ops.read().size())} />;',
      '    })',
    ].join('\n'));
    // An example that reaches nothing is its fn alone.
    assert.equal(literal!.source, [
      '// A literal stat',
      '// inputs: []',
      'East.function([], UIComponentType, (_$) => <Stat label="Machine" value="none" />)',
    ].join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an example whose JSX text or description holds an apostrophe is read whole, with the one after it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'east-examples-'));
  try {
    const file = join(dir, 'captions.examples.tsx');
    writeFileSync(file, FIXTURE);
    const examples = parseExamplesFile(file);
    assert.deepEqual(examples.map((e) => e.exportName), ['caption', 'after']);
    const [caption, after] = examples;
    assert.equal(caption!.suiteName, 'Captions');
    assert.deepEqual(caption!.keywords, ['Text', 'caption']);
    assert.deepEqual(caption!.imports, [
      'import { East, example } from "@elaraai/east";',
      'import { Text, UIComponentType } from "@elaraai/east-ui";',
    ]);
    assert.equal(caption!.source, [
      '// A caption over a sheet',
      '// inputs: []',
      'East.function([], UIComponentType, (_$) => (',
      "        <Text>A task's seam inserts a task into its package</Text>",
      '    ))',
    ].join('\n'));
    assert.equal(after!.description, "The example after it: nothing's dropped");
    assert.equal(after!.source, [
      "// The example after it: nothing's dropped",
      '// inputs: []',
      'East.function([], UIComponentType, (_$) => <Text>after</Text>)',
    ].join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
