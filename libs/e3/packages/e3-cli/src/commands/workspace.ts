/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 workspace commands - Workspace management
 */

import {
  workspaceCreate,
  workspaceDeploy,
  workspaceExport,
  workspaceList,
  workspaceRemove,
  workspaceGetState,
  workspaceStatus,
  packageImport,
  packageRead,
  LocalStorage,
  WorkspaceExistsError,
  type WorkspaceStatusResult,
  LocalTaskRunner,
  type Budget,
} from '@elaraai/e3-core';
import {
  workspaceCreate as workspaceCreateRemote,
  workspaceDeploy as workspaceDeployRemote,
  workspaceExport as workspaceExportRemote,
  workspaceList as workspaceListRemote,
  workspaceRemove as workspaceRemoveRemote,
  workspaceStatus as workspaceStatusRemote,
  packageImport as packageImportRemote,
  packageGet as packageGetRemote,
  packageList as packageListRemote,
  datasetSetStream,
  ApiError,
} from '@elaraai/e3-api-client';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { EastTypeValue } from '@elaraai/east';
import e3, { DatasetFileTypeMismatchError, readDatasetFileHeader, sha256File } from '@elaraai/e3';
import { treePath, type PackageObject, type TreePath } from '@elaraai/e3-types';
import { parseRepoLocation, parsePackageSpec, formatError, exitError, type RepoLocation } from '../utils.js';
import { loadPackageFile } from './load-package.js';
import { createProgress, formatBytes, type Progress } from '../progress.js';
import { fileTransferSource } from '../file-transfer-source.js';
import { commandBudget, refuseRemoteBudget, type BudgetFlags } from './budget.js';

export const workspaceCommand = {
  /**
   * Create an empty workspace.
   */
  async create(repoArg: string, name: string): Promise<void> {
    try {
      const location = await parseRepoLocation(repoArg);

      if (location.type === 'local') {
        const storage = new LocalStorage();
        await workspaceCreate(storage, location.path, name);
      } else {
        await workspaceCreateRemote(location.baseUrl, location.repo, name, { token: location.token });
      }

      console.log(`Created workspace: ${name}`);
      console.log('Deploy a package with: e3 workspace deploy <repo> <ws> <pkg>[@<ver>]');
    } catch (err) {
      exitError(formatError(err));
    }
  },

  /**
   * Deploy a package to a workspace.
   *
   * Three modes:
   *   - With `pkgSpec`: deploy an already-imported package by name[@version].
   *   - With `--from-zip <path>`: import the zip first, create the workspace if
   *     missing, then deploy. Replaces the legacy `workspace import` command.
   *   - With `--from-source <file.ts>`: bundle the source into a package, then
   *     deploy it as `--from-zip` does.
   *
   * A package's `file` sources are read on THIS machine in every mode: a local
   * deploy adopts them, a remote one checks each before touching the remote
   * workspace and uploads it after the deploy. `--skip-file-sources` leaves them
   * unset instead.
   */
  async deploy(
    repoArg: string,
    ws: string,
    pkgSpec: string | undefined,
    options: BudgetFlags & { fromZip?: string; fromSource?: string; functions?: string[]; quiet?: boolean; skipFileSources?: boolean } = {},
  ): Promise<void> {
    try {
      const modes = [pkgSpec, options.fromZip, options.fromSource].filter(Boolean);
      if (modes.length === 0) {
        exitError('Provide a package spec (e.g. hello@1.0.0), --from-zip <path>, or --from-source <file.ts>');
      }
      if (modes.length > 1) {
        exitError('Provide exactly one of: package spec, --from-zip, --from-source');
      }

      const location = await parseRepoLocation(repoArg);
      if (location.type === 'remote') refuseRemoteBudget(options);

      const progress = createProgress({ quiet: options.quiet === true });
      const target: DeployTarget = {
        location, repoArg, ws, progress, skipFileSources: options.skipFileSources === true,
        ...(location.type === 'local' && { budget: commandBudget(options) }),
      };

      // --from-source mode: bundle the TS source into a package, then import + deploy
      if (options.fromSource) {
        await deployFromSource(target, options.fromSource, options.functions ?? []);
        return;
      }

      // --from-zip mode: import then deploy
      if (options.fromZip) {
        await deployFromZip(target, options.fromZip);
        return;
      }

      const { name, version } = parsePackageSpec(pkgSpec!);

      if (location.type === 'local') {
        const storage = new LocalStorage();
        await workspaceDeploy(storage, location.path, ws, name, version, {
          resolveFileSources: !target.skipFileSources,
          runner: new LocalTaskRunner(location.path, target.budget),
          // What the deploy is about to do to each record's indexes: a build
          // over a large record is the part of a deploy that takes minutes.
          onRecordIndex: (plan) => {
            if (plan.action !== 'keep') console.log(`  ${plan.action} index ${plan.record}.${plan.index}`);
          },
        });
        if (target.skipFileSources) {
          reportSkippedFileSources(target, fileSourcesOf(await packageRead(storage, location.path, name, version)));
        }
      } else {
        // Resolve `latest` here, so the package this command checks the file
        // sources of is exactly the one the server deploys.
        const resolved = version === 'latest' ? await latestRemoteVersion(location, name) : version;
        await deployRemote(target, name, resolved);
      }

      console.log(`Deployed ${pkgSpec} to workspace: ${ws}`);
    } catch (err) {
      exitError(formatError(err));
    }
  },

  /**
   * Export workspace as a package.
   */
  async export(
    repoArg: string,
    ws: string,
    zipPath: string,
    options: { name?: string; version?: string; quiet?: boolean }
  ): Promise<void> {
    try {
      const location = await parseRepoLocation(repoArg);
      // Step-level progress on stderr (#311); stdout keeps the machine summary.
      const progress = createProgress({ quiet: options.quiet === true });

      if (location.type === 'local') {
        const storage = new LocalStorage();
        const result = await workspaceExport(storage, location.path, ws, zipPath, options.name, options.version);

        if (!progress.quiet) {
          console.log(`Exported workspace ${ws} as ${result.name}@${result.version}`);
          console.log(`  Output: ${zipPath}`);
          console.log(`  Package hash: ${result.packageHash.slice(0, 12)}...`);
          console.log(`  Objects: ${result.objectCount}`);
        }
      } else {
        // Remote export - async transfer protocol with progress
        const step = progress.step(`exporting workspace ${ws}`);
        let zipBytes;
        try {
          zipBytes = await workspaceExportRemote(
            location.baseUrl, location.repo, ws,
            { token: location.token },
            {
              name: options.name,
              version: options.version,
              onProgress: (p) => {
                if (p.type === 'exporting') {
                  step.update(`exporting… ${p.value.objectsProcessed} objects`);
                } else if (p.type === 'pending' || p.type === 'uploading') {
                  step.update('exporting… waiting for server');
                }
              },
              onDownloadProgress: (downloaded, total) => {
                step.update(`downloading ${formatBytes(downloaded)}/${formatBytes(total)}`);
              },
            },
          );
        } catch (err) {
          step.fail();
          throw err;
        }
        writeFileSync(zipPath, zipBytes);
        step.done(`exported workspace ${ws} (${formatBytes(zipBytes.length)})`);

        if (!progress.quiet) {
          console.log(`Exported workspace ${ws}`);
          console.log(`  Output: ${zipPath}`);
          console.log(`  Size: ${zipBytes.length} bytes`);
        }
      }
    } catch (err) {
      exitError(formatError(err));
    }
  },


  /**
   * List workspaces.
   */
  async list(repoArg: string): Promise<void> {
    try {
      const location = await parseRepoLocation(repoArg);

      if (location.type === 'local') {
        const storage = new LocalStorage();
        const workspaces = await workspaceList(storage, location.path);

        if (workspaces.length === 0) {
          console.log('No workspaces');
          return;
        }

        console.log('Workspaces:');
        for (const ws of workspaces) {
          const state = await workspaceGetState(storage, location.path, ws);
          if (state) {
            console.log(`  ${ws} (${state.packageName}@${state.packageVersion})`);
          } else {
            console.log(`  ${ws} (not deployed)`);
          }
        }
      } else {
        // Remote - workspaceListRemote returns WorkspaceInfo[] with package info
        const workspaces = await workspaceListRemote(location.baseUrl, location.repo, { token: location.token });

        if (workspaces.length === 0) {
          console.log('No workspaces');
          return;
        }

        console.log('Workspaces:');
        for (const info of workspaces) {
          if (info.deployed && info.packageName.type === 'some') {
            const pkgVersion = info.packageVersion.type === 'some' ? info.packageVersion.value : 'unknown';
            console.log(`  ${info.name} (${info.packageName.value}@${pkgVersion})`);
          } else {
            console.log(`  ${info.name} (not deployed)`);
          }
        }
      }
    } catch (err) {
      exitError(formatError(err));
    }
  },

  /**
   * Remove a workspace.
   */
  async remove(repoArg: string, ws: string): Promise<void> {
    try {
      const location = await parseRepoLocation(repoArg);

      if (location.type === 'local') {
        const storage = new LocalStorage();
        await workspaceRemove(storage, location.path, ws);
        console.log(`Removed workspace: ${ws}`);
        console.log('Run `e3 repo gc` to reclaim disk space');
      } else {
        await workspaceRemoveRemote(location.baseUrl, location.repo, ws, { token: location.token });
        console.log(`Removed workspace: ${ws}`);
      }
    } catch (err) {
      exitError(formatError(err));
    }
  },

  /**
   * Show detailed workspace status.
   */
  async status(repoArg: string, ws: string): Promise<void> {
    try {
      const location = await parseRepoLocation(repoArg);

      let status: WorkspaceStatusResult;

      if (location.type === 'local') {
        const storage = new LocalStorage();
        status = await workspaceStatus(storage, location.path, ws);
      } else {
        const remoteStatus = await workspaceStatusRemote(location.baseUrl, location.repo, ws, { token: location.token });
        // Convert remote status to local format
        status = {
          workspace: remoteStatus.workspace,
          lock: remoteStatus.lock.type === 'some' ? {
            pid: Number(remoteStatus.lock.value.pid),
            acquiredAt: remoteStatus.lock.value.acquiredAt,
            operation: remoteStatus.lock.value.command.type === 'some' ? remoteStatus.lock.value.command.value : undefined,
          } : null,
          datasets: remoteStatus.datasets.map(d => ({
            path: d.path,
            status: d.status as WorkspaceStatusResult['datasets'][0]['status'],
            hash: d.hash.type === 'some' ? d.hash.value : null,
            isTaskOutput: d.isTaskOutput,
            producedBy: d.producedBy.type === 'some' ? d.producedBy.value : null,
          })),
          tasks: remoteStatus.tasks.map(t => ({
            name: t.name,
            hash: t.hash,
            status: convertTaskStatus(t.status),
            inputs: t.inputs,
            output: t.output,
            dependsOn: t.dependsOn,
          })),
          summary: {
            datasets: {
              total: Number(remoteStatus.summary.datasets.total),
              unset: Number(remoteStatus.summary.datasets.unset),
              stale: Number(remoteStatus.summary.datasets.stale),
              upToDate: Number(remoteStatus.summary.datasets.upToDate),
            },
            tasks: {
              total: Number(remoteStatus.summary.tasks.total),
              upToDate: Number(remoteStatus.summary.tasks.upToDate),
              ready: Number(remoteStatus.summary.tasks.ready),
              waiting: Number(remoteStatus.summary.tasks.waiting),
              inProgress: Number(remoteStatus.summary.tasks.inProgress),
              failed: Number(remoteStatus.summary.tasks.failed),
              error: Number(remoteStatus.summary.tasks.error),
              staleRunning: Number(remoteStatus.summary.tasks.staleRunning),
            },
          },
        };
      }

      console.log(`Workspace: ${status.workspace}`);
      console.log('');

      // Lock status
      if (status.lock) {
        console.log('Lock:');
        console.log(`  Held by PID ${status.lock.pid}`);
        console.log(`  Since: ${status.lock.acquiredAt}`);
        if (status.lock.operation) {
          console.log(`  Operation: ${status.lock.operation}`);
        }
        console.log('');
      }

      // Summary
      console.log('Summary:');
      console.log(`  Datasets: ${status.summary.datasets.upToDate} up-to-date, ${status.summary.datasets.stale} stale, ${status.summary.datasets.unset} unset`);

      // Build task summary line - only include non-zero counts
      const taskParts: string[] = [];
      if (status.summary.tasks.upToDate > 0) taskParts.push(`${status.summary.tasks.upToDate} up-to-date`);
      if (status.summary.tasks.ready > 0) taskParts.push(`${status.summary.tasks.ready} ready`);
      if (status.summary.tasks.waiting > 0) taskParts.push(`${status.summary.tasks.waiting} waiting`);
      if (status.summary.tasks.inProgress > 0) taskParts.push(`${status.summary.tasks.inProgress} in-progress`);
      if (status.summary.tasks.failed > 0) taskParts.push(`${status.summary.tasks.failed} failed`);
      if (status.summary.tasks.error > 0) taskParts.push(`${status.summary.tasks.error} error`);
      if (status.summary.tasks.staleRunning > 0) taskParts.push(`${status.summary.tasks.staleRunning} stale-running`);
      console.log(`  Tasks: ${taskParts.join(', ') || 'none'}`);
      console.log('');

      // Tasks section
      if (status.tasks.length > 0) {
        console.log('Tasks:');
        for (const task of status.tasks) {
          const statusStr = formatTaskStatus(task.status);
          console.log(`  ${task.name}: ${statusStr}`);
          if (task.dependsOn.length > 0) {
            console.log(`    depends on: ${task.dependsOn.join(', ')}`);
          }
        }
        console.log('');
      }

      // Datasets section (only show non-up-to-date ones for brevity)
      const nonUpToDate = status.datasets.filter(d => d.status.type !== 'up-to-date');
      if (nonUpToDate.length > 0) {
        console.log('Datasets needing attention:');
        for (const dataset of nonUpToDate) {
          const statusStr = dataset.status.type === 'unset' ? 'unset' : 'stale';
          const producer = dataset.producedBy ? ` (from ${dataset.producedBy})` : ' (input)';
          console.log(`  ${dataset.path}: ${statusStr}${producer}`);
        }
      } else if (status.datasets.length > 0) {
        console.log('All datasets up-to-date');
      }
    } catch (err) {
      exitError(formatError(err));
    }
  },
};

/** Where a deploy lands and how it treats file sources — shared by every mode. */
interface DeployTarget {
  location: RepoLocation;
  /** The repository argument as the user gave it, for the commands we print. */
  repoArg: string;
  ws: string;
  progress: Progress;
  /** Leave the package's `file` sources unset instead of reading them. */
  skipFileSources: boolean;
  /** The budget a local deploy's index builds take from. */
  budget?: Budget;
}

/** A package's path-initialised input, as a deploy completes it. */
interface FileSource {
  /** The input's name (`table`), as `<ws>.<name>` paths spell it. */
  name: string;
  /** Its dataset path (`.inputs.table`). */
  treePath: TreePath;
  /** The absolute path recorded when the package was exported. */
  file: string;
  /** The type the package declares for the input. */
  type: EastTypeValue;
}

/**
 * The `file` sources a package declares, with each input's dataset path and
 * declared type.
 */
function fileSourcesOf(pkg: PackageObject): FileSource[] {
  const sources: FileSource[] = [];
  for (const [refPath, source] of pkg.sources) {
    const { path: datasetPath, structure } = treePath(pkg.data.structure, ...refPath.split('/'));
    if (structure.type !== 'value') {
      throw new Error(`the package declares a file source for '${refPath}', which is not a dataset`);
    }
    sources.push({
      name: refPath.split('/').pop() ?? refPath,
      treePath: datasetPath,
      file: source.value.path,
      type: structure.value.type,
    });
  }
  return sources;
}

/**
 * Check a `file` source on this machine — readable, indexed where the input is a
 * collection, and of the type the package declares — so a remote deploy that
 * could not complete fails before it touches the remote workspace, as a local
 * deploy fails before its wipe.
 */
function checkFileSource(target: DeployTarget, source: FileSource): void {
  try {
    readDatasetFileHeader(source.file, `input '${source.name}'`, source.type);
  } catch (err) {
    if (err instanceof DatasetFileTypeMismatchError) throw err;
    throw new Error(
      `${err instanceof Error ? err.message : String(err)} — a file source is read on the machine that deploys the package: ` +
      `deploy from where the delivery is, or pass --skip-file-sources and set it afterwards with ` +
      `e3 dataset set ${target.repoArg} ${target.ws}.${source.name} --from-file <path>`
    );
  }
}

/** Name the inputs a `--skip-file-sources` deploy left unset, and how to set each. */
function reportSkippedFileSources(target: DeployTarget, sources: FileSource[]): void {
  if (target.progress.quiet) return;
  for (const source of sources) {
    console.log(
      `Left ${target.ws}.${source.name} unset (file source ${source.file}); set it with: ` +
      `e3 dataset set ${target.repoArg} ${target.ws}.${source.name} --from-file ${source.file}`
    );
  }
}

/**
 * The version a server deploys for a bare package name: the greatest version
 * string, sorted as `packageGetLatestVersion` sorts them.
 */
async function latestRemoteVersion(location: RepoLocation, name: string): Promise<string> {
  if (location.type !== 'remote') throw new Error('latestRemoteVersion needs a remote repository');
  const versions = (await packageListRemote(location.baseUrl, location.repo, { token: location.token }))
    .filter((p) => p.name === name)
    .map((p) => p.version)
    .sort();
  const latest = versions[versions.length - 1];
  if (latest === undefined) throw new Error(`Package not found: ${name}`);
  return latest;
}

/**
 * Deploy an imported package to a REMOTE workspace, completing its `file`
 * sources from this machine.
 *
 * @remarks
 * A `file` source names a path on the machine that exported the package, and
 * the server never opens it: it leaves those inputs unassigned. So each source
 * is checked HERE before the remote workspace is touched, the server deploys,
 * and each delivery is then streamed over the dataset transfer protocol, whose
 * commit runs the same validation a local deploy's adopt does. The transfer
 * dedups on the hash, so a redeploy whose delivery has not changed costs one
 * round trip and no bytes.
 */
async function deployRemote(target: DeployTarget, name: string, version: string): Promise<void> {
  const { location, ws, progress } = target;
  if (location.type !== 'remote') throw new Error('deployRemote needs a remote repository');
  const auth = { token: location.token };

  const sources = fileSourcesOf(await packageGetRemote(location.baseUrl, location.repo, name, version, auth));
  if (!target.skipFileSources) {
    for (const source of sources) checkFileSource(target, source);
  }

  const deployStep = progress.step(`deploying ${name}@${version} to workspace ${ws}`);
  try {
    await workspaceDeployRemote(location.baseUrl, location.repo, ws, `${name}@${version}`, auth);
  } catch (err) {
    deployStep.fail();
    throw err;
  }
  deployStep.done(`deployed ${name}@${version} to workspace ${ws}`);

  if (target.skipFileSources) {
    reportSkippedFileSources(target, sources);
    return;
  }
  for (const source of sources) {
    const step = progress.step(`uploading ${source.name} from ${source.file}`);
    try {
      const { size } = readDatasetFileHeader(source.file, `input '${source.name}'`, source.type);
      const hash = await sha256File(source.file);
      await datasetSetStream(
        location.baseUrl, location.repo, ws, source.treePath,
        fileTransferSource(source.file, size, hash),
        auth,
      );
      step.done(`uploaded ${ws}.${source.name} (${formatBytes(size)}, ${hash.slice(0, 12)}...)`);
    } catch (err) {
      step.fail();
      throw err;
    }
  }
}

/**
 * Import a zip, ensure the workspace exists, and deploy.
 *
 * Used by `workspace deploy --from-zip` and `--from-source`.
 */
async function deployFromZip(target: DeployTarget, zipPath: string): Promise<void> {
  const { location, ws, progress } = target;
  let name: string;
  let version: string;
  let packageHash: string;
  let objectCount: number;

  if (location.type === 'local') {
    const storage = new LocalStorage();
    const step = progress.step(`importing ${path.basename(zipPath)}`);
    const result = await packageImport(storage, location.path, zipPath);
    name = result.name;
    version = result.version;
    packageHash = result.packageHash;
    objectCount = result.objectCount;
    step.done(`imported ${name}@${version} (${objectCount} objects)`);

    try {
      await workspaceCreate(storage, location.path, ws);
    } catch (err) {
      if (!(err instanceof WorkspaceExistsError)) throw err;
    }
    await workspaceDeploy(storage, location.path, ws, name, version, {
      resolveFileSources: !target.skipFileSources,
      runner: new LocalTaskRunner(location.path, target.budget),
      onRecordIndex: (plan) => {
        if (plan.action !== 'keep') console.log(`  ${plan.action} index ${plan.record}.${plan.index}`);
      },
    });
    if (target.skipFileSources) {
      reportSkippedFileSources(target, fileSourcesOf(await packageRead(storage, location.path, name, version)));
    }
  } else {
    const zipBytes = readFileSync(zipPath);
    // Upload + server-side import progress (#311) — byte counter while the
    // zip streams up, then the server's per-object import counter.
    const step = progress.step(`uploading package (${formatBytes(zipBytes.byteLength)})`);
    let result;
    try {
      result = await packageImportRemote(
        location.baseUrl, location.repo, new Uint8Array(zipBytes),
        { token: location.token },
        {
          onUploadProgress: (uploaded, total) => {
            step.update(`uploading package ${formatBytes(uploaded)}/${formatBytes(total)}`);
          },
          onProgress: (p) => {
            if (p.type === 'importing') {
              step.update(`importing… ${p.value.objectsProcessed} objects processed`);
            } else if (p.type === 'pending' || p.type === 'downloading') {
              step.update('importing… waiting for server');
            }
          },
        },
      );
    } catch (err) {
      step.fail();
      throw err;
    }
    name = result.name;
    version = result.version;
    packageHash = result.packageHash;
    objectCount = Number(result.objectCount);
    step.done(`imported ${name}@${version} (${objectCount} objects)`);

    try {
      await workspaceCreateRemote(location.baseUrl, location.repo, ws, { token: location.token });
    } catch (err) {
      if (!(err instanceof ApiError && err.code === 'workspace_exists')) throw err;
    }
    await deployRemote(target, name, version);
  }

  if (!progress.quiet) {
    console.log(`Imported ${name}@${version}`);
    console.log(`  Package hash: ${packageHash.slice(0, 12)}...`);
    console.log(`  Objects: ${objectCount}`);
    console.log(`Deployed to workspace: ${ws}`);
  }
}

/**
 * Bundle a TypeScript source file into a package, then import and deploy it via
 * the same path as `--from-zip` (so local and remote repos both work).
 *
 * Used by `workspace deploy --from-source`.
 */
async function deployFromSource(
  target: DeployTarget,
  sourceFile: string,
  functions: string[],
): Promise<void> {
  const { progress } = target;
  // Step-level progress (#311): compile and per-member capture are the
  // dominant, previously-silent costs of a multi-package deploy.
  const compileStep = progress.step(`compiling ${sourceFile}`);
  let loaded;
  try {
    loaded = await loadPackageFile(path.resolve(sourceFile));
  } catch (err) {
    compileStep.fail();
    throw err;
  }
  const { pkg } = loaded;
  compileStep.done(`compiled ${sourceFile} (${pkg.name}@${pkg.version})`);
  const tempZip = path.join(os.tmpdir(), `e3-deploy-${Date.now()}.zip`);
  try {
    const captureStep = progress.step('capturing package');
    try {
      await e3.export(pkg, tempZip, {
        functions,
        onEvent: (e) => {
          if (e.kind === 'capture') {
            progress.phase(`captured ${e.member} (${e.tool}, ${formatBytes(e.bytes)})`);
          } else if (e.kind === 'functions') {
            progress.phase(`exported ${e.count} function(s) of ${e.package} (${e.tool})`);
          }
        },
      });
    } catch (err) {
      captureStep.fail();
      throw err;
    }
    captureStep.done(`captured package ${pkg.name}@${pkg.version}`);
    await deployFromZip(target, tempZip);
  } finally {
    try {
      unlinkSync(tempZip);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Convert remote task status to local format.
 */

function convertTaskStatus(status: any): WorkspaceStatusResult['tasks'][0]['status'] {
  switch (status.type) {
    case 'up-to-date':
      return { type: 'up-to-date', cached: Boolean(status.cached) };
    case 'ready':
      return { type: 'ready' };
    case 'waiting':
      return { type: 'waiting', reason: String(status.reason ?? '') };
    case 'in-progress':
      return {
        type: 'in-progress',
        pid: status.pid?.type === 'some' ? Number(status.pid.value) : undefined,
        startedAt: status.startedAt?.type === 'some' ? status.startedAt.value : undefined,
      };
    case 'failed':
      return {
        type: 'failed',
        exitCode: Number(status.exitCode ?? 0),
        completedAt: status.completedAt?.type === 'some' ? status.completedAt.value : undefined,
      };
    case 'error':
      return {
        type: 'error',
        message: String(status.message ?? ''),
        completedAt: status.completedAt?.type === 'some' ? status.completedAt.value : undefined,
      };
    case 'stale-running':
      return {
        type: 'stale-running',
        pid: status.pid?.type === 'some' ? Number(status.pid.value) : undefined,
        startedAt: status.startedAt?.type === 'some' ? status.startedAt.value : undefined,
      };
    default:
      return { type: 'ready' };
  }
}

/**
 * Format task status for display.
 */
export function formatTaskStatus(status: WorkspaceStatusResult['tasks'][0]['status']): string {
  switch (status.type) {
    case 'up-to-date':
      return status.cached ? 'up-to-date (cached)' : 'up-to-date';
    case 'ready':
      return 'ready to run';
    case 'waiting':
      return `waiting (${status.reason})`;
    case 'in-progress':
      return status.pid ? `in-progress (PID ${status.pid})` : 'in-progress';
    case 'failed':
      return `FAILED (exit code ${status.exitCode})`;
    case 'error':
      return `ERROR: ${status.message}`;
    case 'stale-running':
      return `stale-running (PID ${status.pid} no longer exists)`;
    default:
      return 'unknown';
  }
}
