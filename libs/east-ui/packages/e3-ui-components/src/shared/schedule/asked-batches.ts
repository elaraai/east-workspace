/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How a reader of a schedule's events asks e3 for the parts it wants, a
 * batch at a time (#1797): the one rule every such reader asks by — the event
 * kinds' (`cells.ts`) and a Plan's nested rows' (`plan/root/nested.ts`).
 *
 * A reader's reads are tracked: a request nobody reads any more is given up.
 * So while a read's own parts are still counted — what it wants not known
 * until they are — every batch on its way is asked again, as it was, whether
 * the read wants a part of it or not. Once they are counted, a batch on its way
 * is asked again by every read that still wants a part of it, whatever else
 * that read wants, and a part in no batch goes in one batch more. A view moving
 * on while its read is on its way then asks only for what no batch holds: the
 * read on its way lands, once, and is never asked twice. A batch the counted
 * read wants no part of is let go, and its request given up with it: a read
 * that wants one of its parts again asks that part in a batch of its own,
 * never the whole batch again.
 *
 * Parts named apart may still be read from the same rows — a change of period
 * names every cell anew over the rows the read on its way asks. The event
 * kinds' reader reads a run a request on its way holds — the same rows, as
 * many — through that request, as it was (the record slice source). A run a
 * landed request holds whole is read from it, and one it holds a part of is
 * asked of e3 whole (`platform/paged/batches.ts`).
 *
 * @packageDocumentation
 */

/**
 * Some parts asked of e3 in batches: each batch in flight asked again as it
 * was — while the parts are still counted, every one; once they are, each
 * holding a part not yet answered — the parts in none asked in a batch of
 * their own, and the batches that land let go. Once the parts are counted, a
 * batch holding no part wanted is let go unasked — nothing reads it, so its
 * request is given up — and a read wanting one of its parts again asks it
 * afresh.
 *
 * @typeParam P - A part: what one answer is of
 * @param parts - The parts wanted
 * @param name - A part's name among the parts: the same for the same part, read to read
 * @param answered - Whether a part is answered
 * @param inFlight - The batches in flight, which this keeps: one that lands is taken out, one wanted no more too, one asked anew put in
 * @param ask - Asks a batch: whether it landed, its answers kept by the caller
 * @param fresh - Whether the parts are counted, so the parts no batch holds are asked and a batch none of them is in let
 *   go; `false` while they are still counted, which asks again every batch on its way and nothing more
 * @returns Whether every part is answered
 */
export function scheduleBatchesAsked<P>(
    parts: readonly P[], name: (part: P) => string, answered: (part: P) => boolean, inFlight: P[][], ask: (batch: readonly P[]) => boolean,
    fresh = true,
): boolean {
    const missing = new Set(parts.filter((part) => !answered(part)).map(name));
    let complete = true;
    const asking = new Set<string>();
    for (const batch of [...inFlight]) {
        // Wanted no more by the read counted: unasked, its request is given up — kept, a read wanting a part of it again
        // would ask it whole. While the read is still counted, what it wants is not known: every batch is asked again.
        if (fresh && !batch.some((part) => missing.has(name(part)))) {
            inFlight.splice(inFlight.indexOf(batch), 1);
            continue;
        }
        if (ask(batch)) inFlight.splice(inFlight.indexOf(batch), 1);
        else { complete = false; for (const part of batch) asking.add(name(part)); }
    }
    const unasked = parts.filter((part) => missing.has(name(part)) && !answered(part) && !asking.has(name(part)));
    if (unasked.length === 0) return complete;
    if (!fresh) return false;
    if (!ask(unasked)) {
        inFlight.push(unasked);
        complete = false;
    }
    return complete;
}
