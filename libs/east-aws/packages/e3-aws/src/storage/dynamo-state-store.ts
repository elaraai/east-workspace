/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * DynamoDB-backed ExecutionStateStore implementation for e3 cloud.
 *
 * This store manages dataflow execution state using:
 * - DynamoDB for execution state records (BEAST2 encoded)
 * - S3 for large graphs (stored separately by graphHash)
 *
 * Implements the ExecutionStateStore interface from @elaraai/e3-core for
 * compatibility with the step functions and e3-core-tests.
 */

import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { S3Client } from '@aws-sdk/client-s3';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { encodeBeast2For, decodeBeast2For, some, none } from '@elaraai/east';
import {
  DataflowExecutionStateType,
  DataflowGraphType,
} from '@elaraai/e3-types';
import type {
  ExecutionStateStore,
  TaskStatusDetails,
  ExecutionStatusDetails,
  DataflowExecutionState,
  ExecutionEvent,
  DataflowTaskStatus,
  TaskState,
} from '@elaraai/e3-core';

// Create encoder/decoder for BEAST2 serialization
const encodeState = encodeBeast2For(DataflowExecutionStateType);
const decodeState = decodeBeast2For(DataflowExecutionStateType);
const encodeGraph = encodeBeast2For(DataflowGraphType);
const decodeGraph = decodeBeast2For(DataflowGraphType);

// Type helper for mutable state (removes readonly)
type Mutable<T> = { -readonly [P in keyof T]: T[P] extends object ? Mutable<T[P]> : T[P] };

/**
 * DynamoDB partition key prefix for execution state records.
 */
const STATE_PREFIX = 'STATE';

/**
 * S3 key prefix for storing large graphs.
 */
const GRAPHS_PREFIX = 'graphs';

/**
 * Maximum size for inline graph storage (350KB to leave room for other attributes)
 */
const MAX_INLINE_GRAPH_SIZE = 350 * 1024;

/**
 * DynamoDB-backed execution state store implementing ExecutionStateStore interface.
 *
 * This store persists dataflow execution state to DynamoDB using BEAST2 encoding,
 * with large graphs stored separately in S3 to avoid DynamoDB's 400KB item size limit.
 *
 * Schema:
 * - PK: STATE/{repo}/{workspace}
 * - SK: {executionId} (zero-padded 10 digits) | "_counter" | "_graph/{graphHash}"
 *
 * State records contain the full DataflowExecutionState serialized as BEAST2 binary.
 */
export class DynamoDBStateStore implements ExecutionStateStore {
  constructor(
    private readonly dynamo: DynamoDBClient,
    private readonly s3: S3Client,
    private readonly bucketName: string,
    private readonly tableName: string
  ) {}

  /**
   * Create a new execution state record.
   */
  async create(state: DataflowExecutionState): Promise<void> {
    const pk = `${STATE_PREFIX}/${state.repo}/${state.workspace}`;
    const sk = this.padExecutionId(state.id);

    // Externalize graph if too large
    const stateToStore = await this.externalizeGraphIfNeeded(state);

    // Encode the state as BEAST2
    const encodedState = encodeState(stateToStore);

    await this.dynamo.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: marshall({
          PK: pk,
          SK: sk,
          state: encodedState,
          status: state.status, // Denormalized for cheap status checks (e.g., cancellation)
          version: 1,
          updatedAt: new Date().toISOString(),
        }),
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );
  }

  /**
   * Read an execution state by ID.
   */
  async read(
    repo: string,
    workspace: string,
    id: string
  ): Promise<DataflowExecutionState | null> {
    const pk = `${STATE_PREFIX}/${repo}/${workspace}`;
    const sk = this.padExecutionId(id);

    const response = await this.dynamo.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({ PK: pk, SK: sk }),
        ConsistentRead: true,
      })
    );

    if (!response.Item) {
      return null;
    }

    const item = unmarshall(response.Item);
    const state = decodeState(item.state as Uint8Array);

    // If graph was externalized, load it from S3
    if (state.graph.type === 'none' && state.graphHash.type === 'some') {
      const graph = await this.loadGraph(repo, state.graphHash.value);
      const mutableState = state as Mutable<DataflowExecutionState>;
      mutableState.graph = some(graph);
    }

    return state;
  }

  /**
   * Read the latest execution state for a workspace.
   */
  async readLatest(
    repo: string,
    workspace: string
  ): Promise<DataflowExecutionState | null> {
    const pk = `${STATE_PREFIX}/${repo}/${workspace}`;

    // Query for execution records (SK is zero-padded 10-digit number like "0000000001")
    // Use SK BETWEEN to get numeric IDs only, excluding _counter and _graph/ entries
    const response = await this.dynamo.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
        ExpressionAttributeValues: marshall({
          ':pk': pk,
          ':start': '0000000000', // Min 10-digit padded ID
          ':end': '9999999999',   // Max 10-digit padded ID
        }),
        ScanIndexForward: false, // Descending order to get latest first
        Limit: 1,
        ConsistentRead: true,
      })
    );

    if (!response.Items || response.Items.length === 0) {
      return null;
    }

    const item = unmarshall(response.Items[0]);
    const state = decodeState(item.state as Uint8Array);

    // If graph was externalized, load it from S3
    if (state.graph.type === 'none' && state.graphHash.type === 'some') {
      const graph = await this.loadGraph(repo, state.graphHash.value);
      const mutableState = state as Mutable<DataflowExecutionState>;
      mutableState.graph = some(graph);
    }

    return state;
  }

  /**
   * Update an existing execution state.
   *
   * Uses a conditional write to prevent overwriting 'cancelled' status with
   * another status. This handles race conditions where cancel is called during
   * task execution.
   */
  async update(state: DataflowExecutionState): Promise<void> {
    const pk = `${STATE_PREFIX}/${state.repo}/${state.workspace}`;
    const sk = this.padExecutionId(state.id);

    // Externalize graph if too large
    const stateToStore = await this.externalizeGraphIfNeeded(state);

    // Encode the state as BEAST2
    const encodedState = encodeState(stateToStore);

    // Use conditional write to prevent overwriting 'cancelled' status
    // The condition allows the write if:
    // 1. The new status is 'cancelled' (cancel operation), OR
    // 2. The existing status is NOT 'cancelled' (normal operations)
    // This prevents handlers from accidentally overwriting a cancellation
    try {
      await this.dynamo.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: marshall({
            PK: pk,
            SK: sk,
            state: encodedState,
            status: state.status, // Denormalized for cheap status checks (e.g., cancellation)
            version: 1, // TODO: implement optimistic concurrency with version increment
            updatedAt: new Date().toISOString(),
          }),
          // Only allow the write if new status is 'cancelled' OR existing status is not 'cancelled'
          ConditionExpression: ':newStatus = :cancelled OR attribute_not_exists(#status) OR #status <> :cancelled',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: marshall({
            ':newStatus': state.status,
            ':cancelled': 'cancelled',
          }),
        })
      );
    } catch (err: unknown) {
      // If the condition failed because status is already 'cancelled', that's fine
      // Re-read the state and update with 'cancelled' preserved
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
        console.log('Preserving cancelled status (concurrent cancellation detected)');
        const currentState = await this.read(state.repo, state.workspace, state.id);
        if (currentState?.status === 'cancelled') {
          // Re-encode with cancelled status preserved
          const cancelledState = { ...stateToStore, status: 'cancelled' as const };
          const cancelledEncoded = encodeState(cancelledState as DataflowExecutionState);

          await this.dynamo.send(
            new PutItemCommand({
              TableName: this.tableName,
              Item: marshall({
                PK: pk,
                SK: sk,
                state: cancelledEncoded,
                status: 'cancelled',
                version: 1,
                updatedAt: new Date().toISOString(),
              }),
            })
          );
        }
        return;
      }
      throw err;
    }
  }

  /**
   * Update a task's status within an execution.
   */
  async updateTaskStatus(
    repo: string,
    workspace: string,
    executionId: string,
    task: string,
    status: DataflowTaskStatus,
    details?: TaskStatusDetails
  ): Promise<void> {
    const state = await this.read(repo, workspace, executionId);
    if (!state) {
      throw new Error(`Execution ${executionId} not found in workspace '${workspace}'`);
    }

    const taskState = state.tasks.get(task) as Mutable<TaskState> | undefined;
    if (!taskState) {
      throw new Error(`Task '${task}' not found in execution ${executionId}`);
    }

    const mutableState = state as Mutable<DataflowExecutionState>;

    taskState.status = status;
    if (details) {
      if (details.cached !== undefined) taskState.cached = some(details.cached);
      if (details.outputHash !== undefined) taskState.outputHash = some(details.outputHash);
      if (details.error !== undefined) taskState.error = some(details.error);
      if (details.exitCode !== undefined) taskState.exitCode = some(BigInt(details.exitCode));
      if (details.duration !== undefined) taskState.duration = some(BigInt(details.duration));
    }
    taskState.completedAt = some(new Date());

    // Update counters based on status
    if (status === 'completed' && details?.cached) {
      mutableState.cached = state.cached + 1n;
    } else if (status === 'completed') {
      mutableState.executed = state.executed + 1n;
    } else if (status === 'failed') {
      mutableState.failed = state.failed + 1n;
    } else if (status === 'skipped') {
      mutableState.skipped = state.skipped + 1n;
    }

    await this.update(state);
  }

  /**
   * Update the overall execution status.
   */
  async updateStatus(
    repo: string,
    workspace: string,
    executionId: string,
    status: 'running' | 'completed' | 'failed' | 'cancelled',
    details?: ExecutionStatusDetails
  ): Promise<void> {
    const state = await this.read(repo, workspace, executionId);
    if (!state) {
      throw new Error(`Execution ${executionId} not found in workspace '${workspace}'`);
    }

    const mutableState = state as Mutable<DataflowExecutionState>;

    mutableState.status = status;
    if (status !== 'running') {
      mutableState.completedAt = some(new Date());
    }
    if (details?.error) {
      mutableState.error = some(details.error);
    }
    if (details?.summary) {
      mutableState.executed = BigInt(details.summary.executed);
      mutableState.cached = BigInt(details.summary.cached);
      mutableState.failed = BigInt(details.summary.failed);
      mutableState.skipped = BigInt(details.summary.skipped);
    }

    await this.update(state);
  }

  /**
   * Record an event for an execution.
   */
  async recordEvent(
    repo: string,
    workspace: string,
    executionId: string,
    event: ExecutionEvent
  ): Promise<void> {
    const state = await this.read(repo, workspace, executionId);
    if (!state) {
      throw new Error(`Execution ${executionId} not found in workspace '${workspace}'`);
    }

    // Append event to inline events array (cast to mutable array)
    (state.events as ExecutionEvent[]).push(event);

    await this.update(state);
  }

  /**
   * Get events since a given sequence number.
   */
  async getEventsSince(
    repo: string,
    workspace: string,
    executionId: string,
    sinceSeq: number
  ): Promise<ExecutionEvent[]> {
    const state = await this.read(repo, workspace, executionId);
    if (!state) {
      return [];
    }

    // Filter events from inline array
    const sinceSeqBigInt = BigInt(sinceSeq);
    return state.events.filter(e => {
      // Events are variants, so we access seq via e.value.seq
      const seq = e.value.seq;
      return seq > sinceSeqBigInt;
    });
  }

  /**
   * Generate the next execution ID for a workspace.
   */
  async nextExecutionId(repo: string, workspace: string): Promise<string> {
    const pk = `${STATE_PREFIX}/${repo}/${workspace}`;
    const sk = '_counter';

    const response = await this.dynamo.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({ PK: pk, SK: sk }),
        UpdateExpression: 'SET nextId = if_not_exists(nextId, :zero) + :one',
        ExpressionAttributeValues: marshall({ ':zero': 0, ':one': 1 }),
        ReturnValues: 'UPDATED_NEW',
      })
    );

    const nextId = response.Attributes
      ? (unmarshall(response.Attributes).nextId as number)
      : 1;

    return nextId.toString().padStart(10, '0');
  }

  /**
   * Delete an execution state.
   */
  async delete(repo: string, workspace: string, executionId: string): Promise<void> {
    const pk = `${STATE_PREFIX}/${repo}/${workspace}`;
    const sk = this.padExecutionId(executionId);

    await this.dynamo.send(
      new DeleteItemCommand({
        TableName: this.tableName,
        Key: marshall({ PK: pk, SK: sk }),
      })
    );
  }

  /**
   * Pad execution ID to 10 digits for proper sorting.
   */
  private padExecutionId(id: string): string {
    // If already padded or not a number, return as-is
    if (id.length === 10 || !/^\d+$/.test(id)) {
      return id;
    }
    return id.padStart(10, '0');
  }

  /**
   * Externalize graph to S3 if too large for inline storage.
   * Returns a state with graph set to none and graphHash set if externalized.
   */
  private async externalizeGraphIfNeeded(
    state: DataflowExecutionState
  ): Promise<DataflowExecutionState> {
    // If no inline graph, nothing to externalize
    if (state.graph.type !== 'some') {
      return state;
    }

    // Check size of encoded graph
    const encodedGraph = encodeGraph(state.graph.value);
    if (encodedGraph.length <= MAX_INLINE_GRAPH_SIZE) {
      return state;
    }

    // Compute hash and store externally
    const graphHash = this.computeHash(encodedGraph);
    await this.storeGraph(state.repo, graphHash, encodedGraph);

    // Return state with externalized graph reference
    const mutableState = { ...state } as Mutable<DataflowExecutionState>;
    mutableState.graph = none;
    mutableState.graphHash = some(graphHash);
    return mutableState as DataflowExecutionState;
  }

  /**
   * Compute the hash of content for content-addressed storage.
   */
  private computeHash(content: Uint8Array): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Store a graph in S3.
   */
  private async storeGraph(repo: string, graphHash: string, encodedGraph: Uint8Array): Promise<void> {
    const key = `${GRAPHS_PREFIX}/${repo}/${graphHash}.beast2`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: encodedGraph,
        ContentType: 'application/octet-stream',
      })
    );
  }

  /**
   * Load a graph from S3.
   */
  private async loadGraph(repo: string, graphHash: string): Promise<ReturnType<typeof decodeGraph>> {
    const key = `${GRAPHS_PREFIX}/${repo}/${graphHash}.beast2`;

    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      })
    );

    const body = await response.Body!.transformToByteArray();
    return decodeGraph(body);
  }
}
