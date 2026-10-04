/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Where each record a `WebStorage` keeps is, in its records adapter: the keys
 * its stores and the run state store over the same records share.
 *
 * @packageDocumentation
 */

import type { RecordKey } from './adapters.js';

/**
 * The key of each record `WebStorage` keeps, in its records adapter.
 *
 * @remarks
 * A repository's metadata is `['repos', name]`, and everything else of it is
 * under `['repo', name]`, so its records scan and delete by that prefix. The
 * execution state store over the same records keeps a run's state at
 * {@link recordKeys.state}, and its events at {@link recordKeys.events}, which
 * a workspace's removal deletes with its other records.
 */
export const recordKeys = {
  /** A repository's metadata */
  repository: (repo: string): RecordKey => ['repos', repo],
  /** Every repository's metadata */
  repositories: (): RecordKey => ['repos'],
  /** Everything of a repository but its metadata */
  of: (repo: string): RecordKey => ['repo', repo],
  /** A kind of a repository's records */
  kind: (repo: string, kind: string): RecordKey => ['repo', repo, kind],
  /** The repository record */
  record: (repo: string): RecordKey => ['repo', repo, 'record'],
  /** The store upgrade under way, and where its last part stopped, while one is */
  upgrade: (repo: string): RecordKey => ['repo', repo, 'upgrade'],
  /** A package's ref: the package object's hash */
  package: (repo: string, name: string, version: string): RecordKey => ['repo', repo, 'package', name, version],
  /** A workspace's record */
  workspace: (repo: string, name: string): RecordKey => ['repo', repo, 'workspace', name],
  /** An execution attempt's status */
  execution: (repo: string, task: string, inputs: string, id: string): RecordKey => ['repo', repo, 'execution', task, inputs, id],
  /** An execution attempt's owner */
  owner: (repo: string, task: string, inputs: string, id: string): RecordKey => ['repo', repo, 'owner', task, inputs, id],
  /** The `$plan` a split task's execution is in */
  plan: (repo: string, task: string, inputs: string): RecordKey => ['repo', repo, 'plan', task, inputs],
  /** An entry of the adoption memo */
  adoption: (repo: string, source: string): RecordKey => ['repo', repo, 'adoption', source],
  /** A dataflow run's record */
  run: (repo: string, workspace: string, runId: string): RecordKey => ['repo', repo, 'run', workspace, runId],
  /** A dataset's ref, and the revision its write minted */
  dataset: (repo: string, workspace: string, path: string): RecordKey => ['repo', repo, 'dataset', workspace, path],
  /** A chunk of an execution attempt's log, by the byte of the log it starts
   *  at, in decimal zero-padded to sixteen digits */
  log: (repo: string, task: string, inputs: string, id: string, stream: string, start: string): RecordKey =>
    ['repo', repo, 'log', task, inputs, id, stream, start],
  /** The state of a resource's exclusive lock */
  lock: (repo: string, resource: string): RecordKey => ['repo', repo, 'lock', resource],
  /** What a resource's exclusive holder last reported of its progress */
  progress: (repo: string, resource: string): RecordKey => ['repo', repo, 'progress', resource],
  /** An object's entry in the catalogue */
  object: (repo: string, hash: string): RecordKey => ['repo', repo, 'object', hash],
  /** A write of an object's blob in flight */
  pending: (repo: string, blob: string): RecordKey => ['repo', repo, 'pending', blob],
  /** A part of a gc run in steps */
  gcRun: (repo: string, run: string, name: string): RecordKey => ['repo', repo, 'gc', run, name],
  /** A dataflow run's state, as `WebStateStore` keeps it */
  state: (repo: string, workspace: string, id: string): RecordKey => ['repo', repo, 'state', workspace, id],
  /** A dataflow run's events, as `WebStateStore` keeps them apart from its
   *  state: a segment of them under each key it extends this by, its first
   *  event's sequence number in decimal zero-padded to twenty digits */
  events: (repo: string, workspace: string, id: string): RecordKey => ['repo', repo, 'event', workspace, id],
};
