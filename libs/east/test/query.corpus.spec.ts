/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* The query corpus (#875, #919 T1 and T3): a case for every JqType case, and
 * the checked-in fixture the python front end is held to — its header of wire
 * types included. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BlobType, EastTypeType, JqType, StringType,
  canonicalTypeValue, decodeBeast2For, equalFor, isTypeValueEqual, toEastTypeValue,
} from "../src/index.js";
import {
  QUERY_CORPUS, QUERY_WIRE_TYPES, QueryCorpusFixtureType,
  assertFixtureCurrent, queryCorpusBytes, typeValueBytes,
} from "./query.corpus.js";

const CORPUS_FILE = new URL("../../test/fixtures/query-corpus.beast2", import.meta.url);

describe("query corpus", () => {
  const checkedIn = new Uint8Array(readFileSync(CORPUS_FILE));
  const corpus = decodeBeast2For(QueryCorpusFixtureType)(checkedIn);

  test("every JqType case leads the name of a case", () => {
    for (const jqCase of Object.keys(JqType.node.cases)) {
      assert.ok(QUERY_CORPUS.some(c => c.name.startsWith(`${jqCase}-`)), `no corpus case for JqType's ${jqCase} case`);
    }
  });

  test("case names are unique and kebab-case", () => {
    const names = QUERY_CORPUS.map(c => c.name);
    assert.equal(new Set(names).size, names.length);
    for (const name of names) assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  test("the checked-in fixture is current", () => {
    assertFixtureCurrent("query-corpus.beast2", checkedIn, queryCorpusBytes());
  });

  test("a stale fixture fails with the instruction to rewrite it", () => {
    assert.throws(
      () => assertFixtureCurrent("query-corpus.beast2", checkedIn, checkedIn.subarray(1)),
      /test\/fixtures\/query-corpus\.beast2 .* run `make query-corpus`/,
    );
  });

  test("the header holds every query wire type's type value, canonically numbered", () => {
    assert.deepEqual([...corpus.types.keys()], Object.keys(QUERY_WIRE_TYPES).sort());
    const decodeType = decodeBeast2For(EastTypeType);
    for (const [name, type] of Object.entries(QUERY_WIRE_TYPES)) {
      const bytes = corpus.types.get(name);
      assert.ok(bytes !== undefined, name);
      assert.ok(equalFor(BlobType)(bytes, typeValueBytes(type)), `${name}'s bytes`);
      const typeValue = decodeType(bytes);
      assert.ok(isTypeValueEqual(typeValue, toEastTypeValue(type)), `${name} decodes to itself`);
      assert.ok(equalFor(EastTypeType)(typeValue, canonicalTypeValue(typeValue)), `${name} is canonically numbered`);
    }
  });

  test("every case is in the fixture, in corpus order, with its input type and program", () => {
    const equalString = equalFor(StringType);
    assert.equal(corpus.cases.length, QUERY_CORPUS.length);
    corpus.cases.forEach((entry, i) => {
      const c = QUERY_CORPUS[i]!;
      assert.ok(equalString(entry.case.name, c.name), c.name);
      assert.ok(equalString(entry.case.program, c.program), c.name);
      assert.ok(equalFor(EastTypeType)(entry.case.input, canonicalTypeValue(toEastTypeValue(c.input))), c.name);
    });
  });
});
