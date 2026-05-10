import { Box, Container, HStack, Heading, Stack, Text } from '@chakra-ui/react'
import { Link } from 'react-router-dom'

const MODES = [
  { path: '/observe',     label: 'Observe',       q: 'What needs my attention?', state: 'placeholder' as const },
  { path: '/predict',     label: 'Predict',       q: 'If I act vs do nothing — what changes?', state: 'placeholder' as const },
  { path: '/diagnose',    label: 'Diagnose',      q: 'Why is the rec what it is?', state: 'placeholder' as const },
  { path: '/decide',      label: 'Decide',        q: 'Should I accept, modify, or override — and on what evidence?', state: 'built' as const, anchor: true },
  { path: '/compare',     label: 'Compare',       q: 'How does this differ from last time?', state: 'placeholder' as const },
  { path: '/calibrate',   label: 'Calibrate',     q: 'Was my judgement right?', state: 'placeholder' as const },
  { path: '/configure',   label: 'Configure',     q: 'What inputs drive this?', state: 'placeholder' as const },
  { path: '/frame-trust', label: 'Frame & trust', q: 'Should I trust this; can I defend my decision later?', state: 'placeholder' as const },
] as const

export default function IndexRoute() {
  return (
    <Container maxW="container.lg" py={8}>
      <Stack gap={6}>
        <Stack gap={2}>
          <Text textStyle="eyebrow" color="brand.600">
            Elara · East UI · Decision-quality patterns
          </Text>
          <Heading as="h1" textStyle="display.md">
            Patterns that turn a model recommendation into a defensible decision
          </Heading>
          <Text textStyle="body.md" color="fg.muted" maxW="720px">
            Authoritative spec for the components a frontline business decision-maker uses to accept,
            modify, or override the model's call — with reasoning captured, accountability preserved, and
            their judgement front and centre.
          </Text>
        </Stack>

        <Stack gap={2} pt={2}>
          <Text textStyle="eyebrow" color="fg.subtle">
            The user
          </Text>
          <Text textStyle="body.md" color="fg" maxW="720px">
            Demand planner, store ops lead, buyer, scheduler, category manager, pricing analyst,
            brand manager, account lead. They have <strong>5–15 minutes per decision</strong> in a
            queue of dozens-to-hundreds per week. They carry <strong>private information the model
            cannot have</strong>. They are <strong>accountable for outcomes</strong>. Their job is to
            commit a defensible decision quickly that combines what the model knows with what they
            know.
          </Text>
        </Stack>

        <Stack gap={2} pt={2}>
          <Text textStyle="eyebrow" color="fg.subtle">
            Modes
          </Text>
          <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap={3}>
            {MODES.map(m => (
              <Link key={m.path} to={m.path} style={{ textDecoration: 'none' }}>
                <Box
                  layerStyle={m.state === 'built' ? 'card' : 'card.flat'}
                  _hover={{ borderColor: 'border.strong' }}
                  transition="border-color {durations.fast} {easings.out}"
                  height="full"
                >
                  <HStack justify="space-between" align="baseline" mb={1}>
                    <Text textStyle="title.row" color={m.state === 'built' ? 'brand.700' : 'fg'}>
                      {m.label}
                    </Text>
                    <ModeStateChip state={m.state} />
                  </HStack>
                  <Text textStyle="body.sm" color="fg.muted" fontStyle="italic">
                    "{m.q}"
                  </Text>
                </Box>
              </Link>
            ))}
          </Box>
        </Stack>

        <Stack gap={2} pt={2}>
          <Text textStyle="eyebrow" color="fg.subtle">
            Iteration loop
          </Text>
          <Text textStyle="body.sm" color="fg" maxW="720px">
            Every spec section has a feedback anchor. Drop a comment / reject / change / question / add — it's
            persisted to <Text as="code" textStyle="mono.sm" bg="bg.muted" px={1.5} py={0.5} borderRadius="sm">data/feedback.db</Text>.
            Claude reads open feedback at the start of each iteration, makes the change, and marks the
            feedback row actioned with a resolution note.
          </Text>
        </Stack>
      </Stack>
    </Container>
  )
}

function ModeStateChip({ state }: { state: 'built' | 'placeholder' }) {
  const tone =
    state === 'built'
      ? { bg: 'brand.50', color: 'brand.700', border: 'brand.100', label: 'anchor · built' }
      : { bg: 'bg.muted', color: 'fg.muted', border: 'border.subtle', label: 'placeholder' }
  return (
    <Text
      textStyle="caption"
      fontFamily="mono"
      fontWeight="semibold"
      textTransform="uppercase"
      letterSpacing="wider"
      px={2}
      py={1}
      borderRadius="full"
      borderWidth="1px"
      bg={tone.bg}
      color={tone.color}
      borderColor={tone.border}
    >
      {tone.label}
    </Text>
  )
}
