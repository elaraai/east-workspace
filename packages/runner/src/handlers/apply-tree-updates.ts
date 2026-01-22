/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3DynamoStorage } from '@elaraai/e3-storage';
import { workspaceSetDatasetByHash } from '@elaraai/e3-core';
import { variant } from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';

// Initialize clients once at Lambda cold start
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});
const storage = new S3DynamoStorage(
  s3,
  dynamo,
  process.env.BUCKET_NAME!,
  process.env.TABLE_NAME!
);

/** Single tree update from a completed task */
export interface TreeUpdate {
  outputPath: string;
  outputHash: string;
  needsTreeUpdate: boolean;
}

export interface ApplyTreeUpdatesEvent {
  repo: string;
  workspace: string;
  /** Tree updates collected from the Map iteration results */
  treeUpdates: TreeUpdate[];
}

export interface ApplyTreeUpdatesOutput {
  /** Number of updates applied */
  updatesApplied: number;
}

/**
 * Lambda handler: Apply tree updates serially to workspace.
 *
 * Called by Step Functions after the parallel DispatchTasksMap completes.
 * Receives all tree updates collected from write-result and applies them
 * one by one to avoid lost update race conditions.
 */
export async function handler(event: ApplyTreeUpdatesEvent): Promise<ApplyTreeUpdatesOutput> {
  const { repo, workspace, treeUpdates } = event;

  // Filter to only updates that need tree writes (skip failed tasks)
  const pendingUpdates = treeUpdates.filter(u => u.needsTreeUpdate && u.outputPath && u.outputHash);

  console.log(`Applying ${pendingUpdates.length} tree updates to workspace ${workspace}`);

  // Apply updates serially to avoid race conditions
  for (const update of pendingUpdates) {
    console.log(`  Writing ${update.outputPath} = ${update.outputHash.slice(0, 12)}...`);
    const treePath = parsePathString(update.outputPath);
    await workspaceSetDatasetByHash(storage, repo, workspace, treePath, update.outputHash);
  }

  console.log(`Applied ${pendingUpdates.length} tree updates`);

  return { updatesApplied: pendingUpdates.length };
}

/**
 * Parse a keypath string (from pathToString) back to TreePath.
 *
 * The keypath format is: .field1.field2 (dot-separated field names)
 * Quoted identifiers use backticks: .field1.`complex/name`
 */
function parsePathString(pathStr: string): TreePath {
  if (!pathStr.startsWith('.')) {
    throw new Error(`Invalid path string: expected '.' prefix, got '${pathStr}'`);
  }

  const segments: TreePath = [];
  let i = 1; // Skip the leading '.'

  while (i < pathStr.length) {
    let fieldName: string;

    if (pathStr[i] === '`') {
      // Quoted identifier: find closing backtick
      const endQuote = pathStr.indexOf('`', i + 1);
      if (endQuote === -1) {
        throw new Error(`Invalid path string: unclosed backtick at position ${i}`);
      }
      fieldName = pathStr.slice(i + 1, endQuote);
      i = endQuote + 1;
    } else {
      // Unquoted identifier: read until '.' or end
      let end = pathStr.indexOf('.', i);
      if (end === -1) {
        end = pathStr.length;
      }
      fieldName = pathStr.slice(i, end);
      i = end;
    }

    segments.push(variant('field', fieldName) as unknown as TreePath[number]);

    // Skip the dot separator if present
    if (i < pathStr.length && pathStr[i] === '.') {
      i++;
    }
  }

  return segments;
}
