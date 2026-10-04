/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How e3-ui polls a task's log: only what is new each poll, from the offset
 * the last stopped at; from the first byte of another execution's log when
 * the task's current execution changes; and less often while nothing does.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LogOptions, TaskLogChunk } from '@elaraai/e3-api-client';
import { LOG_POLL_BACKOFF_MS, LOG_POLL_MS, nextLogPollMs, readTaskLogOn, type TaskLogRead } from '../src/hooks/useTaskLogsHook.js';

/** An execution's log as a server holds it. */
interface HeldExecution {
    inputsHash: string;
    executionId: string;
    text: string;
    ended: boolean;
}

/**
 * A task's executions' logs as the logs route serves them, the latest the
 * task's current, and every read asked of it.
 */
function server(): { executions: HeldExecution[]; reads: LogOptions[]; read: (options: LogOptions) => Promise<TaskLogChunk> } {
    const executions: HeldExecution[] = [];
    const reads: LogOptions[] = [];
    const read = (options: LogOptions): Promise<TaskLogChunk> => {
        reads.push(options);
        const named = options.execution;
        const execution = named === undefined ? executions.at(-1)! : executions.find((each) => each.executionId === named.executionId)!;
        const bytes = new TextEncoder().encode(execution.text);
        const offset = options.offset ?? 0;
        const slice = bytes.subarray(offset, offset + (options.limit ?? 65536));
        return Promise.resolve({
            data: new TextDecoder().decode(slice),
            offset: BigInt(offset),
            size: BigInt(slice.length),
            totalSize: BigInt(bytes.length),
            complete: offset + slice.length >= bytes.length,
            inputsHash: execution.inputsHash,
            executionId: execution.executionId,
            ended: execution.ended,
        });
    };
    return { executions, reads, read };
}

const INPUTS = 'a'.repeat(64);
const [FIRST, SECOND] = ['01993c00-0000-7000-8000-000000000001', '01993c00-0000-7000-8000-000000000002'];

describe('a task\'s log, polled', () => {
    it('reads only what is new each poll, from the offset the last poll stopped at', async () => {
        const { executions, reads, read } = server();
        executions.push({ inputsHash: INPUTS, executionId: FIRST, text: 'one\n', ended: false });

        const first = await readTaskLogOn(read, 'stdout', undefined);
        assert.deepEqual([first.log.data, first.log.offset, first.changed], ['one\n', 4, true]);

        executions[0]!.text += 'two\n';
        const second = await readTaskLogOn(read, 'stdout', first.log);
        assert.deepEqual([second.log.data, second.log.offset, second.changed], ['one\ntwo\n', 8, true]);

        const third = await readTaskLogOn(read, 'stdout', second.log);
        assert.deepEqual([third.log.data, third.changed], ['one\ntwo\n', false], 'nothing new');
        assert.deepEqual(reads.map((each) => each.offset), [0, 4, 8], 'each poll one read, from where the last stopped');
    });

    it('starts over from the first byte of another execution\'s log, naming it, when the task\'s current execution changes', async () => {
        const { executions, reads, read } = server();
        executions.push({ inputsHash: INPUTS, executionId: FIRST, text: 'the first run\n', ended: true });
        const first = await readTaskLogOn(read, 'stdout', undefined);

        executions.push({ inputsHash: INPUTS, executionId: SECOND, text: 'the second\n', ended: false });
        const second = await readTaskLogOn(read, 'stdout', first.log);
        assert.deepEqual([second.log.data, second.log.executionId, second.log.ended, second.changed], ['the second\n', SECOND, false, true]);
        assert.deepEqual(reads.slice(1).map((each) => [each.offset, each.execution?.executionId]), [[14, undefined], [0, SECOND]],
            'the poll found another execution, and read it from its first byte');
    });

    it('reads a log longer than a chunk a chunk at a time, each read after the first naming its execution', async () => {
        const { executions, reads, read } = server();
        const text = 'x'.repeat(100 * 1024);
        executions.push({ inputsHash: INPUTS, executionId: FIRST, text, ended: true });

        const { log } = await readTaskLogOn(read, 'stdout', undefined);
        assert.deepEqual([log.data.length, log.complete, log.ended], [text.length, true, true]);
        assert.deepEqual(reads.map((each) => [each.offset, each.execution?.executionId]), [[0, undefined], [64 * 1024, FIRST]]);
    });

    it('keeps at most 10 MB of a log, and past it reads no bytes, only whether the execution has changed or ended', async () => {
        const { executions, reads, read } = server();
        executions.push({ inputsHash: INPUTS, executionId: FIRST, text: 'y'.repeat(10 * 1024 * 1024 + 1024), ended: false });
        const first = await readTaskLogOn(read, 'stdout', undefined);
        assert.equal(first.log.data.length, 10 * 1024 * 1024);

        executions[0]!.ended = true;
        reads.length = 0;
        const after = await readTaskLogOn(read, 'stdout', first.log);
        assert.deepEqual(reads.map((each) => each.limit), [0], 'a read of no bytes');
        assert.deepEqual([after.log.data.length, after.log.ended, after.changed], [10 * 1024 * 1024, true, true]);
    });

    it('polls every second while it changes, backs off to 5 s while it does not, and waits the longest once its execution has ended and its log is read', () => {
        const running: TaskLogRead = { data: '', inputsHash: INPUTS, executionId: FIRST, offset: 0, totalSize: 0, complete: true, ended: false };
        const waits: number[] = [];
        let wait = LOG_POLL_MS;
        for (const changed of [false, false, false, false, true]) {
            wait = nextLogPollMs(wait, running, changed);
            waits.push(wait);
        }
        assert.deepEqual(waits, [2000, 4000, 5000, 5000, LOG_POLL_MS]);
        assert.equal(nextLogPollMs(LOG_POLL_MS, { ...running, ended: true }, true), LOG_POLL_BACKOFF_MS);
        assert.equal(nextLogPollMs(LOG_POLL_MS, { ...running, ended: true, complete: false }, true), LOG_POLL_MS, 'an ended log read on until it is read');
    });
});
