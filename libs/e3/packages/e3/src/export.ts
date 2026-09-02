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
import { variant, some, none, encodeBeast2For, encodeEastIR, EastIR, AsyncEastIR, printIdentifier, SortedMap, toEastTypeValue, decodeFunctionManifest, linkImports, type FunctionManifest, type LinkedImport } from '@elaraai/east';
import type { Structure, PackageObject, DatasetRef, FunctionObject, MutationObject, RecordObject } from '@elaraai/e3-types';
import { DatasetRefType, PackageObjectType, TaskObjectType, FunctionObjectType, MutationObjectType, RecordObjectType, encodeDatasetBlob } from '@elaraai/e3-types';
import type { PackageDef, PackageItem } from './types.js';
import { runnerProvides, runnerToVariant, type Runner } from './runner.js';
import { captureEnvironment, captureAutoEnvironment, type CaptureEvent } from './environment-capture.js';
import type { EnvironmentDecl } from './environment.js';

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
 * @param options - Optional progress callback (see {@link ExportOptions})
 *
 * @example
 * ```ts
 * await e3.export(pkg, './my-package-1.0.0.zip');
 * ```
 */
/**
 * One export progress event (#311). `capture` events surface the per-member
 * environment-artifact builds (`uv build --sdist` / `npm pack`) that dominate
 * multi-package export time.
 */
export type ExportEvent = { kind: 'capture' } & CaptureEvent;

/** Export options (#311, #628). */
export interface ExportOptions {
  /** Progress callback — receives one event per captured environment member. */
  onEvent?: (event: ExportEvent) => void;
  /**
   * Function manifests (#628) — paths to files written by `east-py
   * export-functions` / `east-node export-functions`, or decoded values —
   * resolving every `East.importFunction` in the package's tasks, functions
   * and mutations. Each import is checked for exact type equality and
   * embedded as pure IR; its platform dependencies must be provided by the
   * consuming task's runner (see `runnerProvides`).
   */
  functions?: Array<string | FunctionManifest>;
}

// Named export_ to avoid conflict with reserved word
export async function export_<D extends Record<string, any>>(pkg: PackageDef<D>, outputPath: string, options?: ExportOptions): Promise<void> {
  const onCapture = options?.onEvent === undefined
    ? undefined
    : (e: CaptureEvent) => options.onEvent!({ kind: 'capture', ...e });
  const partialPath = `${outputPath}.partial`;

  // Cross-language imports (#628): every East.importFunction in a task's,
  // function's or mutation's IR resolves against the given manifests and
  // embeds as pure IR — the deployed program needs no exporting language
  // at run time. The owner's runner must provide what the embedded
  // function's platform calls need.
  const manifests: FunctionManifest[] = (options?.functions ?? []).map((m) =>
    typeof m === 'string' ? decodeFunctionManifest(new Uint8Array(fs.readFileSync(m))) : m);
  const link = <B extends EastIR<any, any> | AsyncEastIR<any, any>>(bundle: B, owner: string, runner: Runner | undefined): B => {
    const { ir, imports } = linkImports(bundle, manifests);
    if (imports.length === 0) return bundle;
    checkImportPlatforms(imports, runner, owner);
    const linked = (bundle instanceof EastIR ? new EastIR<any, any>(ir as any) : new AsyncEastIR<any, any>(ir as any)) as B;
    linked.source_map = bundle.source_map;
    return linked;
  };
  // The task a function_ir dataset belongs to (e3.task lists it first among
  // the task's inputs), so the dataset's IR links against that task's runner.
  const taskOfFunctionIR = new Map<PackageItem, { name: string; runner: Runner | undefined }>();
  for (const item of pkg.contents) {
    if (item.kind === 'task') {
      for (const input of item.inputs) {
        if (input.name === 'function_ir') taskOfFunctionIR.set(input, { name: item.name, runner: item.runner });
      }
    }
  }

  // Create zip file
  const zipfile = new yazl.ZipFile();

  // Initialize empty package object that we'll populate as we iterate
  const tasks = new SortedMap<string, string>(); // name -> task object hash
  const structures = new Map<string, Structure>(); // path -> structure (parallel to tree hierarchy)
  const refs = new SortedMap<string, DatasetRef>(); // refPath -> DatasetRef

  // Resolve environment declarations to content-addressed EnvironmentSpec
  // objects, once per distinct declaration per export run (a project capture
  // shells out to uv/npm — identical declarations must not re-build).
  // Environment spec hashes, memoized per distinct decl/derivation key (a
  // capture shells out to uv/npm). '' marks a key that resolved to "no
  // environment", so it is neither re-derived nor mistaken for a cache miss.
  const environmentHashes = new Map<string, string>();
  const cachedEnvHash = (key: string, capture: () => Uint8Array | null): string | null => {
    let hash = environmentHashes.get(key);
    if (hash === undefined) {
      const specData = capture();
      hash = specData === null ? '' : addObject(zipfile, Buffer.from(specData));
      environmentHashes.set(key, hash);
    }
    return hash === '' ? null : hash;
  };
  const environmentHashFor = (decl: EnvironmentDecl | undefined, runner: Runner | undefined, owner: string): string | null => {
    // An explicit `environment` wins (and is the only path to tools/image).
    if (decl) {
      return cachedEnvHash(`decl:${JSON.stringify(decl)}`, () => captureEnvironment(decl, owner, (blob) => addObject(zipfile, blob), onCapture));
    }
    // Otherwise derive it from the runner's `{ custom }` platform references, so
    // a project split into workspace packages gets per-package change-detection
    // granularity with no hand-written `environment`.
    if (!runner || runner.runtime === 'custom') return null;
    const customs = (runner.platforms ?? [])
      .filter((p): p is { custom: string } => typeof p === 'object' && p !== null && 'custom' in p)
      .map((p) => p.custom);
    if (customs.length === 0) return null;
    const key = `auto:${runner.runtime}:${[...customs].sort().join(',')}`;
    return cachedEnvHash(key, () => captureAutoEnvironment(runner.runtime, customs, process.cwd(), owner, (blob) => addObject(zipfile, blob), onCapture));
  };
  const resolveEnvironment = (decl: EnvironmentDecl | undefined, runner: Runner | undefined, owner: string): variant<'some', string> | variant<'none', null> => {
    const hash = environmentHashFor(decl, runner, owner);
    return hash === null ? none : some(hash);
  };

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
          const owner = taskOfFunctionIR.get(item);
          valueData = encodeEastIR(link(item.default, owner ? `task "${owner.name}"` : `dataset "${refPath}"`, owner?.runner));
        } else {
          // The SAME encoder the store path uses — a collection root ships
          // segmented + indexed, so a deployed input is pageable without
          // anyone having to write it first (#584).
          valueData = encodeDatasetBlob(item.type, item.default);
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
        // Routing metadata (commandIr stays authoritative for execution).
        // customTask leaves TaskDef.runner undefined -> opaque custom
        // (empty command: the wire field is informational for custom tasks).
        runner: item.runner ? runnerToVariant(item.runner) : variant('custom', { command: [] as string[] }),
        environment: resolveEnvironment(item.environment, item.runner, item.name),
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
    const bodyIrData = encodeEastIR(link(fdef.body, `function "${fname}"`, fdef.runner));
    const bodyIrHash = addObject(zipfile, Buffer.from(bodyIrData));

    // The FunctionObject stores homoiconic type VALUES (EastTypeType), not
    // the raw TS EastType definitions Expr.type yields.
    const fnObject: FunctionObject = {
      bodyIr: bodyIrHash,
      inputTypes: fdef.inputTypes.map((t) => toEastTypeValue(t)),
      outputType: toEastTypeValue(fdef.outputType),
      runner: runnerToVariant(fdef.runner),
      environment: resolveEnvironment(fdef.environment, fdef.runner, fname),
    };
    const fnHash = addObject(zipfile, Buffer.from(functionEncoder(fnObject)));
    functions.set(fname, fnHash);
  }

  // Write record objects. The record's own dataset (initial state value + ref +
  // writable:false structure leaf) is written by the dataset branch above —
  // records are datasets. Here we write the separate RecordObject + its
  // MutationObjects, mirroring how functions are written. The genesis commit is
  // minted at deploy (writeRecordGenesis) from the initial-state ref.
  const records = new SortedMap<string, string>(); // name -> RecordObject hash
  const mutationEncoder = encodeBeast2For(MutationObjectType);
  const recordEncoder = encodeBeast2For(RecordObjectType);
  for (const [rname, rdef] of Object.entries(pkg.records)) {
    const recordRefPath = rdef.path.map(seg => {
      if (seg.type !== 'field') {
        throw new Error(`Unsupported path segment type: ${seg.type}`);
      }
      return seg.value;
    }).join('/');

    const mutations = new SortedMap<string, string>(); // name -> MutationObject hash
    for (const [mname, mdef] of Object.entries(rdef.mutations)) {
      const bodyIrData = encodeEastIR(link(mdef.body, `mutation "${rname}.${mname}"`, mdef.runner));
      const bodyIrHash = addObject(zipfile, Buffer.from(bodyIrData));
      const mutObject: MutationObject = {
        bodyIr: bodyIrHash,
        argTypes: mdef.argTypes.map((t) => toEastTypeValue(t)),
        runner: runnerToVariant(mdef.runner),
      };
      const mutHash = addObject(zipfile, Buffer.from(mutationEncoder(mutObject)));
      mutations.set(mname, mutHash);
    }

    const recObject: RecordObject = { path: recordRefPath, mutations };
    const recHash = addObject(zipfile, Buffer.from(recordEncoder(recObject)));
    records.set(rname, recHash);
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
    records,
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
 * Validates an owner's resolved imports against its runner (#628): every
 * platform function an embedded function calls must be provided by a
 * package the runner lists (stock families count across runtimes — see
 * `runnerProvides`). A custom-command runner (`runner` undefined, or the
 * `custom` runtime) cannot be inspected and is trusted.
 *
 * @throws {Error} Naming the owner, the import, the platform function and
 *   the runner's packages
 */
function checkImportPlatforms(imports: LinkedImport[], runner: Runner | undefined, owner: string): void {
  if (runner === undefined) return;
  for (const imp of imports) {
    for (const dep of imp.platforms) {
      const where = `${owner} imports ${imp.package}.${imp.name}, which calls platform function "${dep.name}"`;
      if (dep.provider.type === 'none') {
        throw new Error(
          `${where} — its manifest names no package providing it; export it with -p <package> ` +
          `(east-py export-functions / east-node export-functions) so the runner can be checked`);
      }
      if (!runnerProvides(runner, dep.provider.value)) {
        const listed = runner.runtime === 'custom'
          ? 'a custom command'
          : (runner.platforms ?? []).map((p) => (typeof p === 'string' ? p : p.custom)).join(', ') || '(none)';
        throw new Error(
          `${where} provided by ${dep.provider.value}, but its ${runner.runtime} runner lists ${listed} — ` +
          `add the package providing "${dep.name}" on ${runner.runtime} to the runner's platforms`);
      }
    }
  }
}

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
