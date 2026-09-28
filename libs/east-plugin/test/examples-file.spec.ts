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
