/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The stream command builder and the location strip (issue #770): the argv a
 * stream execution spawns for each merge mode and streamed-input choice, and
 * the guarantee that synthesized IR hashes identically wherever it is built.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { East, IntegerType, encodeEastIR, variant } from '@elaraai/east';
import { streamCommandIr, stripIrLocations, type StreamCommandSpec } from './stream.js';
import type { RunnerValue } from './runner.js';

const EAST_C: RunnerValue = variant('east_c', { platforms: ['east-c-std'] });

/** The argv a stream command evaluates to for the staged `inputs`. */
function argvOf(runner: RunnerValue, spec: StreamCommandSpec, inputs: string[]): string[] {
  return streamCommandIr(runner, spec).compile([])(inputs, 'out.beast2');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Every `loc_id` in an IR value — each node's, variable's and label's. */
function locIds(value: unknown, found: bigint[] = []): bigint[] {
  if (Array.isArray(value)) {
    for (const item of value) locIds(item, found);
  } else if (value !== null && typeof value === 'object') {
    for (const [field, child] of Object.entries(value)) {
      if (field === 'loc_id') found.push(child as bigint);
      else if (field !== 'type' && field !== 'type_parameters') locIds(child, found);
    }
  }
  return found;
}

describe('streamCommandIr', () => {
  it('builds a merge unit argv: the merge IR as --merge, every -i input streamed', () => {
    assert.deepEqual(
      argvOf(EAST_C, { emit: 'dict', merge: 'function', stream: 'all' }, ['body.beast2', 'merge.beast2', 'p0.beast2', 'p1.beast2']),
      ['east-c', 'run', '-p', 'east-c-std', '--emit', 'dict', '--merge', 'merge.beast2',
        '--stream', '0', '--stream', '1', '-i', 'p0.beast2', '-i', 'p1.beast2', '-o', 'out.beast2', 'body.beast2'],
    );
  });

  it('builds a union set argv streaming the first input', () => {
    assert.deepEqual(
      argvOf(EAST_C, { emit: 'set', merge: 'union', stream: 'first' }, ['body.beast2', 'stream.beast2', 'other.beast2']),
      ['east-c', 'run', '-p', 'east-c-std', '--emit', 'set', '--union', '--stream', '0',
        '-i', 'stream.beast2', '-i', 'other.beast2', '-o', 'out.beast2', 'body.beast2'],
    );
  });

  it('builds a producer argv with no merge flag and no streamed input', () => {
    assert.deepEqual(
      argvOf(EAST_C, { emit: 'array', merge: 'none', stream: 'none' }, ['body.beast2', 'config.beast2']),
      ['east-c', 'run', '-p', 'east-c-std', '--emit', 'array', '-i', 'config.beast2', '-o', 'out.beast2', 'body.beast2'],
    );
  });

  it('streams no input when every input is streamed but there are none', () => {
    assert.deepEqual(
      argvOf(EAST_C, { emit: 'dict', merge: 'none', stream: 'all' }, ['body.beast2']),
      ['east-c', 'run', '-p', 'east-c-std', '--emit', 'dict', '-o', 'out.beast2', 'body.beast2'],
    );
  });

  it('starts from the runner argv of every stock runtime', () => {
    const node: RunnerValue = variant('east_node', { platforms: ['@elaraai/east-node-std'] });
    const argv = argvOf(node, { emit: 'set', merge: 'none', stream: 'first' }, ['body.beast2', 'rows.beast2']);
    assert.deepEqual(argv.slice(0, 6), ['east-node', 'run', '-p', '@elaraai/east-node-std', '--emit', 'set']);
  });

  it('hashes identically on every build, with no locations', () => {
    const spec: StreamCommandSpec = { emit: 'dict', merge: 'function', stream: 'all' };
    const first = streamCommandIr(EAST_C, spec);
    const second = streamCommandIr(EAST_C, spec);
    assert.equal(sha256(encodeEastIR(first)), sha256(encodeEastIR(second)));
    assert.ok(locIds(first.ir).length > 0, 'the IR has nodes, variables and labels to strip');
    assert.ok(locIds(first.ir).every((id) => id === 0n), 'every loc_id is 0');
    assert.equal(first.source_map?.size, 1n, 'the source map holds only the reserved empty entry');
  });
});

describe('stripIrLocations', () => {
  it('zeroes every loc_id and empties the source map, leaving its input untouched', () => {
    // A parameter, a variable and a loop label, each with its own location.
    const built = East.function([IntegerType], IntegerType, ($, n) => {
      const total = $.let(0n);
      $.while(East.less(total, n), $ => {
        $.assign(total, total.add(1n));
      });
      return total;
    }).toIR();
    const before = locIds(built.ir);
    assert.ok(before.some((id) => id !== 0n), 'a built IR records its locations');

    const stripped = stripIrLocations(built);
    assert.ok(locIds(stripped.ir).every((id) => id === 0n));
    assert.equal(stripped.source_map?.size, 1n);
    assert.deepEqual(locIds(built.ir), before, 'the input keeps its locations');
    assert.equal(stripped.compile([])(3n), 3n, 'the stripped program runs the same');
  });

  it('encodes the same program built at two call sites to the same bytes', () => {
    const here = East.function([IntegerType], IntegerType, ($, n) => {
      const total = $.let(0n);
      $.while(East.less(total, n), $ => {
        $.assign(total, total.add(1n));
      });
      return total;
    }).toIR();
    const there = East.function([IntegerType], IntegerType, ($, n) => {
      const total = $.let(0n);
      $.while(East.less(total, n), $ => {
        $.assign(total, total.add(1n));
      });
      return total;
    }).toIR();
    assert.notEqual(sha256(encodeEastIR(here)), sha256(encodeEastIR(there)), 'built IR carries its call site');
    assert.equal(sha256(encodeEastIR(stripIrLocations(here))), sha256(encodeEastIR(stripIrLocations(there))));
  });
});
