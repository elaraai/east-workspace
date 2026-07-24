
---
description: Reproduce a bug, prove the root cause, propose fixes without implementing
argument-hint: [bug description or issue #]
allowed-tools: Read, Grep, Glob, Bash
model: opus
---
## Bug

$ARGUMENTS

## Task

You are diagnosing, not fixing. You have no edit tools in this command — do not
attempt to work around that.

**1. Reproduce.** Find and run the smallest command that triggers the failure.
Paste the actual output verbatim. If you cannot reproduce it, say so explicitly,
state what you tried, and stop — do not proceed to a theory built on nothing.

**2. Prove the root cause.** Trace from the observed symptom back to the
defect, citing `path/to/file.ts:LINE` at each step. Show the evidence that
closes the loop — a log line, a failing assertion, a value printed at the point
of divergence. Distinguish what you observed from what you inferred.

**3. Rule out the alternatives.** Name the 1-3 other plausible explanations
and say what evidence eliminates each. If something remains unresolved, state
it as an open question rather than papering over it.

**4. Propose 2-4 distinct fix options.** Distinct means different in kind, not
three phrasings of the same patch. For each:

- one-line summary
- where it lands (files/libs touched, approximate size)
- what it costs — regressions risked, behaviour changed, tech debt added
- what it doesn't fix

   Include "leave it as-is" as an option when that's genuinely defensible.

**5. Recommend one** and say why in two sentences.

Then stop and wait for my approval. Do not begin implementation, do not write a
patch into your response, and do not start on the next thing.
