/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `e3 call`'s reading of what it was written with: the count of a call's own
 * arguments, and the drafts after `--draft` (east-workspace#1619), which the
 * command line hands over as one list of words.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArrayType, IntegerType, PatchType, DictType, StringType, encodeBeast2For, equalFor, toEastTypeValue } from '@elaraai/east';
import { FunctionDraftType, type RecordSignature } from '@elaraai/e3-types';
import { checkCallArguments, readDrafts } from './call.js';

const encodeInt = encodeBeast2For(IntegerType);
const encodeString = encodeBeast2For(StringType);
const sameDrafts = equalFor(ArrayType(FunctionDraftType));

/** The mutations of the records a case's workspace holds. */
const RECORDS = new Map<string, Pick<RecordSignature, 'mutations'>>([
  ['tally', {
    mutations: [
      { name: 'add', argTypes: [toEastTypeValue(IntegerType)], form: 'reduce' },
      { name: 'reset', argTypes: [], form: 'reduce' },
    ],
  }],
  ['notes', {
    mutations: [
      { name: 'rename', argTypes: [toEastTypeValue(StringType), toEastTypeValue(StringType)], form: 'edit' },
      { name: 'patch', argTypes: [toEastTypeValue(PatchType(DictType(StringType, StringType)))], form: 'patch' },
    ],
  }],
]);

/** A workspace's describe, and the records it was asked of. */
function workspace(): { readonly asked: string[]; describe(record: string): Promise<Pick<RecordSignature, 'mutations'> | null> } {
  const asked: string[] = [];
  return {
    asked,
    describe: (record) => {
      asked.push(record);
      return Promise.resolve(RECORDS.get(record) ?? null);
    },
  };
}

/** The words a reading of drafts is refused in. */
async function refusal(words: string[]): Promise<string> {
  try {
    await readDrafts(words, 'dev', workspace().describe);
  } catch (err) {
    if (err instanceof Error) return err.message;
    throw err;
  }
  return assert.fail(`read ${words.join(' ')}`);
}

const OWN_FIRST = "a call's own arguments are written before the first --draft, which reads every word up to the next option";

describe('readDrafts', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'e3-call-drafts-'));
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it('reads each draft as its mutation and as many words as it takes, in the order written, describing a record once', async () => {
    const seven = join(dir, 'seven.east');
    writeFileSync(seven, '7');
    const ws = workspace();
    const drafts = await readDrafts(['tally.add', '5', 'tally.reset', 'notes.rename', '"a"', '"b"', 'tally.add', seven], 'dev', ws.describe);
    assert.ok(sameDrafts(drafts, [
      { record: 'tally', mutation: 'add', args: [encodeInt(5n)] },
      { record: 'tally', mutation: 'reset', args: [] },
      { record: 'notes', mutation: 'rename', args: [encodeString('a'), encodeString('b')] },
      { record: 'tally', mutation: 'add', args: [encodeInt(7n)] },
    ]), 'each argument read against its type, a literal or a file, as e3 mutate reads one');
    assert.deepEqual(ws.asked, ['tally', 'notes']);
    assert.deepEqual(await readDrafts([], 'dev', ws.describe), [], 'a call written with none passes none');
  });

  it('refuses a word that starts a draft and names no mutation of a record, saying how the draft before it decided the reading', async () => {
    assert.equal(await refusal(['nope']), "Draft 1: 'nope' is not a mutation, written <record>.<mutation>");
    assert.equal(await refusal(['ghost.add', '1']), "Draft 1 (ghost.add): record 'ghost' not found in workspace 'dev'");
    assert.equal(await refusal(['tally.nope']), "Draft 1 (tally.nope): mutation 'nope' not found on record 'tally'. Available: add, reset");
    // A call's own argument written after its drafts is read as one more
    assert.equal(await refusal(['tally.add', '5', '"P1"']),
      `Draft 2: '"P1"' is not a mutation, written <record>.<mutation> — draft 1 (tally.add) takes 1 argument(s), so '"P1"' was read as the draft after it; ${OWN_FIRST}`);
    // One word too many: a file's name splits as a mutation does
    assert.equal(await refusal(['tally.add', '5', 'b.json']),
      `Draft 2 (b.json): record 'b' not found in workspace 'dev' — draft 1 (tally.add) takes 1 argument(s), so 'b.json' was read as the draft after it; ${OWN_FIRST}`);
    assert.equal(await refusal(['tally.reset', 'tally.sum']),
      `Draft 2 (tally.sum): mutation 'sum' not found on record 'tally'. Available: add, reset — draft 1 (tally.reset) takes 0 argument(s), so 'tally.sum' was read as the draft after it; ${OWN_FIRST}`);
  });

  it('refuses a draft with fewer words than its mutation takes, and an argument that does not match its type, naming the draft', async () => {
    assert.equal(await refusal(['tally.reset', 'tally.add']), "Draft 2 (tally.add): Mutation 'add' expects 1 argument(s), got 0");
    assert.match(await refusal(['notes.patch']), /^Draft 1 \(notes\.patch\): Mutation 'patch' expects 1 argument\(s\), got 0 — a patch mutation takes one argument, the record's patch /);
    assert.match(await refusal(['tally.reset', 'tally.add', '"five"']), /^Draft 2 \(tally\.add\): Argument 1: failed to parse '"five"': /);
    // The words of the draft after it are a draft's own until it has as many as it takes
    assert.match(await refusal(['notes.rename', '"a"', 'tally.reset']), /^Draft 1 \(notes\.rename\): Argument 2: failed to parse 'tally\.reset': /);
  });
});

describe('checkCallArguments', () => {
  const signature = { inputs: [], argTypes: [toEastTypeValue(StringType)], outputType: toEastTypeValue(IntegerType) };

  it('counts the arguments alone, and says where they go when a draft was written with them', () => {
    checkCallArguments('jobs_on', signature, ['"P1"'], 'dev', true);
    assert.throws(() => checkCallArguments('jobs_on', signature, [], 'dev'),
      (err: Error) => err.message === "Function 'jobs_on' expects 1 argument(s), got 0");
    assert.throws(() => checkCallArguments('jobs_on', signature, [], 'dev', true),
      (err: Error) => err.message === `Function 'jobs_on' expects 1 argument(s), got 0 — ${OWN_FIRST}`);
  });
});
