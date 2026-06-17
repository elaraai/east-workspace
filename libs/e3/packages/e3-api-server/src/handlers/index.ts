/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

export { getStatus, startGc, getGcStatus } from './repository.js';

export {
  listPackages,
  getPackage,
  deletePackage,
} from './packages.js';

export {
  listWorkspaces,
  createWorkspace,
  getWorkspace,
  getWorkspaceStatus,
  deleteWorkspace,
  deployWorkspace,
  exportWorkspace,
} from './workspaces.js';

export {
  listDatasets,
  listDatasetsRecursive,
  listDatasetsRecursivePaths,
  listDatasetsWithStatus,
  getDataset,
  getDatasetStatus,
  setDataset,
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
  callOneShotSync,
} from './functions.js';

export {
  describeRecord,
  callMutationSync,
  compactRecord,
  getRecordHistory,
} from './records.js';
