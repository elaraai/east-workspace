import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Box, Code, Link, Text } from '@chakra-ui/react'

/**
 * MarkdownInline — render GitHub-flavored markdown for a single-line context.
 *
 * Strips block-level wrapping (no <p>, no <ul>) so the output composes inside
 * a parent <Text> or <span>. Supports inline elements: **bold**, *italic*,
 * `code`, [link](url), ~~strike~~.
 *
 * Use for: claim, because.reason, upside, risks, unknowns — anywhere we want
 * one line of formatted text.
 */
export function MarkdownInline({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      // Drop everything block-level; render only inline content.
      disallowedElements={['p', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr', 'pre', 'table']}
      unwrapDisallowed
      components={{
        strong: ({ children }) => <Text as="strong" fontWeight="semibold">{children}</Text>,
        em:     ({ children }) => <Text as="em" fontStyle="italic">{children}</Text>,
        del:    ({ children }) => <Text as="del" textDecoration="line-through" opacity={0.7}>{children}</Text>,
        a: ({ href, children }) => (
          <Link href={href ?? '#'} color="brand.600" textDecoration="underline" textUnderlineOffset="2px">
            {children as ReactNode}
          </Link>
        ),
        code: ({ children }) => (
          <Code fontFamily="mono" fontSize="0.92em" px="4px" py="1px" bg="bg.muted" borderRadius="sm">
            {children}
          </Code>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  )
}

/**
 * MarkdownBlock — render full GFM markdown including paragraphs, lists,
 * code blocks, tables. Use for: long-form prose, multi-paragraph content.
 *
 * Default styling targets the spec doc body (Inter Tight, line-height
 * relaxed). Override with surrounding <Box>'s typography props.
 */
export function MarkdownBlock({ children }: { children: string }) {
  return (
    <Box
      css={{
        '& > * + *': { marginTop: 'var(--chakra-spacing-3)' },
        '& strong':  { fontWeight: 600 },
        '& em':      { fontStyle: 'italic' },
        '& a':       { color: 'var(--chakra-colors-brand-600)', textDecoration: 'underline', textUnderlineOffset: '2px' },
        '& code':    { fontFamily: 'var(--chakra-fonts-mono)', fontSize: '0.92em', background: 'var(--chakra-colors-bg-muted)', padding: '1px 4px', borderRadius: 'var(--chakra-radii-sm)' },
        '& ul, & ol':{ paddingLeft: 'var(--chakra-spacing-5)' },
        '& li + li': { marginTop: 'var(--chakra-spacing-1)' },
        '& pre':     { background: 'var(--chakra-colors-bg-muted)', padding: 'var(--chakra-spacing-3)', borderRadius: 'var(--chakra-radii-md)', overflowX: 'auto', fontFamily: 'var(--chakra-fonts-mono)', fontSize: '14px' },
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </Box>
  )
}
