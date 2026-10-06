/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

export {
  listRepositories,
  createRepository,
  removeRepository,
  getStatus,
  getRecord,
  startGc,
  getGcStatus,
} from './repository.js';

export {
  listPackages,
  getPackage,
  deletePackage,
} from './packages.js';

export {
  listWorkspaces,
  createWorkspace,
  copyWorkspace,
  getWorkspace,
  getWorkspaceStatus,
  deleteWorkspace,
  startWorkspaceDeploy,
  getWorkspaceDeployStatus,
} from './workspaces.js';

export {
  listDatasets,
  listDatasetsRecursive,
  listDatasetsRecursivePaths,
  listDatasetsWithStatus,
  getDataset,
  getDatasetStatus,
  setDataset,
  getDatasetPage,
  getValuePage,
  type DatasetPageWindow,
  type DatasetPageLimits,
  type PinnedCache,
} from './datasets.js';

export {
  listTasks,
  getTask,
} from './tasks.js';

export {
  startDataflow,
  getDataflowStatus,
  getDataflowGraph,
  getTaskLogs,
} from './dataflow.js';

export {
  listPackageFunctions,
  describePackageFunction,
  callFunctionSync,
  startSplitCall,
  getSplitCallStatus,
  type StartSplitCallOptions,
} from './functions.js';

export {
  describeRecord,
  callMutationSync,
  compactRecord,
  getRecordHistory,
  mutationResultOf,
} from './records.js';
