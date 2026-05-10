import type { ReactNode } from 'react'
import { Box, Heading, HStack, Stack, Text } from '@chakra-ui/react'
import { FeedbackAnchor } from './Feedback'

type TagKind = 'anchor' | 'family' | 'recipe' | 'new'

interface PatternSpecProps {
  modeId: string
  patternId: string
  anchor: string
  name: string
  question: string
  tags?: { kind: TagKind; label: string }[]
  children: ReactNode
}

/**
 * PatternSpec — top-level wrapper for one pattern's full spec page.
 * Renders the heading, tags, question, and a final pattern-level feedback dock.
 */
export function PatternSpec({
  modeId,
  patternId,
  anchor,
  name,
  question,
  tags,
  children,
}: PatternSpecProps) {
  return (
    <Box
      id={patternId}
      mb={10}
      pt={6}
      borderTopWidth="1px"
      borderTopColor="border.subtle"
      _first={{ pt: 0, borderTopWidth: 0 }}
    >
      <Stack gap={2} mb={6}>
        <HStack align="baseline" gap={3} flexWrap="wrap">
          <Heading as="h2" textStyle="display.sm">
            <Text as="span" textStyle="body.md" color="fg.subtle" fontWeight="normal" mr={3}>
              {anchor}
            </Text>
            {name}
          </Heading>
          {tags && (
            <HStack gap={1} ml="auto">
              {tags.map((tag, i) => (
                <SpecTag key={i} kind={tag.kind}>{tag.label}</SpecTag>
              ))}
            </HStack>
          )}
        </HStack>
        <Text textStyle="body.md" fontStyle="italic" color="fg.muted">
          “{question}”
        </Text>
      </Stack>

      {children}

      <Box mt={6} pt={3} borderTopWidth="1px" borderTopStyle="dashed" borderTopColor="border.subtle">
        <Text textStyle="eyebrow" color="fg.subtle" mb={2}>
          Catch-all feedback for this pattern
        </Text>
        <FeedbackAnchor locationId={`${patternId}.global`} patternId={patternId} modeId={modeId} />
      </Box>
    </Box>
  )
}

/**
 * PatternSection — visual grouping with a label heading. Pure container; no
 * feedback anchor of its own (use <Block> children for per-chunk feedback).
 */
interface PatternSectionProps {
  label: string
  children: ReactNode
}
export function PatternSection({ label, children }: PatternSectionProps) {
  return (
    <Stack gap={3} mb={8}>
      <Text textStyle="eyebrow" color="fg.subtle">
        {label}
      </Text>
      {children}
    </Stack>
  )
}

/**
 * Block — wraps any content chunk (paragraph, mock, table, list) and adds
 * its own feedback anchor below. The unit of feedback granularity.
 *
 * Rule of thumb: one Block per visually-distinct chunk you'd want to react
 * to independently — paragraph, mock, slot table, behaviour list.
 */
interface BlockProps {
  locationId: string
  patternId?: string
  modeId?: string
  children: ReactNode
}
export function Block({ locationId, patternId, modeId, children }: BlockProps) {
  return (
    <Stack gap={2}>
      {children}
      <FeedbackAnchor locationId={locationId} patternId={patternId} modeId={modeId} />
    </Stack>
  )
}

// Tag chrome stays neutral — accent hues are reserved for charts (UX/UI Guide §2).
// Anchor pattern stands out via the brand tint; everything else is gray.
const tagStyles: Record<TagKind, { bg: string; color: string; border: string }> = {
  anchor: { bg: 'brand.50',   color: 'brand.700', border: 'brand.100' },
  family: { bg: 'bg.muted',   color: 'fg.muted',  border: 'border.subtle' },
  recipe: { bg: 'bg.muted',   color: 'fg.muted',  border: 'border.subtle' },
  new:    { bg: 'bg.muted',   color: 'fg.muted',  border: 'border.subtle' },
}

function SpecTag({ kind, children }: { kind: TagKind; children: ReactNode }) {
  const s = tagStyles[kind]
  return (
    <Text
      textStyle="caption"
      fontFamily="mono"
      fontWeight="semibold"
      textTransform="uppercase"
      letterSpacing="wider"
      px={2}
      py="2px"
      borderRadius="full"
      borderWidth="1px"
      bg={s.bg}
      color={s.color}
      borderColor={s.border}
    >
      {children}
    </Text>
  )
}

/**
 * MockFrame — neutral inset region for showing a pattern at actual size.
 */
export function MockFrame({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return (
    <Box
      position="relative"
      bg={dark ? 'bg.inverse' : 'bg.canvas'}
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="lg"
      px={6}
      py={12}
      display="flex"
      alignItems="center"
      justifyContent="center"
    >
      <Text
        position="absolute"
        top="8px"
        left="12px"
        textStyle="caption"
        fontFamily="mono"
        color={dark ? 'gray.400' : 'fg.subtle'}
        textTransform="uppercase"
        letterSpacing="wider"
      >
        mock — actual size
      </Text>
      {children}
    </Box>
  )
}

export function Prose({ children }: { children: ReactNode }) {
  return (
    <Box maxW="720px" textStyle="body.md" color="fg">
      {children}
    </Box>
  )
}

export interface Slot {
  name: string
  type: string
  required: boolean | 'conditional'
  description: ReactNode
}

export function SlotTable({ slots }: { slots: Slot[] }) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="md"
      overflow="hidden"
      bg="bg.surface"
    >
      <Box
        as="table"
        width="100%"
        borderCollapse="separate"
        css={{ borderSpacing: 0 }}
        textStyle="body.sm"
      >
        <Box as="thead">
          <Box as="tr">
            {['Slot', 'Type', 'Required', 'Description'].map((h) => (
              <Box
                as="th"
                key={h}
                textAlign="left"
                bg="bg.muted"
                textStyle="caption"
                color="fg.subtle"
                fontWeight="semibold"
                textTransform="uppercase"
                letterSpacing="wider"
                px={3} py={2}
                borderBottomWidth="1px"
                borderBottomColor="border.subtle"
                whiteSpace="nowrap"
              >
                {h}
              </Box>
            ))}
          </Box>
        </Box>
        <Box as="tbody">
          {slots.map((slot, i) => (
            <Box as="tr" key={slot.name}>
              <Box as="td" px={3} py={2}
                borderBottomWidth={i === slots.length - 1 ? 0 : '1px'}
                borderBottomColor="border.subtle"
                textStyle="mono.md" fontWeight="semibold" color="brand.700"
                whiteSpace="nowrap" verticalAlign="top">
                {slot.name}
              </Box>
              <Box as="td" px={3} py={2}
                borderBottomWidth={i === slots.length - 1 ? 0 : '1px'}
                borderBottomColor="border.subtle"
                textStyle="mono.sm" color="fg.muted"
                whiteSpace="nowrap" verticalAlign="top">
                {slot.type}
              </Box>
              <Box as="td" px={3} py={2}
                borderBottomWidth={i === slots.length - 1 ? 0 : '1px'}
                borderBottomColor="border.subtle"
                textStyle="caption" color="fg.subtle"
                whiteSpace="nowrap" verticalAlign="top"
                fontWeight={slot.required ? 'semibold' : 'normal'}>
                {slot.required === true ? 'required' : slot.required === 'conditional' ? 'conditional' : 'optional'}
              </Box>
              <Box as="td" px={3} py={2}
                borderBottomWidth={i === slots.length - 1 ? 0 : '1px'}
                borderBottomColor="border.subtle"
                textStyle="body.sm" color="fg.muted" verticalAlign="top">
                {slot.description}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

export function BehaviourList({ items }: { items: ReactNode[] }) {
  return (
    <Stack gap={2}>
      {items.map((item, i) => (
        <Box
          key={i}
          position="relative"
          pl={8} py={2} pr={3}
          bg="bg.muted"
          borderWidth="1px"
          borderColor="border.subtle"
          borderRadius="sm"
          textStyle="body.sm" color="fg"
        >
          <Text as="span"
            position="absolute" left="12px" top="50%" transform="translateY(-50%)"
            color="brand.500" textStyle="caption">
            ▸
          </Text>
          {item}
        </Box>
      ))}
    </Stack>
  )
}

export interface StateDoc {
  name: string
  description: ReactNode
}

export function StateGrid({ states }: { states: StateDoc[] }) {
  return (
    <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap={3}>
      {states.map((s) => (
        <Stack key={s.name} gap={2}
          bg="bg.surface" borderWidth="1px" borderColor="border.subtle"
          borderRadius="md" p={3}>
          <Text textStyle="caption" fontFamily="mono" fontWeight="semibold"
            color="brand.700" textTransform="uppercase" letterSpacing="wider">
            {s.name}
          </Text>
          <Text textStyle="body.sm" color="fg.muted">
            {s.description}
          </Text>
        </Stack>
      ))}
    </Box>
  )
}

export type ArchetypeUse = 'primary' | 'secondary' | 'skip'
export const ARCHETYPES = [
  'Routine', 'Exception', 'Commitment', 'Strategic', 'Reactive', 'People',
] as const

export function ArchetypeChips({ uses }: { uses: Partial<Record<typeof ARCHETYPES[number], ArchetypeUse>> }) {
  return (
    <HStack gap={2} flexWrap="wrap">
      {ARCHETYPES.map((arch) => {
        const use = uses[arch] ?? 'skip'
        const styles =
          use === 'primary'
            ? { bg: 'brand.50', color: 'brand.700', border: 'brand.100', weight: 'semibold' }
            : use === 'secondary'
            ? { bg: 'bg.muted', color: 'fg.muted', border: 'border.subtle', weight: 'normal' }
            : { bg: 'transparent', color: 'gray.400', border: 'border.subtle', weight: 'normal' }
        return (
          <Text key={arch}
            textStyle="caption" fontWeight={styles.weight}
            px={2} py={1} borderRadius="full" borderWidth="1px"
            bg={styles.bg} color={styles.color} borderColor={styles.border}
            textDecoration={use === 'skip' ? 'line-through' : 'none'}>
            {arch}
          </Text>
        )
      })}
    </HStack>
  )
}
