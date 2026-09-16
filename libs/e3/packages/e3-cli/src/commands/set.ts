/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 set command - Set dataset value from file
 *
 * Usage:
 *   e3 dataset set . ws.name ./data.beast2
 *   e3 dataset set . ws.name ./data.east
 *   e3 dataset set . ws.name ./data.json --type ".Integer"
 *   e3 dataset set . ws.name ./data.csv --type-file schema.east
 *   e3 dataset set . ws.name --from-file ./deliveries/TABLE.beast2
 *   e3 dataset set https://server/repos/myrepo ws.name ./data.east
 *
 * Paths use the flat form `<ws>.<name>`. The resolver maps `<name>` to
 * its storage location automatically.
 *
 * The positional form DECODES the file and re-encodes the value — a `.beast2`
 * file's header type is checked against the declared type first, by ranged
 * reads, so a drifted file is refused before it is read whole; `--from-file`
 * ADOPTS a `.beast2` file as it stands — hashing it by streaming, checking its
 * header against the declared type by ranged reads, and taking it into the
 * object store by link or one kernel copy. That is the form for a delivery too
 * big to decode, and the file is never modified.
 */

import { readFile } from 'fs/promises';
import { extname } from 'path';
import { stat } from 'node:fs/promises';
import { datasetAdoptFile, workspaceResolveDataset, workspaceSetDataset, LocalStorage } from '@elaraai/e3-core';
import { readDatasetFileHeader, readDatasetFileType, sha256File } from '@elaraai/e3';
import {
  datasetGetStatus as datasetGetStatusRemote,
  datasetSet as datasetSetRemote,
  datasetSetStream,
} from '@elaraai/e3-api-client';
import {
  decodeBeast2,
  parseFor,
  fromJSONFor,
  decodeCsvFor,
  encodeBeast2For,
  EastTypeType,
  type EastTypeValue,
  type StructTypeValue,
  parseInferred,
  toEastTypeValue,
} from '@elaraai/east';
import { checkDatasetType, type TreePath } from '@elaraai/e3-types';
import { parseRepoLocation, formatError, exitError, type RepoLocation } from '../utils.js';
import { resolveDatasetPath } from '../path-resolver.js';
import { formatSize } from '../format.js';
import { fileTransferSource } from '../file-transfer-source.js';

/**
 * Parse a type specification in .east format.
 */
function parseTypeSpec(typeSpec: string): EastTypeValue {
  const parser = parseFor(EastTypeType);
  const result = parser(typeSpec);
  if (!result.success) {
    throw new Error(`Invalid type specification: ${result.error}`);
  }
  return result.value as EastTypeValue;
}

/**
 * The type a dataset declares and the address every door names it by
 * (`.inputs.table`), from the deployed structure or the server.
 */
async function declaredDataset(
  location: RepoLocation,
  ws: string,
  path: TreePath
): Promise<{ address: string; type: EastTypeValue }> {
  if (location.type === 'local') {
    const leaf = await workspaceResolveDataset(new LocalStorage(), location.path, ws, path);
    return { address: leaf.address, type: leaf.type };
  }
  const detail = await datasetGetStatusRemote(
    location.baseUrl, location.repo, ws, path, { token: location.token }
  );
  return { address: detail.path, type: detail.type };
}

/**
 * Set dataset value from a file.
 */
export async function setCommand(
  repoArg: string,
  pathSpec: string,
  filePath: string | undefined,
  options: { type?: string; typeFile?: string; fromFile?: string } = {}
): Promise<void> {
  try {
    if (options.type && options.typeFile) {
      exitError('Specify either --type or --type-file, not both');
    }
    if (options.fromFile) {
      // --from-file adopts the bytes as they stand: re-encoding under another
      // type would mean decoding the file, which is exactly what this form
      // exists to avoid.
      if (filePath) exitError('Specify either a file argument or --from-file, not both');
      if (options.type || options.typeFile) {
        exitError('--from-file adopts the file as it stands — --type / --type-file would require decoding and re-encoding it');
      }
      // Awaited, so a refusal lands in the catch below and prints as one line.
      return await setFromFile(repoArg, pathSpec, options.fromFile);
    }
    if (!filePath) {
      exitError('Provide a file to read the value from, or --from-file to adopt a .beast2 file by hash');
    }

    const location = await parseRepoLocation(repoArg);
    const { ws, path } = await resolveDatasetPath(location, pathSpec);

    // Parse type specification if provided (inline or from file)
    let providedType: EastTypeValue | undefined;
    if (options.type) {
      providedType = parseTypeSpec(options.type);
    } else if (options.typeFile) {
      const typeContent = (await readFile(options.typeFile)).toString('utf-8');
      providedType = parseTypeSpec(typeContent);
    }

    const ext = extname(filePath).toLowerCase();
    if (ext === '.beast2') {
      // The header names the file's type in a ranged read: refuse a drifted
      // file from that, before reading and decoding all of it. The write door
      // checks again; this names the file and costs nothing when it passes.
      const declared = await declaredDataset(location, ws, path);
      const mismatch = checkDatasetType(
        `dataset '${declared.address}'`,
        filePath,
        declared.type,
        readDatasetFileType(filePath),
      );
      if (mismatch) exitError(mismatch.message);
    }

    // Read and decode the file based on extension
    const fileContent = await readFile(filePath);

    let value: unknown;
    let type: EastTypeValue;

    switch (ext) {
      case '.beast2': {
        const decoded = decodeBeast2(fileContent);
        // A .beast2 file carries its own type, and an override used to replace
        // it silently — so the value was decoded as one type and re-encoded as
        // another. Check instead: a genuine mismatch is the user's to resolve.
        if (providedType) {
          const mismatch = checkDatasetType(
            `--type`,
            filePath,
            providedType,
            toEastTypeValue(decoded.type as never),
          );
          if (mismatch) exitError(mismatch.message);
        }
        value = decoded.value;
        type = providedType ?? toEastTypeValue(decoded.type as never);
        break;
      }
      case '.east': {
        const content = fileContent.toString('utf-8');
        if (providedType) {
          const parser = parseFor(providedType);
          const result = parser(content);
          if (!result.success) {
            exitError(`Failed to parse .east file: ${result.error}`);
          }
          value = result.value;
          type = providedType;
        } else {
          const [parsedType, parsedValue] = parseInferred(content);
          value = parsedValue;
          type = toEastTypeValue(parsedType);
        }
        break;
      }
      case '.json': {
        if (!providedType) {
          exitError('JSON files require --type or --type-file. Example: --type ".Integer"');
        }
        const content = fileContent.toString('utf-8');
        const jsonValue = JSON.parse(content);
        const fromJSON = fromJSONFor(providedType);
        value = fromJSON(jsonValue);
        type = providedType;
        break;
      }
      case '.csv': {
        if (!providedType) {
          exitError('CSV files require --type or --type-file. Example: --type-file schema.east');
        }
        if (providedType.type !== 'Array') {
          exitError('CSV files require an Array type. Example: --type ".Array .Struct [...]"');
        }
        const elementType = providedType.value as EastTypeValue;
        if (elementType.type !== 'Struct') {
          exitError('CSV files require Array of Struct type. Example: --type ".Array .Struct [{name: \\"x\\", type: .Integer}]"');
        }
        const decoder = decodeCsvFor(elementType as StructTypeValue);
        value = decoder(fileContent);
        type = providedType;
        break;
      }
      default:
        exitError(`Unknown file extension: ${ext}. Supported: .beast2, .east, .json, .csv`);
    }

    if (location.type === 'local') {
      const storage = new LocalStorage();
      await workspaceSetDataset(storage, location.path, ws, path, value, type);
    } else {
      const encoder = encodeBeast2For(type);
      const beast2Data = encoder(value);
      await datasetSetRemote(
        location.baseUrl,
        location.repo,
        ws,
        path,
        beast2Data,
        { token: location.token }
      );
    }

    console.log(`Set ${pathSpec} from ${filePath}`);
  } catch (err) {
    exitError(formatError(err));
  }
}

/**
 * Point a dataset at an existing `.beast2` file, by hash.
 *
 * Locally the file is adopted straight into the object store; against a remote
 * repository it is streamed through the transfer protocol, whose commit runs
 * the same validation server-side.
 */
async function setFromFile(repoArg: string, pathSpec: string, file: string): Promise<void> {
  const location = await parseRepoLocation(repoArg);
  const { ws, path } = await resolveDatasetPath(location, pathSpec);

  if (location.type === 'local') {
    const storage = new LocalStorage();
    const result = await datasetAdoptFile(storage, location.path, ws, path, file);
    console.log(`Set ${pathSpec} from ${file}`);
    console.log(`Hash:   ${result.hash}`);
    console.log(`Size:   ${formatSize(result.size)}`);
    if (result.segments != null) console.log(`Segments: ${result.segments}`);
    if (result.rows != null) console.log(`Rows:   ${result.rows}`);
    return;
  }

  // Remote: ask the server what the dataset declares and check the header
  // against it HERE, before streaming gigabytes that would be refused at the
  // commit anyway. The commit re-checks server-side — that is the door — but
  // failing fast is worth one status round trip.
  const declared = await declaredDataset(location, ws, path);
  const { size } = await stat(file);
  readDatasetFileHeader(file, `dataset '${declared.address}'`, declared.type);
  const hash = await sha256File(file);
  await datasetSetStream(
    location.baseUrl,
    location.repo,
    ws,
    path,
    fileTransferSource(file, size, hash),
    { token: location.token }
  );
  console.log(`Set ${pathSpec} from ${file}`);
  console.log(`Hash:   ${hash}`);
  console.log(`Size:   ${formatSize(size)}`);
}
