/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Plain-language **guidance** for every explainable element of the Experiment
 * surface — so a domain expert (e.g. a marketer) can hover any heading, control
 * or result and understand it without a statistician's vocabulary.
 *
 * This is a **built-in glossary**: the *concepts* are universal across every
 * experiment, so they're authored once here, never per-experiment and never by
 * the developer who drops in `<Experiment>`. The only per-experiment part is the
 * **nouns** — `{treatment}` / `{outcome}` / `{feature}` are interpolated from the
 * (ran) config's column names (run through `columns` labels), and `{subject}` /
 * `{subjects}` is the neutral noun for a row (`record(s)` — the component is
 * generic over any causal-analytics dataset, so it never assumes customers /
 * batches / patients). Result *specifics* (the actual numbers) stay derived at
 * the call site; here we only explain what a thing *means*.
 *
 * Each entry is three tiers of depth, shown stacked in the hover card:
 *  - `gist`   — Tier 1: one jargon-free sentence (what it is).
 *  - `detail` — Tier 2: why it matters / what to do with it.
 *  - `jargon` — Tier 3: the technical name, muted, for trust + the curious.
 */

/** One glossary entry — three tiers of depth. */
export interface HelpEntry {
    /** The heading/term (the card title). */
    term: string;
    /** Tier 1 — one plain sentence. */
    gist: string;
    /** Tier 2 — why it matters / what to do. */
    detail: string;
    /** Tier 3 — the technical name it maps to (for the curious). */
    jargon?: string;
}

/** Substitute `{treatment}` / `{outcome}` / `{feature}` (and any extra) tokens. */
export function fillHelp(entry: HelpEntry, vars: Record<string, string>): HelpEntry {
    const sub = (s: string) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k]! : m));
    return {
        term: sub(entry.term),
        gist: sub(entry.gist),
        detail: sub(entry.detail),
        ...(entry.jargon !== undefined ? { jargon: sub(entry.jargon) } : {}),
    };
}

/** The glossary, keyed by stable element id. */
export const HELP = {
    // ── Guidance mode (the toggle itself) ───────────────────────────────
    guidance: {
        term: 'Guidance',
        gist: 'Plain-language explainers for everything on this surface.',
        detail: 'While this is on, hover any heading, value or chart label to see what it means — in business terms, with the statistical name underneath. Click to turn it off.',
    },

    // ── Header ──────────────────────────────────────────────────────────
    header: {
        term: 'The question',
        gist: 'You’re asking whether {treatment} actually moved {outcome}.',
        detail: 'Pick the lever you changed and the result you cared about, then hit Run — the surface answers whether the change is real and trustworthy.',
        jargon: 'a binary-treatment causal effect',
    },

    // ── Set-up rail ─────────────────────────────────────────────────────
    step_treatment: {
        term: 'What did you change?',
        gist: 'The lever you’re testing — a yes/no flag on each {subject}.',
        detail: 'It splits {subjects} into a “did” group and a “didn’t” group; the whole experiment compares those two.',
        jargon: 'the treatment (binary)',
    },
    step_outcome: {
        term: 'What did you want it to improve?',
        gist: 'The result you’re hoping {treatment} moved.',
        detail: 'A number measured on each {subject} (revenue, a duration, a score, …). The effect is the change in this we can credit to the lever.',
        jargon: 'the outcome',
    },
    step_confounders: {
        term: 'What else was different?',
        gist: 'Things about the “did” group that could also explain the change.',
        detail: 'If the {subjects} you treated already differed on something that matters — bigger, older, higher-value — that, not the lever, could be moving the result. We level the playing field on each of these so the comparison is fair. Add the ones you suspect.',
        jargon: 'confounders / the backdoor adjustment set',
    },
    step_population: {
        term: 'Which {subjects}?',
        gist: 'Narrow the experiment to a slice of the {subjects}.',
        detail: 'Filter to a subset you care about — a region, a period, a category — before measuring, so the answer is about the {subjects} that matter.',
        jargon: 'population / cohort filter',
    },
    adv_method: {
        term: 'How to compare',
        gist: 'The maths used to make the like-for-like comparison.',
        detail: '“Regression” fits a line through the confounders; “re-weighting” up-weights rare look-alikes. They usually agree — if they don’t, treat the result with care.',
        jargon: 'estimator: linear regression vs propensity-score weighting',
    },
    adv_estimand: {
        term: 'Answer for',
        gist: 'Who the effect is reported for.',
        detail: '“All” averages over everyone; “only treated” asks what the lever did for the {subjects} you actually treated — useful when you’d only ever apply it to them.',
        jargon: 'estimand: ATE vs ATT',
    },
    confounder_imbalance: {
        term: 'How lopsided this one was',
        gist: 'How different the two groups were on this factor, before adjusting.',
        detail: 'A long bar means the treated and untreated {subjects} started far apart here — exactly the kind of gap the adjustment has to close.',
        jargon: 'standardised mean difference (SMD)',
    },

    // ── Tabs ────────────────────────────────────────────────────────────
    tab_answer: {
        term: 'The answer',
        gist: 'The headline: did {treatment} move {outcome}, and by how much?',
        detail: 'Shows the raw gap, the fair like-for-like estimate, and an honest verdict.',
    },
    tab_trust: {
        term: 'Can we trust it?',
        gist: 'The stress tests we ran to try to break the answer.',
        detail: 'Each check probes a way the result could be a fluke; green means it held up.',
    },
    tab_dose: {
        term: 'How much?',
        gist: 'How the result changes as a factor goes up or down.',
        detail: 'Not just yes/no — the shape of the response, so you can find the sweet spot.',
    },

    // ── Answer tab ──────────────────────────────────────────────────────
    answer_effect: {
        term: 'Like-for-like effect',
        gist: 'The change in {outcome} we can credit to {treatment}.',
        detail: 'It compares treated vs untreated {subjects} who were otherwise similar — so it strips out “who you targeted” and leaves the lever’s real impact.',
        jargon: 'the backdoor-adjusted average treatment effect',
    },
    answer_ci: {
        term: '95% range',
        gist: 'Where the true effect most likely sits.',
        detail: 'If this range doesn’t cross 0, the effect is real, not noise. The wider it is, the less certain — usually because of fewer {subjects}.',
        jargon: '95% confidence interval',
    },
    answer_flip: {
        term: 'Raw and like-for-like disagree',
        gist: 'The plain average points one way; the fair comparison points the other.',
        detail: 'This happens when the treated group differed sharply on a confounder. Trust the like-for-like number — the raw gap is misleading here.',
        jargon: 'confounding / Simpson’s-paradox sign flip',
    },
    answer_cautious: {
        term: 'Treat this as provisional',
        gist: 'We got a number, but a trust check failed.',
        detail: 'The estimate may still be driven by something we didn’t adjust for. See “Can we trust it?” before acting on it.',
        jargon: 'adjustment_insufficient verdict',
    },
    forest_plot: {
        term: 'Raw average vs. like-for-like',
        gist: 'The misleading number next to the fair one.',
        detail: 'Each bar is an estimate with its uncertainty range; the dashed line is “no effect”. A bar clear of that line is a real change.',
        jargon: 'a forest plot of naive vs adjusted estimates',
    },
    forest_naive: {
        term: 'Raw average',
        gist: 'The plain difference, with no adjusting.',
        detail: 'Just treated-minus-untreated. It mixes in who you targeted, so it can mislead — it’s here only as the “before” picture.',
        jargon: 'the unadjusted mean difference',
    },
    forest_adjusted: {
        term: 'Like-for-like',
        gist: 'The fair comparison after levelling the confounders.',
        detail: 'This is the number to act on — what {treatment} did among otherwise-similar {subjects}.',
        jargon: 'the adjusted effect',
    },
    balance: {
        term: 'How unbalanced each one was',
        gist: 'How far apart the two groups started on each factor.',
        detail: 'Big bars are the factors the adjustment had to work hardest to correct — and the ones most worth double-checking.',
        jargon: 'pre-adjustment covariate balance (SMD)',
    },
    counts: {
        term: 'The {subject} counts',
        gist: 'How many {subjects} went into the comparison.',
        detail: '“Compared like-for-like” are the ones with a fair match on the other side; “no fair match” were set aside because nobody comparable existed.',
        jargon: 'n total / on-support / off-support',
    },

    // ── Refusal zones + overlap ─────────────────────────────────────────
    overlap_histogram: {
        term: 'Do the two groups overlap?',
        gist: 'Whether treated and untreated {subjects} actually look alike anywhere.',
        detail: 'Each bar is how many {subjects} sit at a given “likelihood of being treated”. Where the two arms both have bars, a fair comparison exists; if they barely meet, there’s nothing to compare.',
        jargon: 'propensity-score overlap / common support',
    },
    refusal_positivity: {
        term: 'No like-for-like comparison exists',
        gist: 'The treated and untreated {subjects} are too different to compare.',
        detail: 'For almost every treated {subject} there’s no similar untreated one (or vice-versa), so there’s no fair “other side”. We refuse rather than extrapolate into thin air. Try fewer or different confounders.',
        jargon: 'positivity / overlap violation',
    },
    refusal_not_estimable: {
        term: 'Can’t be estimated',
        gist: 'Almost every {subject} is on one side of {treatment}, so there’s no comparison group.',
        detail: 'Measuring an effect needs a decent number of {subjects} who got the lever AND who didn’t. When one side is just a handful, we refuse to guess rather than read too much into a few people.',
        jargon: 'no treatment variation',
    },

    // ── Trust tab ───────────────────────────────────────────────────────
    trust_intro: {
        term: 'Can we trust it?',
        gist: 'Before believing the answer, we tried to break it.',
        detail: 'Each row is a different way the result could be a fluke; colour shows whether it held up (pass) or wobbled (caution).',
    },
    check_shuffle: {
        term: 'Shuffle test',
        gist: 'We randomly re-label who got {treatment} and re-measure.',
        detail: 'On fake labels a genuine effect should collapse to nothing. If a “fake” effect still appears, the real one isn’t trustworthy.',
        jargon: 'placebo / permutation refuter',
    },
    check_dropsome: {
        term: 'Drop-some test',
        gist: 'We re-run on random slices of the {subjects}.',
        detail: 'A trustworthy effect barely moves when you drop some data; a jumpy one is resting on a few {subjects}.',
        jargon: 'data-subset refuter',
    },
    check_decoy: {
        term: 'Decoy factor',
        gist: 'We add a totally random extra factor and re-measure.',
        detail: 'A made-up factor shouldn’t change the answer. If it does, the model is over-reacting to noise.',
        jargon: 'random-common-cause refuter',
    },
    check_hidden: {
        term: 'Hidden cause',
        gist: 'How strong an unrecorded cause would have to be to overturn the result.',
        detail: 'Something you didn’t measure could drive both who got {treatment} and {outcome}. “Holds throughout” means only an implausibly strong hidden cause could flip it.',
        jargon: 'unobserved-confounding sensitivity / E-value',
    },
    sensitivity: {
        term: 'Effect as a hidden cause gets stronger',
        gist: 'What happens to the effect if an unrecorded cause is dialled up.',
        detail: 'The line is the estimate as a simulated hidden cause grows. The point where it crosses 0 is how much hidden bias it would take to erase the result.',
        jargon: 'sensitivity (tipping-point) curve',
    },

    // ── Dose tab ────────────────────────────────────────────────────────
    dose_curve: {
        term: '{outcome} gained vs. {feature}',
        gist: 'How {outcome} responds as {feature} goes up.',
        detail: 'The line is the average change in {outcome} at each level of {feature}, with its uncertainty band — the shape tells you where more pays off and where it flattens.',
        jargon: 'accumulated local effects (ALE) dose-response',
    },
    dose_here: {
        term: 'You are here',
        gist: 'Where most of your {subjects} currently sit on {feature}.',
        detail: 'The busiest level today — your starting point for deciding whether to push higher or lower.',
        jargon: 'the modal bin',
    },
    dose_sweet: {
        term: 'Sweet spot',
        gist: 'Where the gains are solid and start to flatten.',
        detail: 'Past here, pushing {feature} higher buys little extra {outcome} — a sensible target.',
        jargon: 'the diminishing-returns knee',
    },
    dose_reco: {
        term: 'Recommended',
        gist: 'The level of {feature} we’d aim for.',
        detail: 'The sweet-spot level and the {outcome} you’d expect there, with its range — and the trade-off of going one step further.',
        jargon: 'the recommended operating point',
    },
    dose_marginal: {
        term: 'Extra {outcome} per step',
        gist: 'What each additional step of {feature} buys you.',
        detail: 'Tall early bars then short ones is the classic diminishing-returns shape — spend effort where the bars are tall.',
        jargon: 'marginal / incremental effect per bin',
    },

    // ── Verdicts ────────────────────────────────────────────────────────
    verdict_causal: {
        term: 'Causal',
        gist: 'A real change you can credit to {treatment} — and it held up.',
        detail: 'The like-for-like effect is clear, sizeable, and survived the trust checks. Safe to act on.',
        jargon: 'a robust, identified effect',
    },
    verdict_modest: {
        term: 'Modest / unclear',
        gist: 'There may be an effect, but it’s small or fuzzy.',
        detail: 'The fair comparison can’t cleanly separate it from no-effect (the range straddles 0, or it’s tiny). Don’t bet much on it.',
        jargon: 'effect CI spans zero / below materiality',
    },
    verdict_adjustment_insufficient: {
        term: 'Not trustworthy yet',
        gist: 'We got a number, but a trust check failed.',
        detail: 'Likely something we didn’t adjust for is still in play. Treat as provisional and look at “Can we trust it?”.',
        jargon: 'placebo / robustness failure',
    },
    verdict_non_identifiable_positivity: {
        term: 'No fair comparison',
        gist: 'Treated and untreated {subjects} don’t overlap enough to compare.',
        detail: 'There’s no like-for-like “other side”, so any number would be extrapolation. See the overlap chart.',
        jargon: 'positivity / overlap violation',
    },
    verdict_not_estimable: {
        term: 'Can’t be estimated',
        gist: 'Almost everyone is on one side of {treatment} — no comparison group.',
        detail: 'One arm is just a handful of {subjects}, so we won’t guess an effect from it.',
        jargon: 'no treatment variation',
    },

    // ── Validate tab ────────────────────────────────────────────────────
    tab_validate: {
        term: 'Prove it',
        gist: 'The real experiment you’d run to prove this — for sure.',
        detail: 'This analysis adjusted for what it could measure. A controlled trial — assigning {treatment} at random — removes any leftover doubt. This tab sizes that trial.',
    },
    validate_size: {
        term: 'How many to run',
        gist: 'The number of {subjects} the trial needs.',
        detail: 'Enough to spot a change this size if it’s real. A bigger or cleaner effect needs fewer; a small or noisy one needs many more.',
        jargon: 'required sample size at the target power',
    },
    validate_split: {
        term: 'How to split them',
        gist: 'How many get {treatment} versus are left alone.',
        detail: 'Assign at random — that’s what makes the two groups comparable with no adjusting. An even split is the most efficient; treating fewer needs a larger total.',
        jargon: 'randomised allocation between arms',
    },
    validate_match: {
        term: 'Match the groups on',
        gist: 'Keep both groups balanced on these — they were lopsided last time.',
        detail: 'Give each group the same mix of these factors when you split, so neither one starts ahead. These are the factors that muddied the original comparison most.',
        jargon: 'stratified / blocked randomisation on the high-imbalance covariates',
    },
    validate_power: {
        term: 'Chance of detecting it',
        gist: 'How likely the trial is to catch the effect, by size.',
        detail: 'More {subjects} means a better chance of a clear result. The marker shows where today’s data sits — usually well short of a confident answer.',
        jargon: 'statistical power vs sample size',
    },
    validate_holdback: {
        term: 'Hold back a control',
        gist: 'Keep a random group untreated to compare against.',
        detail: 'Right now almost everything got {treatment}, so there’s nothing to compare to. Next time, leave a random sample untreated — that group becomes the fair baseline.',
        jargon: 'a randomised control arm',
    },

    // ── Journal ─────────────────────────────────────────────────────────
    journal: {
        term: 'Committed experiments',
        gist: 'A log of the questions you’ve saved.',
        detail: 'Each row is a framing you committed — its verdict and headline effect — so the team can see what’s been tried and what held up.',
        jargon: 'the experiment journal',
    },
} as const;

/** Every valid help id. */
export type HelpId = keyof typeof HELP;
