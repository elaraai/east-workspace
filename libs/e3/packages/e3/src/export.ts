/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Export functionality for e3 packages.
 *
 * Exports a package definition to a .zip bundle that can be imported
 * into an e3 repository. The bundle is a valid subset of an e3 repository:
 * - `packages/<name>/<version>` - ref to package object hash
 * - `objects/<ab>/<cdef...>.beast2` - content-addressed objects
 * - `data/<path>.ref` - per-dataset reference files (beast2 encoded DatasetRef)
 */

import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import yazl from 'yazl';
import { variant, encodeBeast2For, encodeEastIR, EastIR, AsyncEastIR, printIdentifier, SortedMap, toEastTypeValue } from '@elaraai/east';
import type { Structure, PackageObject, DatasetRef, FunctionObject } from '@elaraai/e3-types';
import { DatasetRefType, PackageObjectType, TaskObjectType, FunctionObjectType } from '@elaraai/e3-types';
import type { PackageDef, PackageItem } from './types.js';
import { runnerToVariant } from './runner.js';

/**
 * Exports a package to a .zip bundle.
 *
 * The bundle can be imported into an e3 repository using `e3 package import`.
 * It contains all objects needed for the package, plus a ref at
 * `packages/<name>/<version>` pointing to the package object, and per-dataset
 * reference files in `data/`.
 *
 * @param pkg - The package to export
 * @param outputPath - Path to write the .zip file
 *
 * @example
 * ```ts
 * await e3.export(pkg, './my-package-1.0.0.zip');
 * ```
 */
// Named export_ to avoid conflict with reserved word
export async function export_<D extends Record<string, any>>(pkg: PackageDef<D>, outputPath: string): Promise<void> {
  const partialPath = `${outputPath}.partial`;

  // Create zip file
  const zipfile = new yazl.ZipFile();

  // Initialize empty package object that we'll populate as we iterate
  const tasks = new SortedMap<string, string>(); // name -> task object hash
  const structures = new Map<string, Structure>(); // path -> structure (parallel to tree hierarchy)
  const refs = new SortedMap<string, DatasetRef>(); // refPath -> DatasetRef

  // Create root structure as first entry
  structures.set('', variant('struct', new SortedMap()));

  // Iterate over package contents and write each object
  // Contents are topologically sorted, so dependencies come before dependents
  for (const item of pkg.contents) {
    if (item.kind === "datatree") {
      // Trees are accumulated in the structure map

      // Get parent structure
      const parentPath = item.path.slice(0, -1).map(segment => {
        if (segment.type !== 'field') {
          throw new Error(`Unsupported tree path segment type in path ${item.path}: ${segment.type}`);
        }
        return `.${printIdentifier(segment.value)}`;
      }).join('');

      const parentStructure = structures.get(parentPath);
      if (!parentStructure || parentStructure.type !== 'struct') {
        throw new Error(`Missing or invalid parent structure at path: ${parentPath}`);
      }

      // Add this tree as a child struct in the structure
      const segment = item.path[item.path.length - 1];
      if (segment.type !== 'field') {
        throw new Error(`Unsupported tree path segment type in path ${item.path}: ${segment.type}`);
      }
      const name = segment.value;
      const path = `${parentPath}.${printIdentifier(name)}`;
      const childStructure: Structure = variant('struct', new SortedMap());
      parentStructure.value.set(name, childStructure);
      structures.set(path, childStructure);

    } else if (item.kind === "dataset") {
      // Datasets: serialize value to object store, write DatasetRef to data/ dir

      // Get parent structure
      const parentPath = item.path.slice(0, -1).map(segment => {
        if (segment.type !== 'field') {
          throw new Error(`Unsupported tree path segment type in path ${item.path}: ${segment.type}`);
        }
        return `.${printIdentifier(segment.value)}`;
      }).join('');

      const parentStructure = structures.get(parentPath);
      if (!parentStructure || parentStructure.type !== 'struct') {
        throw new Error(`Missing or invalid parent structure at path: ${parentPath}`);
      }

      const segment = item.path[item.path.length - 1];
      if (segment.type !== 'field') {
        throw new Error(`Unsupported tree path segment type in path ${item.path}: ${segment.type}`);
      }
      const name = segment.value;

      // Build the ref path from tree path segments (e.g., "inputs/greeting")
      const refPath = item.path.map(seg => {
        if (seg.type !== 'field') {
          throw new Error(`Unsupported path segment type: ${seg.type}`);
        }
        return seg.value;
      }).join('/');

      // Serialize default value (if present) and build DatasetRef.
      // When the dataset default is an EastIR / AsyncEastIR bundle (e.g. a
      // task's function_ir dataset set by task.ts), use encodeEastIR so the
      // source map is preserved in the beast2 blob. Otherwise fall back to
      // the generic typed encoder.
      let datasetRef: DatasetRef;
      if (item.default !== undefined) {
        let valueData: Uint8Array;
        if (item.default instanceof EastIR || item.default instanceof AsyncEastIR) {
          valueData = encodeEastIR(item.default);
        } else {
          valueData = encodeBeast2For(item.type)(item.default);
        }
        const valueHash = addObject(zipfile, Buffer.from(valueData));
        datasetRef = variant('value', { hash: valueHash, versions: new Map() });
      } else {
        datasetRef = variant('unassigned', null);
      }

      // Store ref in the package-level refs map
      refs.set(refPath, datasetRef);

      // Also write DatasetRef to zip as data/<refPath>.ref (for readability/debugging)
      const refEncoder = encodeBeast2For(DatasetRefType);
      const refData = refEncoder(datasetRef);
      zipfile.addBuffer(Buffer.from(refData), `data/${refPath}.ref`, { mtime: DETERMINISTIC_MTIME });

      // Update structure: add value type with writable flag to parent
      const typeValue = toEastTypeValue(item.type);
      parentStructure.value.set(name, variant('value', { type: typeValue, writable: item.writable }));

    } else if (item.kind === "task") {
      // Tasks are serialized and written immediately

      // Build input paths from the task definition
      // Note: e3.task() includes function_ir in inputs, e3.customTask() does not
      const inputPaths = item.inputs.map(input => input.path);

      // Serialize command IR — item.command is an EastIR bundle so this
      // preserves the source map.
      const commandIrData = encodeEastIR(item.command);
      const commandIrHash = addObject(zipfile, Buffer.from(commandIrData));

      // Build TaskObject
      const taskObject = {
        commandIr: commandIrHash,
        inputs: inputPaths,
        output: item.output.path,
        kind: item.taskKind ? variant('some', item.taskKind) : variant('none', null),
        metadata: item.metadata ? variant('some', item.metadata) : variant('none', null),
      };

      // Serialize and add to zip
      const taskEncoder = encodeBeast2For(TaskObjectType);
      const taskData = taskEncoder(taskObject);
      const taskHash = addObject(zipfile, Buffer.from(taskData));

      // Add to package tasks map
      tasks.set(item.name, taskHash);

    } else {
      throw new Error(`Unknown package item kind: ${(item satisfies never as PackageItem).kind}`);
    }
  }

  // Write function objects (functions are not in pkg.contents — they have
  // no deps and never enter the data tree). Mirrors how tasks are written:
  // body IR as a content object, then a small FunctionObject pointing at it.
  const functions = new SortedMap<string, string>(); // name -> function object hash
  const functionEncoder = encodeBeast2For(FunctionObjectType);
  for (const [fname, fdef] of Object.entries(pkg.functions)) {
    const bodyIrData = encodeEastIR(fdef.body);
    const bodyIrHash = addObject(zipfile, Buffer.from(bodyIrData));

    // The FunctionObject stores homoiconic type VALUES (EastTypeType), not
    // the raw TS EastType definitions Expr.type yields.
    const fnObject: FunctionObject = {
      bodyIr: bodyIrHash,
      inputTypes: fdef.inputTypes.map((t) => toEastTypeValue(t)),
      outputType: toEastTypeValue(fdef.outputType),
      runner: runnerToVariant(fdef.runner),
    };
    const fnHash = addObject(zipfile, Buffer.from(functionEncoder(fnObject)));
    functions.set(fname, fnHash);
  }

  // Get the root structure
  const rootStructure = structures.get('');
  if (!rootStructure) {
    throw new Error('Missing root structure');
  }

  // Build and write the package object
  const packageObject: PackageObject = {
    tasks,
    data: {
      structure: rootStructure,
      refs,
    },
    functions,
  };
  const packageObjectEncoder = encodeBeast2For(PackageObjectType);
  const packageObjectData = packageObjectEncoder(packageObject);
  const packageHash = addObject(zipfile, Buffer.from(packageObjectData));

  // Write the package ref at packages/<name>/<version>
  const refPath = `packages/${pkg.name}/${pkg.version}`;
  zipfile.addBuffer(Buffer.from(packageHash + '\n'), refPath, { mtime: DETERMINISTIC_MTIME });

  // Finalize and write zip to disk
  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(partialPath);
    zipfile.outputStream.pipe(writeStream);
    zipfile.outputStream.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('close', resolve);
    zipfile.end();
  });

  // Atomic rename to final path
  await fs.promises.rename(partialPath, outputPath);
}

/**
 * Fixed mtime for deterministic zip output (Unix epoch)
 */
const DETERMINISTIC_MTIME = new Date(0);

/**
 * Adds an object to the zip file at the content-addressed path.
 *
 * @param zipfile - The zip file to add to
 * @param data - The serialized object data (.beast2 format)
 * @returns The SHA256 hash of the data (used as the object ID)
 */
export function addObject(zipfile: yazl.ZipFile, data: Buffer): string {
  const hash = createHash('sha256').update(data).digest('hex');
  const path = `objects/${hash.slice(0, 2)}/${hash.slice(2)}.beast2`;
  zipfile.addBuffer(data, path, { mtime: DETERMINISTIC_MTIME });
  return hash;
}
