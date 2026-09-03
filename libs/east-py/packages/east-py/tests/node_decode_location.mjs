/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/*
 * The east-node leg of the #626 error-location pin
 * (tests/test_expression_locations.py): decode a self-describing beast2 blob
 * holding a python-built Function value with the TypeScript runtime, call it
 * with the integer argument given, and print the EastError's location stack
 * as JSON — proving the python authoring frames ride the blob's source map
 * and resolve under another runtime's decoder.
 *
 * Usage: node node_decode_location.mjs <blob> <path-to-libs/east/dist/src/index.js> <arg>
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [blobPath, eastIndex, arg] = process.argv.slice(2);
if (!blobPath || !eastIndex || arg === undefined) {
  console.error('usage: node node_decode_location.mjs <blob> <east index.js> <integer arg>');
  process.exit(2);
}

const { decodeBeast2, EastError } = await import(pathToFileURL(eastIndex).href);
const { value } = decodeBeast2(new Uint8Array(readFileSync(blobPath)));

try {
  const result = value(BigInt(arg));
  console.log(JSON.stringify({ raised: false, result: String(result) }));
} catch (e) {
  if (!(e instanceof EastError)) throw e;
  console.log(JSON.stringify({
    raised: true,
    message: e.message,
    location: e.location.map(l => ({
      filename: l.filename, line: Number(l.line), column: Number(l.column),
    })),
  }));
}
