/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
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

const TABLE_NAME = process.env.TABLE_NAME!;

export interface WriteResultEvent {
  repo: string;
  workspace: string;
  executionId: string;
  taskName: string;
  outputPath: string;
  outputHash: string;
}

/**
 * Lambda handler: Write task output to workspace tree.
 *
 * Called by Step Functions after successful task execution to update
 * the workspace with the task's output.
 */
export async function handler(event: WriteResultEvent): Promise<void> {
  const { repo, workspace, executionId, taskName, outputPath, outputHash } = event;

  console.log(`Writing result for task ${taskName} to workspace ${workspace}`);
  console.log(`Output path: ${outputPath}, hash: ${outputHash}`);

  // Parse the output path string to TreePath
  const treePath = parsePathString(outputPath);

  // Update workspace tree with the output
  await workspaceSetDatasetByHash(storage, repo, workspace, treePath, outputHash);

  // Update execution state counters
  await dynamo.send(
    new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        PK: `REPO#${repo}`,
        SK: `EXEC#STATE#${workspace}`,
      }),
      UpdateExpression: 'SET completedCount = if_not_exists(completedCount, :zero) + :one',
      ExpressionAttributeValues: marshall({
        ':zero': 0,
        ':one': 1,
      }),
    })
  );

  console.log(`Successfully wrote output for task ${taskName}`);
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
