/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import {
  East,
  StringType,
  IntegerType,
  BlobType,
  NullType,
  ArrayType,
  StructType,
  type ValueTypeOf,
} from '@elaraai/east';
import type { PlatformFunction } from '@elaraai/east/internal';
import { EastError } from '@elaraai/east/internal';
import { CallArgType, TreePathType, WorkspaceStateType, PackageObjectType, dataflowForceOption } from '@elaraai/e3-types';

import {
  RepositoryStatusType,
  GcRequestType,
  GcResultType,
  FunctionCallRequestType,
  ExecuteResultType,
  OneShotRequestType,
  PackageListItemType,
  PackageImportResultType,
  WorkspaceInfoType,
  WorkspaceStatusResultType,
  TaskListItemType,
  TaskDetailsType,
  DataflowRequestType,
  DataflowGraphType,
  DataflowResultType,
  LogChunkType,
} from './types.js';
import {
  repoStatus,
  repoGc,
} from './repository.js';
import {
  packageList,
  packageGet,
  packageImport,
  packageExport,
  packageRemove,
} from './packages.js';
import {
  workspaceList,
  workspaceCreate,
  workspaceGet,
  workspaceStatus,
  workspaceRemove,
  workspaceDeploy,
  workspaceExport,
} from './workspaces.js';
import {
  datasetList,
  datasetListAt,
  datasetGet,
  datasetSet,
} from './datasets.js';
import {
  taskList,
  taskGet,
} from './tasks.js';
import {
  dataflowExecuteLaunch,
  dataflowExecute,
  dataflowGraph,
  taskLogs,
} from './executions.js';
import {
  workspaceFunctionCall,
  oneShotExecute,
} from './functions.js';
import type { RequestOptions } from './http.js';

// =============================================================================
// Repository Platform Functions
// =============================================================================

export const platform_repo_status = East.asyncPlatform(
  'e3_repo_status',
  [StringType, StringType, StringType],  // url, repo, token
  RepositoryStatusType
);

export const platform_repo_gc = East.asyncPlatform(
  'e3_repo_gc',
  [StringType, StringType, GcRequestType, StringType],  // url, repo, options, token
  GcResultType
);

// =============================================================================
// Package Platform Functions
// =============================================================================

export const platform_package_list = East.asyncPlatform(
  'e3_package_list',
  [StringType, StringType, StringType],  // url, repo, token
  ArrayType(PackageListItemType)
);

export const platform_package_get = East.asyncPlatform(
  'e3_package_get',
  [StringType, StringType, StringType, StringType, StringType],  // url, repo, name, version, token
  PackageObjectType
);

export const platform_package_import = East.asyncPlatform(
  'e3_package_import',
  [StringType, StringType, BlobType, StringType],  // url, repo, archive, token
  PackageImportResultType
);

export const platform_package_export = East.asyncPlatform(
  'e3_package_export',
  [StringType, StringType, StringType, StringType, StringType],  // url, repo, name, version, token
  BlobType
);

export const platform_package_remove = East.asyncPlatform(
  'e3_package_remove',
  [StringType, StringType, StringType, StringType, StringType],  // url, repo, name, version, token
  NullType
);

// =============================================================================
// Workspace Platform Functions
// =============================================================================

export const platform_workspace_list = East.asyncPlatform(
  'e3_workspace_list',
  [StringType, StringType, StringType],  // url, repo, token
  ArrayType(WorkspaceInfoType)
);

export const platform_workspace_create = East.asyncPlatform(
  'e3_workspace_create',
  [StringType, StringType, StringType, StringType],  // url, repo, name, token
  WorkspaceInfoType
);

export const platform_workspace_get = East.asyncPlatform(
  'e3_workspace_get',
  [StringType, StringType, StringType, StringType],  // url, repo, name, token
  WorkspaceStateType
);

export const platform_workspace_status = East.asyncPlatform(
  'e3_workspace_status',
  [StringType, StringType, StringType, StringType],  // url, repo, name, token
  WorkspaceStatusResultType
);

export const platform_workspace_remove = East.asyncPlatform(
  'e3_workspace_remove',
  [StringType, StringType, StringType, StringType],  // url, repo, name, token
  NullType
);

export const platform_workspace_deploy = East.asyncPlatform(
  'e3_workspace_deploy',
  [StringType, StringType, StringType, StringType, StringType],  // url, repo, name, packageRef, token
  NullType
);

export const platform_workspace_export = East.asyncPlatform(
  'e3_workspace_export',
  [StringType, StringType, StringType, StringType],  // url, repo, name, token
  BlobType
);

// =============================================================================
// Dataset Platform Functions
// =============================================================================

export const platform_dataset_list = East.asyncPlatform(
  'e3_dataset_list',
  [StringType, StringType, StringType, StringType],  // url, repo, workspace, token
  ArrayType(StringType)
);

export const platform_dataset_list_at = East.asyncPlatform(
  'e3_dataset_list_at',
  [StringType, StringType, StringType, TreePathType, StringType],  // url, repo, workspace, path, token
  ArrayType(StringType)
);

export const platform_dataset_get = East.asyncPlatform(
  'e3_dataset_get',
  [StringType, StringType, StringType, TreePathType, StringType],  // url, repo, workspace, path, token
  BlobType
);

export const platform_dataset_set = East.asyncPlatform(
  'e3_dataset_set',
  [StringType, StringType, StringType, TreePathType, BlobType, StringType],  // url, repo, workspace, path, data, token
  NullType
);

// =============================================================================
// Task Platform Functions
// =============================================================================

export const platform_task_list = East.asyncPlatform(
  'e3_task_list',
  [StringType, StringType, StringType, StringType],  // url, repo, workspace, token
  ArrayType(TaskListItemType)
);

export const platform_task_get = East.asyncPlatform(
  'e3_task_get',
  [StringType, StringType, StringType, StringType, StringType],  // url, repo, workspace, name, token
  TaskDetailsType
);

// =============================================================================
// Execution Platform Functions
// =============================================================================

export const platform_dataflow_start = East.asyncPlatform(
  'e3_dataflow_start',
  [StringType, StringType, StringType, DataflowRequestType, StringType],  // url, repo, workspace, options, token
  NullType
);

export const platform_dataflow_execute = East.asyncPlatform(
  'e3_dataflow_execute',
  [StringType, StringType, StringType, DataflowRequestType, StringType],  // url, repo, workspace, options, token
  DataflowResultType
);

export const platform_dataflow_graph = East.asyncPlatform(
  'e3_dataflow_graph',
  [StringType, StringType, StringType, StringType],  // url, repo, workspace, token
  DataflowGraphType
);

export const LogOptionsType = StructType({
  stream: StringType,
  offset: IntegerType,
  limit: IntegerType,
});

export const platform_task_logs = East.asyncPlatform(
  'e3_task_logs',
  [StringType, StringType, StringType, StringType, LogOptionsType, StringType],  // url, repo, workspace, task, options, token
  LogChunkType
);

// =============================================================================
// Function / One-shot Platform Functions
// =============================================================================

/** Call a named function of a workspace's deployed package, run to
 *  completion, returning the inline ExecuteResult. An argument is a value, or
 *  a dataset of the workspace (`CallArg`'s `dataset`), pinned by its hash at
 *  launch and named in the result's `inputs`. */
export const platform_function_call = East.asyncPlatform(
  'e3_function_call',
  [StringType, StringType, StringType, StringType, FunctionCallRequestType, StringType],  // url, repo, workspace, fn, request, token
  ExecuteResultType
);

/** Run an anonymous one-shot IR against a workspace: a platform-free one for
 *  any caller who may read it, any other under the elevated grant the server
 *  gives (see `oneShotExecute`). */
export const platform_one_shot_execute = East.asyncPlatform(
  'e3_one_shot_execute',
  [StringType, StringType, StringType, OneShotRequestType, StringType],  // url, repo, workspace, request, token
  ExecuteResultType
);

// =============================================================================
// Platform Implementation
// =============================================================================

/**
 * Options for {@link platformImplementation}.
 */
export interface PlatformImplementationOptions {
  /** The `fetch` every request of the platform functions goes through
   *  (`RequestOptions.fetch`): absent, the global `fetch`. */
  fetch?: typeof globalThis.fetch;
}

/**
 * The implementations of e3's platform functions, over a given `fetch`.
 *
 * @remarks
 * `Platform.Implementation` is this over the global `fetch`. A host that
 * answers e3's API itself — e3 running in a page — gives its own, so an East
 * program that calls these functions reaches that e3.
 *
 * @param options - The `fetch` the functions' requests go through
 * @returns The platform functions, to compile an East program with
 */
export function platformImplementation(options: PlatformImplementationOptions = {}): PlatformFunction[] {
  const { fetch } = options;
  const requestOptions = (token: string): RequestOptions => (fetch === undefined ? { token } : { token, fetch });
  return [
    // Repository
    platform_repo_status.implement(async (url: string, repo: string, token: string) => {
      try {
        return await repoStatus(url, repo, requestOptions(token));
      } catch (err: any) {
        throw new EastError(`Failed to get repository status: ${err.message}`, {
          location: [{ filename: 'e3_repo_status', line: 0n, column: 0n }],
          cause: err,
        });
      }
    }),

    platform_repo_gc.implement(async (url: string, repo: string, options: ValueTypeOf<typeof GcRequestType>, token: string) => {
      try {
        return await repoGc(url, repo, options, requestOptions(token));
      } catch (err: any) {
        throw new EastError(`Failed to run garbage collection: ${err.message}`, {
          location: [{ filename: 'e3_repo_gc', line: 0n, column: 0n }],
          cause: err,
        });
      }
    }),

    // Packages
    platform_package_list.implement(async (url: string, repo: string, token: string) => {
      try {
        return await packageList(url, repo, requestOptions(token));
      } catch (err: any) {
        throw new EastError(`Failed to list packages: ${err.message}`, {
          location: [{ filename: 'e3_package_list', line: 0n, column: 0n }],
          cause: err,
        });
      }
    }),

    platform_package_get.implement(async (url: string, repo: string, name: string, version: string, token: string) => {
      try {
        return await packageGet(url, repo, name, version, requestOptions(token));
      } catch (err: any) {
        throw new EastError(`Failed to get package ${name}@${version}: ${err.message}`, {
          location: [{ filename: 'e3_package_get', line: 0n, column: 0n }],
          cause: err,
        });
      }
    }),

    platform_package_import.implement(async (url: string, repo: string, archive: Uint8Array, token: string) => {
      try {
        return await packageImport(url, repo, archive, requestOptions(token));
      } catch (err: any) {
        throw new EastError(`Failed to import package: ${err.message}`, {
          location: [{ filename: 'e3_package_import', line: 0n, column: 0n }],
          cause: err,
        });
      }
    }),

    platform_package_export.implement(async (url: string, repo: string, name: string, version: string, token: string) => {
      try {
        return await packageExport(url, repo, name, version, requestOptions(token));
      } catch (err: any) {
        throw new EastError(`Failed to export package ${name}@${version}: ${err.message}`, {
          location: [{ filename: 'e3_package_export', line: 0n, column: 0n }],
          cause: err,
        });
      }
    }),

    platform_package_remove.implement(async (url: string, repo: string, name: string, version: string, token: string) => {
      try {
        await packageRemove(url, repo, name, version, requestOptions(token));
        return null;
      } catch (err: any) {
        throw new EastError(`Failed to remove package ${name}@${version}: ${err.message}`, {
          location: [{ filename: 'e3_package_remove', line: 0n, column: 0n }],
          cause: err,
        });
      }
    }),

    // Workspaces
    platform_workspace_list.implement(async (url: string, repo: string, token: string) => {
      try {
        return await workspaceList(url, repo, requestOptions(token));
      } catch (err: any) {
        throw new EastError(`Failed to list workspaces: ${err.message}`, {
          location: [{ filename: 'e3_workspace_list', line: 0n, column: 0n }],
          cause: err,
        });
      }
    }),

    platform_workspace_create.implement(async (url: string, repo: string, name: string, token: string) => {
      try {
        return await workspaceCreate(url, repo, name, requestOptions(token));
      } catch (err: any) {
        throw new EastError(`Failed to create workspace ${name}: ${err.message}`, {
          location: [{ filename: 'e3_workspace_create', line: 0n, column: 0n }],
          cause: err,
        });
      }
    }),

    platform_workspace_get.implement(async (url: string, repo: string, name: string, token: string) => {
      try {
        return await workspaceGet(url, repo, name, requestOptions(token));
      } catch (err: any) {
        throw new EastError(`Failed to get workspace ${name}: ${err.message}`, {
          location: [{ filename: 'e3_workspace_get', line: 0n, column: 0n }],
          cause: err,
        });
      }
    }),

    platform_workspace_status.implement(async (url: string, repo: string, name: string, token: string) => {
      try {
        return await workspaceStatus(url, repo, name, requestOptions(token));
      } catch (err: any) {
        throw new EastError(`Failed to get workspace status ${name}: ${err.message}`, {
          location: [{ filename: 'e3_workspace_status', line: 0n, column: 0n }],
          cause: err,
        });
      }
    }),

    platform_workspace_remove.implement(async (url: string, repo: string, name: string, token: string) => {
      try {
        await workspaceRemove(url, repo, name, requestOptions(token));
        return null;
      } catch (err: any) {
        throw new EastError(`Failed to remove workspace ${name}: ${err.message}`, {
          location: [{ filename: 'e3_workspace_remove', line: 0n, column: 0n }],
          cause: err,
        });
      }
    }),

    platform_workspace_deploy.implement(async (url: string, repo: string, name: string, packageRef: string, token: string) => {
      try {
        await workspaceDeploy(url, repo, name, packageRef, requestOptions(token));
        return null;
      } catch (err: any) {
        throw new EastError(`Failed to deploy ${packageRef} to workspace ${name}: ${err.message}`, {
          location: [{ filename: 'e3_workspace_deploy', line: 0n, column: 0n }],
          cause: err,
        });
      }
    }),

    platform_workspace_export.implement(async (url: string, repo: string, name: string, token: string) => {
      try {
        return await workspaceExport(url, repo, name, requestOptions(token));
      } catch (err: any) {
        throw new EastError(`Failed to export workspace ${name}: ${err.message}`, {
          location: [{ filename: 'e3_workspace_export', line: 0n, column: 0n }],
          cause: err,
        });
      }
    }),

    // Datasets
    platform_dataset_list.implement(async (url: string, repo: string, workspace: string, token: string) => {
      try {
        return await datasetList(url, repo, workspace, requestOptions(token));
      } catch (err: any) {
        throw new EastError(`Failed to list datasets in ${workspace}: ${err.message}`, {
          location: [{ filename: 'e3_dataset_list', line: 0n, column: 0n }],
          cause: err,
        });
      }
    }),

    platform_dataset_list_at.implement(
      async (url: string, repo: string, workspace: string, path: ValueTypeOf<typeof TreePathType>, token: string) => {
        try {
          return await datasetListAt(url, repo, workspace, path, requestOptions(token));
        } catch (err: any) {
          throw new EastError(`Failed to list datasets at path in ${workspace}: ${err.message}`, {
            location: [{ filename: 'e3_dataset_list_at', line: 0n, column: 0n }],
            cause: err,
          });
        }
      }
    ),

    platform_dataset_get.implement(
      async (url: string, repo: string, workspace: string, path: ValueTypeOf<typeof TreePathType>, token: string) => {
        try {
          return (await datasetGet(url, repo, workspace, path, requestOptions(token))).data;
        } catch (err: any) {
          throw new EastError(`Failed to get dataset in ${workspace}: ${err.message}`, {
            location: [{ filename: 'e3_dataset_get', line: 0n, column: 0n }],
            cause: err,
          });
        }
      }
    ),

    platform_dataset_set.implement(
      async (
        url: string,
        repo: string,
        workspace: string,
        path: ValueTypeOf<typeof TreePathType>,
        data: Uint8Array,
        token: string
      ) => {
        try {
          await datasetSet(url, repo, workspace, path, data, requestOptions(token));
          return null;
        } catch (err: any) {
          throw new EastError(`Failed to set dataset in ${workspace}: ${err.message}`, {
            location: [{ filename: 'e3_dataset_set', line: 0n, column: 0n }],
            cause: err,
          });
        }
      }
    ),

    // Tasks
    platform_task_list.implement(async (url: string, repo: string, workspace: string, token: string) => {
      try {
        return await taskList(url, repo, workspace, requestOptions(token));
      } catch (err: any) {
        throw new EastError(`Failed to list tasks in ${workspace}: ${err.message}`, {
          location: [{ filename: 'e3_task_list', line: 0n, column: 0n }],
          cause: err,
        });
      }
    }),

    platform_task_get.implement(async (url: string, repo: string, workspace: string, name: string, token: string) => {
      try {
        return await taskGet(url, repo, workspace, name, requestOptions(token));
      } catch (err: any) {
        throw new EastError(`Failed to get task ${name} in ${workspace}: ${err.message}`, {
          location: [{ filename: 'e3_task_get', line: 0n, column: 0n }],
          cause: err,
        });
      }
    }),

    // Executions
    platform_dataflow_start.implement(
      async (url: string, repo: string, workspace: string, options: ValueTypeOf<typeof DataflowRequestType>, token: string) => {
        try {
          await dataflowExecuteLaunch(url, repo, workspace, {
            force: dataflowForceOption(options.force),
            filter: options.filter.value ?? undefined,
          }, requestOptions(token));
          return null;
        } catch (err: any) {
          throw new EastError(`Failed to start dataflow in ${workspace}: ${err.message}`, {
            location: [{ filename: 'e3_dataflow_start', line: 0n, column: 0n }],
            cause: err,
          });
        }
      }
    ),

    platform_dataflow_execute.implement(
      async (url: string, repo: string, workspace: string, options: ValueTypeOf<typeof DataflowRequestType>, token: string) => {
        try {
          return await dataflowExecute(url, repo, workspace, {
            force: dataflowForceOption(options.force),
            filter: options.filter.value ?? undefined,
          }, requestOptions(token));
        } catch (err: any) {
          throw new EastError(`Failed to execute dataflow in ${workspace}: ${err.message}`, {
            location: [{ filename: 'e3_dataflow_execute', line: 0n, column: 0n }],
            cause: err,
          });
        }
      }
    ),

    platform_dataflow_graph.implement(async (url: string, repo: string, workspace: string, token: string) => {
      try {
        return await dataflowGraph(url, repo, workspace, requestOptions(token));
      } catch (err: any) {
        throw new EastError(`Failed to get dataflow graph for ${workspace}: ${err.message}`, {
          location: [{ filename: 'e3_dataflow_graph', line: 0n, column: 0n }],
          cause: err,
        });
      }
    }),

    platform_task_logs.implement(
      async (
        url: string,
        repo: string,
        workspace: string,
        task: string,
        options: ValueTypeOf<typeof LogOptionsType>,
        token: string
      ) => {
        try {
          // A log chunk, as the platform function has always answered it: the
          // execution the route names is the route's own
          const { data, offset, size, totalSize, complete } = await taskLogs(url, repo, workspace, task, {
            stream: options.stream as 'stdout' | 'stderr',
            offset: Number(options.offset),
            limit: Number(options.limit),
          }, requestOptions(token));
          return { data, offset, size, totalSize, complete };
        } catch (err: any) {
          throw new EastError(`Failed to get logs for task ${task} in ${workspace}: ${err.message}`, {
            location: [{ filename: 'e3_task_logs', line: 0n, column: 0n }],
            cause: err,
          });
        }
      }
    ),

    // Functions / one-shot
    platform_function_call.implement(
      async (url: string, repo: string, workspace: string, fn: string, request: ValueTypeOf<typeof FunctionCallRequestType>, token: string) => {
        try {
          return await workspaceFunctionCall(url, repo, workspace, fn, request, requestOptions(token));
        } catch (err: any) {
          throw new EastError(`Failed to call function ${fn} in ${workspace}: ${err.message}`, {
            location: [{ filename: 'e3_function_call', line: 0n, column: 0n }],
            cause: err,
          });
        }
      }
    ),

    platform_one_shot_execute.implement(
      async (url: string, repo: string, workspace: string, request: ValueTypeOf<typeof OneShotRequestType>, token: string) => {
        try {
          return await oneShotExecute(url, repo, workspace, request, requestOptions(token));
        } catch (err: any) {
          throw new EastError(`Failed to execute one-shot in ${workspace}: ${err.message}`, {
            location: [{ filename: 'e3_one_shot_execute', line: 0n, column: 0n }],
            cause: err,
          });
        }
      }
    ),
  ];
}

const PlatformImpl: PlatformFunction[] = platformImplementation();

// =============================================================================
// Grouped Export
// =============================================================================

export const Platform = {
  // Repository
  repoStatus: platform_repo_status,
  repoGc: platform_repo_gc,

  // Packages
  packageList: platform_package_list,
  packageGet: platform_package_get,
  packageImport: platform_package_import,
  packageExport: platform_package_export,
  packageRemove: platform_package_remove,

  // Workspaces
  workspaceList: platform_workspace_list,
  workspaceCreate: platform_workspace_create,
  workspaceGet: platform_workspace_get,
  workspaceStatus: platform_workspace_status,
  workspaceRemove: platform_workspace_remove,
  workspaceDeploy: platform_workspace_deploy,
  workspaceExport: platform_workspace_export,

  // Datasets
  datasetList: platform_dataset_list,
  datasetListAt: platform_dataset_list_at,
  datasetGet: platform_dataset_get,
  datasetSet: platform_dataset_set,

  // Tasks
  taskList: platform_task_list,
  taskGet: platform_task_get,

  // Executions
  dataflowStart: platform_dataflow_start,
  dataflowExecute: platform_dataflow_execute,
  dataflowGraph: platform_dataflow_graph,
  taskLogs: platform_task_logs,

  // Functions / one-shot
  functionCall: platform_function_call,
  oneShotExecute: platform_one_shot_execute,

  Implementation: PlatformImpl,
  implementation: platformImplementation,

  Types: {
    RepositoryStatus: RepositoryStatusType,
    GcRequest: GcRequestType,
    GcResult: GcResultType,
    PackageListItem: PackageListItemType,
    PackageImportResult: PackageImportResultType,
    WorkspaceInfo: WorkspaceInfoType,
    WorkspaceStatusResult: WorkspaceStatusResultType,
    TaskListItem: TaskListItemType,
    TaskDetails: TaskDetailsType,
    DataflowRequest: DataflowRequestType,
    DataflowGraph: DataflowGraphType,
    DataflowResult: DataflowResultType,
    LogChunk: LogChunkType,
    LogOptions: LogOptionsType,
    CallArg: CallArgType,
    FunctionCallRequest: FunctionCallRequestType,
    ExecuteResult: ExecuteResultType,
    OneShotRequest: OneShotRequestType,
  },
} as const;
