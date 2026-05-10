import { Box, Container, Heading, HStack, Stack, Text } from '@chakra-ui/react'
import { Block, PatternSection } from './PatternSpec'

export interface PlannedPattern {
  /** Anchor like "2.1.1" */
  anchor: string
  /** Display name, e.g. "Decision.Queue" */
  name: string
  /** Family the pattern belongs to, if any */
  family?: string
  /** One-line purpose */
  purpose: string
  /** True if this is the mode's anchor pattern */
  isAnchor?: boolean
  /** Tags */
  isRecipe?: boolean
}

interface PlaceholderModeProps {
  modeId: string
  modeNumber: string  // e.g. "2.1"
  modeName: string    // e.g. "Observe"
  question: string
  intro: React.ReactNode
  anchorPatternName: string
  patterns: PlannedPattern[]
}

/**
 * PlaceholderMode — shell for a not-yet-built mode page. Lists the planned
 * patterns with their purpose, and exposes a feedback anchor on each so the
 * user can prioritise (e.g. "build Reference.Similar next").
 */
export function PlaceholderMode({
  modeId,
  modeNumber,
  modeName,
  question,
  intro,
  anchorPatternName,
  patterns,
}: PlaceholderModeProps) {
  return (
    <Container maxW="1200px" py={10}>
      {/* Mode header */}
      <Stack gap={4} mb={10} pb={6} borderBottomWidth="1px" borderBottomColor="border.subtle">
        <Text
          fontSize="xs"
          fontWeight="semibold"
          letterSpacing="0.12em"
          textTransform="uppercase"
          color="brand.600"
        >
          East UI · Decision-Quality Patterns · §{modeNumber}
        </Text>
        <Heading as="h1" size="3xl" letterSpacing="-0.015em" fontFamily="heading">
          {modeName}
        </Heading>
        <Box pl={4} borderLeftWidth="3px" borderLeftColor="brand.500">
          <Text
            fontFamily="heading"
            fontSize="xl"
            fontWeight="medium"
            fontStyle="italic"
            color="brand.700"
          >
            “{question}”
          </Text>
        </Box>
        <HStack
          gap={2}
          pt={2}
          fontSize="xs"
          color="orange.700"
          bg="orange.50"
          px={3}
          py={2}
          borderRadius="sm"
          borderWidth="1px"
          borderColor="orange.200"
          alignSelf="flex-start"
        >
          <Text fontFamily="mono" fontWeight="semibold" textTransform="uppercase" letterSpacing="0.05em">
            placeholder
          </Text>
          <Text>
            Anchor pattern: <Text as="strong">{anchorPatternName}</Text>. Drop feedback on
            individual patterns below to ask me to build them next.
          </Text>
        </HStack>
      </Stack>

      {/* Mode-level intro */}
      <PatternSection label="What this mode is for">
        <Block locationId={`${modeId}.intro`} modeId={modeId}>
          <Box maxW="780px" fontSize="md" lineHeight="relaxed" color="fg">
            {intro}
          </Box>
        </Block>
      </PatternSection>

      {/* Planned patterns list */}
      <Stack gap={6} mt={10}>
        <Text
          fontSize="11px"
          fontWeight="semibold"
          letterSpacing="0.08em"
          textTransform="uppercase"
          color="fg.subtle"
        >
          Planned patterns ({patterns.length})
        </Text>

        <Stack gap={5}>
          {patterns.map(p => (
            <Box
              key={p.name}
              id={`${modeId}.${p.name.toLowerCase().replace(/\./g, '-')}`}
              borderWidth="1px"
              borderColor={p.isAnchor ? 'brand.500' : 'border.subtle'}
              borderRadius="md"
              bg={p.isAnchor ? 'brand.50' : 'bg.surface'}
              p={5}
            >
              <Stack gap={3}>
                <HStack align="baseline" gap={3} flexWrap="wrap">
                  <Text
                    fontFamily="body"
                    fontWeight="normal"
                    color="fg.subtle"
                    fontSize="sm"
                  >
                    {p.anchor}
                  </Text>
                  <Heading
                    as="h3"
                    fontSize="lg"
                    fontWeight="semibold"
                    fontFamily="heading"
                    letterSpacing="-0.005em"
                    color={p.isAnchor ? 'brand.700' : 'fg'}
                  >
                    {p.name}
                  </Heading>
                  <HStack gap={1} ml="auto">
                    {p.isAnchor && (
                      <Text
                        fontFamily="mono"
                        fontSize="10px"
                        fontWeight="semibold"
                        textTransform="uppercase"
                        letterSpacing="0.05em"
                        px={2}
                        py="2px"
                        borderRadius="full"
                        borderWidth="1px"
                        bg="brand.100"
                        color="brand.700"
                        borderColor="brand.200"
                      >
                        anchor
                      </Text>
                    )}
                    {p.family && (
                      <Text
                        fontFamily="mono"
                        fontSize="10px"
                        fontWeight="semibold"
                        textTransform="uppercase"
                        letterSpacing="0.05em"
                        px={2}
                        py="2px"
                        borderRadius="full"
                        borderWidth="1px"
                        bg="blue.50"
                        color="blue.700"
                        borderColor="blue.100"
                      >
                        {p.family}
                      </Text>
                    )}
                    {p.isRecipe && (
                      <Text
                        fontFamily="mono"
                        fontSize="10px"
                        fontWeight="semibold"
                        textTransform="uppercase"
                        letterSpacing="0.05em"
                        px={2}
                        py="2px"
                        borderRadius="full"
                        borderWidth="1px"
                        bg="orange.50"
                        color="orange.700"
                        borderColor="orange.100"
                      >
                        recipe
                      </Text>
                    )}
                  </HStack>
                </HStack>
                <Text fontSize="sm" color="fg.muted" lineHeight="relaxed">
                  {p.purpose}
                </Text>
                <Block
                  locationId={`${modeId}.${slugify(p.name)}.placeholder`}
                  patternId={`${modeId}.${slugify(p.name)}`}
                  modeId={modeId}
                >
                  <Text fontSize="11px" color="fg.subtle" fontFamily="mono">
                    Drop feedback to prioritise / shape this pattern. e.g. "build this
                    next", "this should slot a sparkline not a bar", "merge with X".
                  </Text>
                </Block>
              </Stack>
            </Box>
          ))}
        </Stack>
      </Stack>

      {/* Mode-level catch-all */}
      <Box mt={16} pt={6} borderTopWidth="1px" borderTopStyle="dashed" borderTopColor="border.subtle">
        <Text
          fontSize="10px"
          textTransform="uppercase"
          letterSpacing="0.08em"
          color="fg.subtle"
          fontWeight="semibold"
          mb={2}
        >
          Catch-all feedback for this mode
        </Text>
        <Block locationId={`${modeId}.global`} modeId={modeId}>
          <Text fontSize="xs" color="fg.muted">
            Anything that doesn't fit a single pattern — taxonomy, ordering, missing patterns, etc.
          </Text>
        </Block>
      </Box>
    </Container>
  )
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]/g, '-')
}
