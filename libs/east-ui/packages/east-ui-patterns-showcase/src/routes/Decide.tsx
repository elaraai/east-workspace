import { Container, Heading, Stack, Text } from '@chakra-ui/react'
import {
  ArchetypeChips,
  BehaviourList,
  Block,
  MockFrame,
  PatternSection,
  PatternSpec,
  Prose,
  SlotTable,
  StateGrid,
} from '../spec/PatternSpec'
import {
  decisionBriefGuarded,
  decisionBriefStandard,
  decisionBriefTrivial,
} from '@elaraai/east-ui-patterns/examples/decision/brief'
import { exampleSources } from 'virtual:example-sources'
import { ExampleCard } from '../components/ExampleCard'

const briefSources = exampleSources['decision/brief'] ?? {}

const MODE = 'decide'
const PATTERN = 'decide.briefing'

export default function DecideRoute() {
  return (
    <Container maxW="container.lg" py={8}>

      {/* ─────── Mode header (product surface · §14) ─────── */}
      <Stack gap={3} mb={8} pb={5} borderBottomWidth="1px" borderBottomColor="border.subtle">
        <Text textStyle="eyebrow" color="brand.600">
          East UI · Decision-quality patterns · §2.3
        </Text>
        <Heading as="h1" textStyle="display.md">
          Decide
        </Heading>
        <Text textStyle="body.md" color="fg.muted" maxW="720px">
          Patterns that let a frontline business decision-maker accept, modify, or override a model
          recommendation with confidence, in 5–15 minutes, with the reasoning captured for accountability.
        </Text>
        <Text textStyle="body.md" fontStyle="italic" color="brand.700" maxW="720px">
          “Should I accept, modify, or override — and on what evidence?”
        </Text>
      </Stack>

      {/* ─────── Mode-level intro ─────── */}
      <Stack gap={6} mb={10}>

        <PatternSection label="The decision-maker's job">
          <Block locationId="decide.intro.job.persona" modeId={MODE}>
            <Prose>
              <Text>
                The user of a Decide-mode surface is a frontline business decision-maker — demand planner,
                store ops lead, buyer, scheduler, category manager, pricing analyst. They have <strong>5–15
                minutes per decision</strong> in a queue of dozens-to-hundreds per week. They carry
                <strong> private information the model cannot have</strong>: a conversation with a customer
                yesterday, a quality concern overheard on the floor, a regulatory whisper, weather they saw
                out the window. They are <strong>accountable for outcomes</strong> — they get evaluated, and
                they know it. Years of domain judgement sit beside the model's math.
              </Text>
            </Prose>
          </Block>

          <Block locationId="decide.intro.job.task" modeId={MODE}>
            <Prose>
              <Text>
                Their job is <em>not</em> to verify that the model's optimisation is optimal. Their job is
                to <strong>commit a defensible decision quickly</strong> that combines what the model knows
                with what they know, and that they can stand behind when their boss, a peer, or an auditor
                asks why. The platform's job, in their language: <em>"Give me the evidence I need to trust,
                modify, or override this rec — fast — and let me show my working when someone asks."</em>
              </Text>
            </Prose>
          </Block>
        </PatternSection>

        <PatternSection label='What "evidence for judgement" means'>
          <Block locationId="decide.intro.evidence.preamble" modeId={MODE}>
            <Prose>
              <Text>Decide-mode patterns serve seven kinds of evidence. Each kind earns its place by changing what the decision-maker does:</Text>
            </Prose>
          </Block>

          <Block locationId="decide.intro.evidence.argument" modeId={MODE}>
            <Prose>
              <Text><strong>1. The recommendation as an argument</strong> — claim, supporting reasons, upside, risks, unknowns, ask. Stated the way an executive briefing states it, not as a card with three slots of free text.</Text>
            </Prose>
          </Block>
          <Block locationId="decide.intro.evidence.unknowns" modeId={MODE}>
            <Prose>
              <Text><strong>2. What the model doesn't know</strong> — <em>epistemic</em> gaps (no comparable cases, novel scenario, model has been wrong here), not just aleatoric uncertainty.</Text>
            </Prose>
          </Block>
          <Block locationId="decide.intro.evidence.stakes" modeId={MODE}>
            <Prose>
              <Text><strong>3. Stakes in human terms</strong> — "$80k impact, affects 3 people, reversible 24h" — not button colour.</Text>
            </Prose>
          </Block>
          <Block locationId="decide.intro.evidence.refclass" modeId={MODE}>
            <Prose>
              <Text><strong>4. Reference class</strong> — "last 12 like this you accepted 9, were right 7"; "3 of 5 peers chose X"; "this kind of rec works ~73% of the time".</Text>
            </Prose>
          </Block>
          <Block locationId="decide.intro.evidence.risks" modeId={MODE}>
            <Prose>
              <Text><strong>5. Risks named in plain language</strong>, not buried in confidence intervals.</Text>
            </Prose>
          </Block>
          <Block locationId="decide.intro.evidence.commit" modeId={MODE}>
            <Prose>
              <Text><strong>6. A clean way to commit, modify, or reject with reason captured</strong> — defensible later, in the user's own voice.</Text>
            </Prose>
          </Block>
          <Block locationId="decide.intro.evidence.track" modeId={MODE}>
            <Prose>
              <Text><strong>7. Their own track record</strong> — surfaced from §2.6 Calibrate, referenced inline here when relevant.</Text>
            </Prose>
          </Block>
        </PatternSection>

        <PatternSection label="Cross-cutting commitments">
          <Block locationId="decide.intro.commitments.patches" modeId={MODE}>
            <Prose><Text><strong>Patches not callbacks.</strong> Every commit affordance emits a <code>Patch&lt;TState&gt;</code>. Preview, compose, undo all share one shape.</Text></Prose>
          </Block>
          <Block locationId="decide.intro.commitments.reason" modeId={MODE}>
            <Prose><Text><strong>Reason capture is mandatory on Modify and Override.</strong> Accept may be silent.</Text></Prose>
          </Block>
          <Block locationId="decide.intro.commitments.colour" modeId={MODE}>
            <Prose><Text><strong>Status colour always paired with an icon</strong> (§0.3). WCAG-friendly; never rely on hue alone.</Text></Prose>
          </Block>
          <Block locationId="decide.intro.commitments.numerals" modeId={MODE}>
            <Prose><Text><strong>Numerals in JetBrains Mono with <code>tabular-nums</code></strong>. Stakes, deltas, ranges align across the surface.</Text></Prose>
          </Block>
          <Block locationId="decide.intro.commitments.stakes" modeId={MODE}>
            <Prose><Text><strong>Stakes tag is mandatory on every commit affordance.</strong> The user must always know what they're committing to in human terms.</Text></Prose>
          </Block>
          <Block locationId="decide.intro.commitments.inset" modeId={MODE}>
            <Prose><Text><strong>Reference patterns are inset, not modal.</strong> They live alongside the briefing, not in dialogs that interrupt flow.</Text></Prose>
          </Block>
        </PatternSection>

      </Stack>

      {/* ─────── §2.3.1 Decision.Brief ─────── */}
      <PatternSpec
        modeId={MODE}
        patternId={PATTERN}
        anchor="2.3.1"
        name="Decision.Brief"
        question="What should I do, and on what evidence?"
        tags={[{ kind: 'anchor', label: 'anchor' }, { kind: 'family', label: 'Decision.*' }]}
      >

        {/* Purpose — three paragraphs, three blocks */}
        <PatternSection label="Purpose">
          <Block locationId="decide.briefing.purpose.shape" patternId={PATTERN} modeId={MODE}>
            <Prose>
              <Text>
                The Decision.Brief is the canonical Decide-mode pattern: it presents the model's
                recommendation as a <strong>structured argument</strong>. Six named slots — <em>claim</em>,
                <em> because</em>, <em>upside</em>, <em>risks</em>, <em>unknowns</em>, <em>ask</em> — force
                the recommendation into a shape the user can read in 30 seconds and defend in a meeting.
              </Text>
            </Prose>
          </Block>

          <Block locationId="decide.briefing.purpose.contrast" patternId={PATTERN} modeId={MODE}>
            <Prose>
              <Text>
                Where a generic action card invites a paragraph of free text, the Briefing requires the rec
                to commit to a <em>claim</em>, support it with at most three <em>because</em> bullets,
                name its <em>upside</em> in the user's currency, name its <em>risks</em> in plain language,
                surface what the model <em>doesn't know</em> (so the user knows where to apply private
                knowledge), and end with an <em>ask</em> — three commit affordances of escalating reasoning
                weight: Apply, Modify, Override.
              </Text>
            </Prose>
          </Block>

          <Block locationId="decide.briefing.purpose.spine" patternId={PATTERN} modeId={MODE}>
            <Prose>
              <Text>
                The Briefing is the spine of every Decide-mode screen. Reference, Judgement, and Stakes
                patterns flank it; commit affordances live in its <em>ask</em> row.
              </Text>
            </Prose>
          </Block>
        </PatternSection>

        {/* Mocks — each card runs the published @elaraai/east-ui-patterns example
            through the @elaraai/east-ui-patterns-components renderer, with a
            source-toggle to view the authored East code. */}
        <PatternSection label="Mocks">
          <Block locationId="decide.briefing.mock.standard" patternId={PATTERN} modeId={MODE}>
            <Text textStyle="sublabel">
              Standard accent — default for Routine, Exception, and most Commitment archetypes.
            </Text>
            <MockFrame>
              <ExampleCard
                name="decisionBriefStandard"
                example={decisionBriefStandard}
                source={briefSources.decisionBriefStandard}
                storageKey="decide.brief.standard"
              />
            </MockFrame>
          </Block>

          <Block locationId="decide.briefing.mock.guarded" patternId={PATTERN} modeId={MODE}>
            <Text textStyle="sublabel">
              Guarded (warn) accent — Commitment and material Strategic decisions.
            </Text>
            <MockFrame>
              <ExampleCard
                name="decisionBriefGuarded"
                example={decisionBriefGuarded}
                source={briefSources.decisionBriefGuarded}
                storageKey="decide.brief.guarded"
              />
            </MockFrame>
            <Text textStyle="caption" color="fg.muted">
              Apply opens <code>Commit.Confirm</code> with required audit note. Override remains a path;
              Modify shows when the model's case is open to refinement (here, "Edit terms").
            </Text>
          </Block>

          <Block locationId="decide.briefing.mock.trivial" patternId={PATTERN} modeId={MODE}>
            <Text textStyle="sublabel">
              Trivial — low-stakes Routine. Single Apply + Dismiss.
            </Text>
            <MockFrame>
              <ExampleCard
                name="decisionBriefTrivial"
                example={decisionBriefTrivial}
                source={briefSources.decisionBriefTrivial}
                storageKey="decide.brief.trivial"
              />
            </MockFrame>
            <Text textStyle="caption" color="fg.muted">
              No risks slot rendered (none material) — the row still shows "none material" so silent
              omissions don't read as oversight.
            </Text>
          </Block>
        </PatternSection>

        {/* Slots — East-typed contract. The authoring source is shown via the
            ExampleCard source-toggle on each mock above. */}
        <PatternSection label="Slots">
          <Block locationId="decide.briefing.slots.preamble" patternId={PATTERN} modeId={MODE}>
            <Prose>
              <Text>
                The pattern's contract is the East <code>StructType</code> below. Authors call
                <code> Decision.Brief.Root({'{'} … {'}'})</code>; the factory materialises each
                action and the optional aside into a <code>Button.Root(...)</code> so the renderer
                receives <code>UIComponentType</code> values it can dispatch.
                String-typed slots accept full <strong>GitHub-flavored markdown</strong> via the
                canonical <code>&lt;Markdown inline&gt;</code> primitive.
              </Text>
            </Prose>
          </Block>

          <Block locationId="decide.briefing.slots" patternId={PATTERN} modeId={MODE}>
            <SlotTable
              slots={[
                { name: 'claim', type: 'StringType', required: true,
                  description: 'Single concrete imperative sentence. Markdown-enabled.' },
                { name: 'because', type: 'ArrayType(DecisionBriefReasonType)', required: true,
                  description: 'Up to three supporting reasons. Each entry: { reason: StringType, accent: OptionType(StringType) }. Reason is markdown-enabled; accent is plain text rendered as a parenthetical. More than 3 → renderer slices to 3.' },
                { name: 'upside', type: 'StringType', required: true,
                  description: "Benefit of acting, in the user's primary currency. Markdown-enabled." },
                { name: 'risks', type: 'OptionType(StringType)', required: 'conditional',
                  description: 'Named risks in plain language. None → row renders "none material". Markdown-enabled when present.' },
                { name: 'unknowns', type: 'OptionType(StringType)', required: 'conditional',
                  description: "What the model didn't have at decision time. Pairs with Judgement.Gap. Markdown-enabled." },
                { name: 'stakes', type: 'StakesType', required: true,
                  description: 'Struct: impact (StakesValueType, required), affected (Option<String>), reversibility (Option<StakesValueType>). Always present.' },
                { name: 'actions', type: 'BriefActionInput[]', required: true,
                  description: 'Ordered row of commit-affordance buttons. Each entry is { label, options? }; the factory turns each into Button.Root(label, options). Style first as solid (primary commit), then outline / ghost.' },
                { name: 'aside', type: 'BriefActionInput | undefined', required: false,
                  description: 'Optional right-aligned auxiliary button — typically the "Why this and not alternatives?" link. Same { label, options? } shape; rendered with style: { variant: "ghost", size: "sm" }.' },
                { name: 'accent', type: 'OptionType(VariantType({ brand, warn, danger }))', required: false,
                  description: 'Left-rail tint hint. Default brand; warn for guarded; danger for irreversible. Auto-derived from commit-strength when not set.' },
              ]}
            />
          </Block>
        </PatternSection>

        {/* Behaviour */}
        <PatternSection label="Behaviour">
          <Block locationId="decide.briefing.behaviour" patternId={PATTERN} modeId={MODE}>
            <BehaviourList
              items={[
                <><strong>Apply</strong> emits the rec's <code>Patch&lt;TState&gt;</code> through the standard commit pipeline. <code>commitStrength</code> grades friction: <code>trivial</code> applies inline; <code>standard</code> opens <code>Commit.Confirm</code>; <code>guarded</code> requires audit note; <code>irreversible</code> requires typed confirmation + audit note.</>,
                <><strong>Modify</strong> opens <code>ModifyAndCommit</code> with the rec's patch as the editable starting point. The user adjusts; the resulting patch goes through commit with a <code>"modified"</code> tag in the audit and a structured reason captured.</>,
                <><strong>Override + why</strong> opens <code>OverrideWithReason</code> with no committed patch — the user commits a no-op (or their own patch) with a structured reason. Always reason-required; the model's rec is preserved in audit alongside the override.</>,
                <>The <strong>"Why this and not alternatives?"</strong> link opens <code>AlternativesList</code> in a side drawer. Optional — render only when alternatives exist with material differences.</>,
                <><strong>Reference patterns</strong> (Similar, Peers, Base) are typically rendered <em>below</em> or <em>beside</em> the briefing rather than inside it; the briefing stays compact. Some apps inline a single Reference chip in the eyebrow when space is tight.</>,
                <><strong>Capture-to-audit</strong>: every commit captures the briefing's claim, the chosen action (apply / modify / override), the patch, and any reason text. The Briefing is the source of the audit record's headline.</>,
                <><strong>Keyboard</strong>: <code>⏎</code> applies; <code>M</code> modifies; <code>O</code> overrides. Decide-mode screens never auto-focus the Apply button without a non-trivial <code>commitStrength</code> guard.</>,
              ]}
            />
          </Block>
        </PatternSection>

        {/* States */}
        <PatternSection label="States">
          <Block locationId="decide.briefing.states" patternId={PATTERN} modeId={MODE}>
            <StateGrid
              states={[
                { name: 'default',      description: 'Brand left-rail. Apply primary, Modify and Override secondary/ghost. Used for routine and standard archetypes.' },
                { name: 'guarded',      description: 'Orange left-rail. Apply opens Commit.Confirm with required audit note. Used for Commitment and material Strategic decisions.' },
                { name: 'irreversible', description: 'Red left-rail. Apply opens Commit.Confirm with typed confirmation + audit note. Override remains a path; Modify hidden.' },
                { name: 'applied',      description: 'After commit, the briefing collapses into a 1-line summary with timestamp + author, plus an Undo affordance while the rec is reversible.' },
                { name: 'stale',        description: 'When inputs have changed since computation, renders with a FreshnessChip (state: dirty) and a Refresh action. Apply disabled.' },
                { name: 'superseded',   description: 'When a newer rec for the same target has arrived, renders with a "newer rec available" banner. The current briefing remains until the user explicitly switches.' },
                { name: 'computing',    description: 'When recomputing (e.g. after a Judgement.Inject), renders with a skeleton claim line + spinner; commit affordances disabled.' },
                { name: 'no-rec',       description: 'When the model has no recommendation (e.g. infeasible inputs), renders with the claim "No action recommended" + a prominent Reference.Novelty or ComputeError explaining why.' },
              ]}
            />
          </Block>
        </PatternSection>

        {/* When to use */}
        <PatternSection label="When to use">
          <Block locationId="decide.briefing.archetypes.intro" patternId={PATTERN} modeId={MODE}>
            <Prose>
              <Text>
                <code>Decision.Brief</code> is the default for any single-rec Decide screen
                across all archetypes:
              </Text>
            </Prose>
          </Block>

          <Block locationId="decide.briefing.archetypes.chips" patternId={PATTERN} modeId={MODE}>
            <ArchetypeChips
              uses={{
                Routine: 'primary', Exception: 'primary', Commitment: 'primary',
                Strategic: 'primary', Reactive: 'primary', People: 'primary',
              }}
            />
          </Block>

          <Block locationId="decide.briefing.archetypes.notes" patternId={PATTERN} modeId={MODE}>
            <Prose>
              <Text textStyle="body.sm" color="fg.muted">
                For <em>Routine</em> in bulk, the Briefing collapses into <code>Decision.Queue</code> rows
                in a compact form (claim + stakes only); the user expands one when they need to dig in.
                For <em>People</em> archetype, <code>Override + why</code> is mandatory regardless of
                <code> commitStrength</code> — the platform refuses to commit a People decision without a
                structured reason.
              </Text>
            </Prose>
          </Block>
        </PatternSection>

        {/* Rationale */}
        <PatternSection label="Rationale &amp; non-obvious choices">
          <Block locationId="decide.briefing.rationale.three-reasons" patternId={PATTERN} modeId={MODE}>
            <Prose>
              <Text><strong>Why three reasons max?</strong> Decision research (Miller's law, Hick's law) and queue-time data both say three reasons read; five hide the strongest. The cap is a forcing function on the model — commit to its top three, not list ten.</Text>
            </Prose>
          </Block>
          <Block locationId="decide.briefing.rationale.dont-know" patternId={PATTERN} modeId={MODE}>
            <Prose>
              <Text><strong>Why "don't know" as a first-class slot?</strong> Most decision-quality literature treats epistemic uncertainty as a footnote. For our user the gap <em>is</em> their value-add — it's where their private knowledge enters. Naming it tells them where to look.</Text>
            </Prose>
          </Block>
          <Block locationId="decide.briefing.rationale.three-affordances" patternId={PATTERN} modeId={MODE}>
            <Prose>
              <Text><strong>Why three commit affordances, not one or two?</strong> Apply-only treats the user as a rubber-stamp; Apply/Reject treats overrides as failures. Apply / Modify / Override + why treats all three as legitimate, and modify is where most value-added action happens (the user knows something, adjusts, commits).</Text>
            </Prose>
          </Block>
          <Block locationId="decide.briefing.rationale.upside-first" patternId={PATTERN} modeId={MODE}>
            <Prose>
              <Text><strong>Why upside before risks?</strong> The model is biased toward proposing — its job is to surface action. Lead with the upside the model thinks justifies the action, so the user audits the model's claim before reading risks. Inverting (risks first) primes defensive overrides.</Text>
            </Prose>
          </Block>
          <Block locationId="decide.briefing.rationale.override-label" patternId={PATTERN} modeId={MODE}>
            <Prose>
              <Text><strong>Why "Override + why" in the button label?</strong> Discourages drive-by rejection. The button says what the action requires; clicking it commits to writing.</Text>
            </Prose>
          </Block>
        </PatternSection>

      </PatternSpec>

      {/* Placeholder for the rest of Decide */}
      <Stack gap={4} mt={20} pt={8} borderTopWidth="2px" borderTopColor="border.strong">
        <Text textStyle="eyebrow" color="fg.subtle">
          Coming up in §2.3
        </Text>
        <Text textStyle="body.md" color="fg.muted" maxW="700px">
          Reference family (Similar, Peers, Base, Novelty, Lesson) · Judgement family (Prompt,
          KnowledgePanel, Gap, Inject) · Stakes family (Tag, Radius) · ModifyAndCommit · OverrideWithReason
          · Commit family (Bar, Confirm, BatchBar) · AlternativesList · WhatIfList. Built one at a time
          following the Briefing's spec shape.
        </Text>
      </Stack>

    </Container>
  )
}
