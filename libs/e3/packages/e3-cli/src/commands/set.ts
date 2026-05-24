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
 *   e3 dataset set https://server/repos/myrepo ws.name ./data.east
 *
 * Paths use the flat form `<ws>.<name>`. The resolver maps `<name>` to
 * its storage location automatically.
 */

import { readFile } from 'fs/promises';
import { extname } from 'path';
import { workspaceSetDataset, LocalStorage } from '@elaraai/e3-core';
import { datasetSet as datasetSetRemote } from '@elaraai/e3-api-client';
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
import { parseRepoLocation, formatError, exitError } from '../utils.js';
import { resolveDatasetPath } from '../path-resolver.js';

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
 * Set dataset value from a file.
 */
export async function setCommand(
  repoArg: string,
  pathSpec: string,
  filePath: string,
  options: { type?: string; typeFile?: string } = {}
): Promise<void> {
  try {
    if (options.type && options.typeFile) {
      exitError('Specify either --type or --type-file, not both');
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

    // Read and decode the file based on extension
    const fileContent = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();

    let value: unknown;
    let type: EastTypeValue;

    switch (ext) {
      case '.beast2': {
        const decoded = decodeBeast2(fileContent);
        value = decoded.value;
        type = providedType ?? decoded.type;
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
