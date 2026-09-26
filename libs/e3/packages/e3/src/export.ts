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
import * as nodePath from 'node:path';
import { createHash } from 'node:crypto';
import yazl from 'yazl';
import { variant, some, none, BlobType, encodeBeast2For, encodeEastIR, EastIR, AsyncEastIR, printIdentifier, SortedMap, toEastTypeValue, decodeFunctionManifest, linkImports, type FunctionManifest, type LinkedImport } from '@elaraai/east';
import type { Structure, PackageObject, DatasetRef, DatasetSourceWire, FunctionObject, MutationObject, RecordIndexObject, RecordObject, TaskObject, TaskOutputKind } from '@elaraai/e3-types';
import { DatasetRefType, PackageObjectType, TASK_OBJECT_KIND, TaskObjectType, FunctionObjectType, MutationObjectType, RecordIndexObjectType, RecordObjectType, encodeDatasetBlob } from '@elaraai/e3-types';
import { buildMutationProgram, hasKeyedDelta, indexBuildProgram } from './record-programs.js';
import { readDatasetFileHeader } from './dataset-file.js';
import type { PackageDef, PackageItem } from './types.js';
import { runnerProvides, runnerToVariant, type Runner } from './runner.js';
import { captureEnvironment, captureAutoEnvironment, type CaptureEvent } from './environment-capture.js';
import { importedFunctions, resolveFunctionManifests, type ImportReference, type ResolveEvent } from './functions-resolve.js';
import type { EnvironmentDecl } from './environment.js';

/** An environment's files ride the object store as beast2 Blobs of their bytes. */
const encodeFile = encodeBeast2For(BlobType);

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
 * One export progress event (#311, #652). `capture` events surface the
 * per-member environment-artifact builds (`uv build --sdist` / `npm pack`)
 * that dominate multi-package export time; `functions` events, each
 * imported workspace package whose manifest the export produced itself.
 */
export type ExportEvent = ({ kind: 'capture' } & CaptureEvent) | ({ kind: 'functions' } & ResolveEvent);

/** Export options (#311, #628, #652). */
export interface ExportOptions {
  /** Progress callback — receives one event per captured environment member and per resolved import package. */
  onEvent?: (event: ExportEvent) => void;
  /**
   * Function manifests (#628) built elsewhere — paths to files written by
   * `east-py export-functions` / `east-node export-functions`, or decoded
   * values — for packages that are not members of this workspace (a
   * published package, another repo). A package this workspace holds needs
   * none: every `East.importFunction` naming a member of the governing uv or
   * npm workspace is exported from that member itself at export time (#652 —
   * `east-py export-functions` on a python member's `east_functions`,
   * `east-node export-functions` on a node member's built `./functions`
   * entry). An explicit manifest wins for its package. Each import is checked for
   * exact type equality and embedded as pure IR; its platform dependencies
   * must be provided by the consuming task's runner (see `runnerProvides`).
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
  // function's or mutation's IR resolves against a manifest and embeds as
  // pure IR — the deployed program needs no exporting language at run
  // time. The manifests are the ones given, plus one produced here for
  // every imported package that is a member of this uv or npm workspace
  // (#652): the reference names the package, and that is all the author
  // writes. Each owner links against the manifests exported for ITS
  // runner, whose packages must provide what the embedded functions'
  // platform calls need.
  const explicit: FunctionManifest[] = (options?.functions ?? []).map((m) =>
    typeof m === 'string' ? decodeFunctionManifest(new Uint8Array(fs.readFileSync(m))) : m);
  const references: ImportReference[] = [];
  const refer = (bundle: EastIR<any, any> | AsyncEastIR<any, any>, owner: string, runner: Runner | undefined): void => {
    for (const [name, functions] of importedFunctions(bundle.ir)) references.push({ package: name, functions: [...functions], owner, runner });
  };
  for (const item of pkg.contents) {
    if (item.kind !== 'task' || item.body.kind !== 'east') continue;
    const owner = `task "${item.name}"`;
    refer(item.body.program, owner, item.runner);
    if (item.outputKind?.kind === 'dict' && item.outputKind.merge !== undefined) refer(item.outputKind.merge, owner, item.runner);
    if (item.outputKind?.kind === 'fold') refer(item.outputKind.combine, owner, item.runner);
  }
  for (const [fname, fdef] of Object.entries(pkg.functions)) refer(fdef.body, `function "${fname}"`, fdef.runner);
  for (const [rname, rdef] of Object.entries(pkg.records)) {
    for (const [mname, mdef] of Object.entries(rdef.mutations)) {
      if (mdef.body !== undefined) refer(mdef.body, `mutation "${rname}.${mname}"`, mdef.runner);
    }
    for (const [iname, idef] of Object.entries(rdef.indexes)) {
      const owner = `index "${rname}.${iname}"`;
      refer(idef.keyFn.toIR() as EastIR<any, any>, owner, idef.runner);
      if (idef.valueFn !== undefined) refer(idef.valueFn.toIR() as EastIR<any, any>, owner, idef.runner);
    }
  }
  const manifests = resolveFunctionManifests(references, explicit, process.cwd(), options?.onEvent === undefined
    ? undefined
    : (e: ResolveEvent) => options.onEvent!({ kind: 'functions', ...e }));
  const link = <B extends EastIR<any, any> | AsyncEastIR<any, any>>(bundle: B, owner: string, runner: Runner | undefined): B => {
    const { ir, imports } = linkImports(bundle, manifests.forOwner(runner));
    if (imports.length === 0) return bundle;
    checkImportPlatforms(imports, runner, owner);
    const linked = (bundle instanceof EastIR ? new EastIR<any, any>(ir as any) : new AsyncEastIR<any, any>(ir as any)) as B;
    linked.source_map = bundle.source_map;
    return linked;
  };

  // Create zip file
  const zipfile = new yazl.ZipFile();

  // Initialize empty package object that we'll populate as we iterate
  const tasks = new SortedMap<string, string>(); // name -> task object hash
  const structures = new Map<string, Structure>(); // path -> structure (parallel to tree hierarchy)
  const refs = new SortedMap<string, DatasetRef>(); // refPath -> DatasetRef
  // Unresolved sources: refPath -> descriptor. A `file` input puts the
  // DESCRIPTOR in the package and leaves its ref unassigned; deploy resolves it
  // on the machine that actually has the bytes.
  const sources = new SortedMap<string, DatasetSourceWire>();

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
      return cachedEnvHash(`decl:${JSON.stringify(decl)}`, () => captureEnvironment(decl, owner, (file) => addObject(zipfile, Buffer.from(encodeFile(file))), onCapture));
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
    return cachedEnvHash(key, () => captureAutoEnvironment(runner.runtime, customs, process.cwd(), owner, (file) => addObject(zipfile, Buffer.from(encodeFile(file))), onCapture));
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

      // An input's initial value comes from its SOURCE variant; `default` is
      // the internal inline-value channel (record()'s initial state), which
      // is never path-initialised.
      //
      // - `value` and `default` are serialized into the bundle through the
      //   store path's own encoder (a collection root ships segmented +
      //   indexed, so a deployed input is pageable without anyone having to
      //   write it first, #584).
      // - `file` records a DESCRIPTOR and leaves the ref unassigned: the
      //   bytes never travel in the package. The file is validated here,
      //   from its header, so a schema drift is a build error at the
      //   developer's desk rather than a decode failure inside a running task.
      const inline = item.default !== undefined ? item.default
        : item.source?.type === 'value' ? item.source.value as typeof item.default
        : undefined;
      let datasetRef: DatasetRef;
      if (item.source?.type === 'file') {
        // Resolved against the process's cwd exactly as environment capture
        // resolves project paths; an absolute path is used as given.
        const resolved = nodePath.resolve(process.cwd(), item.source.value);
        readDatasetFileHeader(resolved, `input '${item.name}'`, item.type);
        sources.set(refPath, variant('file', { path: resolved }));
        datasetRef = variant('unassigned', null);
      } else if (inline !== undefined) {
        // A collection root ships as segment objects plus the manifest naming
        // them, exactly as the store's own door writes one, so a deployed
        // input is in the layout before anything writes it.
        const valueData = await encodeDatasetBlob(item.type, inline,
          (bytes) => Promise.resolve(addObject(zipfile, Buffer.from(bytes))));
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
      // Tasks are serialized and written immediately: the program and the
      // functions the output kind folds with are objects of their own, each
      // linked against the task's runner, and the task object names them.
      const owner = `task "${item.name}"`;
      const irObject = (bundle: EastIR<any, any> | AsyncEastIR<any, any>): string =>
        addObject(zipfile, Buffer.from(encodeEastIR(link(bundle, owner, item.runner))));

      let outputKind: TaskOutputKind;
      const kind = item.outputKind;
      switch (kind?.kind) {
        case undefined: outputKind = variant('value', null); break;
        case 'array': outputKind = variant('array', null); break;
        case 'set': outputKind = variant('set', null); break;
        case 'dict': outputKind = variant('dict', { merge: kind.merge === undefined ? none : some(irObject(kind.merge)) }); break;
        case 'fold':
          outputKind = variant('fold', {
            zero: addObject(zipfile, Buffer.from(encodeBeast2For(kind.type)(kind.zero))),
            combine: irObject(kind.combine),
          });
          break;
      }

      const taskObject: TaskObject = {
        kind: TASK_OBJECT_KIND,
        // A custom task's command builds an argv and calls no function, so it
        // is encoded unlinked.
        body: item.body.kind === 'east'
          ? variant('east', { program: irObject(item.body.program) })
          : variant('command', { commandIr: addObject(zipfile, Buffer.from(encodeEastIR(item.body.command))) }),
        // customTask leaves TaskDef.runner undefined: its command is what
        // runs, so the runner is the custom runtime with an empty command.
        runner: item.runner ? runnerToVariant(item.runner) : variant('custom', { command: [] as string[] }),
        inputs: item.inputs.map((input) => input.kind === 'partition'
          ? { path: input.dataset.path, partition: some({ by: [...input.by] }) }
          : { path: input.path, partition: none }),
        output: { path: item.output.path, kind: outputKind },
        role: item.role,
        environment: resolveEnvironment(item.environment, item.runner, item.name),
      };
      tasks.set(item.name, addObject(zipfile, Buffer.from(encodeBeast2For(TaskObjectType)(taskObject))));

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
  const indexEncoder = encodeBeast2For(RecordIndexObjectType);
  const recordEncoder = encodeBeast2For(RecordObjectType);
  for (const [rname, rdef] of Object.entries(pkg.records)) {
    const recordRefPath = rdef.path.map(seg => {
      if (seg.type !== 'field') {
        throw new Error(`Unsupported path segment type: ${seg.type}`);
      }
      return seg.value;
    }).join('/');

    // A mutation ships its author body AND the program built from it: the
    // program is what runs, and it emits the delta the engine applies. A
    // record whose collection has no delta addressed by key keeps the original
    // protocol — the reducer runs and its whole result is the new state — and
    // says so by naming no program.
    const mutations = new SortedMap<string, string>(); // name -> MutationObject hash
    for (const [mname, mdef] of Object.entries(rdef.mutations)) {
      const owner = `mutation "${rname}.${mname}"`;
      const programIr = hasKeyedDelta(rdef.type)
        ? addObject(zipfile, Buffer.from(
          encodeEastIR(link(buildMutationProgram(rdef, mdef), owner, mdef.runner))))
        : '';
      if (mdef.body === undefined && programIr === '') {
        throw new Error(`${owner} has neither a body nor a program to run`);
      }
      const bodyIr = mdef.body === undefined
        ? programIr
        : addObject(zipfile, Buffer.from(encodeEastIR(link(mdef.body, owner, mdef.runner))));
      const mutObject: MutationObject = {
        bodyIr,
        argTypes: mdef.argTypes.map((t) => toEastTypeValue(t)),
        runner: runnerToVariant(mdef.runner),
        form: mdef.form,
        programIr,
      };
      const mutHash = addObject(zipfile, Buffer.from(mutationEncoder(mutObject)));
      mutations.set(mname, mutHash);
    }

    // An index ships its declared functions AND the program built from them:
    // what runs is the program, and it is linked and encoded like any body.
    const indexes = new SortedMap<string, string>(); // name -> RecordIndexObject hash
    for (const [iname, idef] of Object.entries(rdef.indexes)) {
      const owner = `index "${rname}.${iname}"`;
      const irHash = (expr: { toIR(): unknown }): string =>
        addObject(zipfile, Buffer.from(encodeEastIR(link(expr.toIR() as EastIR<any, any> | AsyncEastIR<any, any>, owner, idef.runner))));
      const indexObject: RecordIndexObject = {
        keyIr: irHash(idef.keyFn),
        multi: idef.multi,
        valueIr: idef.valueFn === undefined ? none : some(irHash(idef.valueFn)),
        keyType: toEastTypeValue(idef.keyType),
        valueType: toEastTypeValue(idef.valueType),
        buildIr: addObject(zipfile, Buffer.from(
          encodeEastIR(link(indexBuildProgram(idef.record.type, idef), owner, idef.runner)))),
        runner: runnerToVariant(idef.runner),
      };
      indexes.set(iname, addObject(zipfile, Buffer.from(indexEncoder(indexObject))));
    }

    const recObject: RecordObject = { path: recordRefPath, mutations, indexes };
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
    sources,
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
