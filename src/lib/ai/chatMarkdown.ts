export interface ChatMarkdownSegment {
  strong: boolean
  text: string
}

export interface ChatMarkdownBlock {
  kind: 'blank' | 'heading' | 'ordered-list-item' | 'paragraph' | 'unordered-list-item'
  marker?: string
  segments: ChatMarkdownSegment[]
}

export function parseInlineMarkdown(value: string): ChatMarkdownSegment[] {
  const segments: ChatMarkdownSegment[] = []
  const pattern = /\*\*([^*\n]+?)\*\*/g
  let lastIndex = 0
  let match = pattern.exec(value)

  while (match) {
    if (match.index > lastIndex) {
      segments.push({ strong: false, text: value.slice(lastIndex, match.index) })
    }
    segments.push({ strong: true, text: match[1] })
    lastIndex = match.index + match[0].length
    match = pattern.exec(value)
  }

  if (lastIndex < value.length) {
    segments.push({ strong: false, text: value.slice(lastIndex) })
  }

  return segments.length > 0 ? segments : [{ strong: false, text: value }]
}

export function parseChatMarkdown(value: string): ChatMarkdownBlock[] {
  return value.split(/\r?\n/).map((line) => {
    const trimmed = line.trim()
    if (!trimmed) return { kind: 'blank', segments: [] }

    const heading = trimmed.match(/^#{1,3}\s+(.+)$/)
    if (heading?.[1]) {
      return { kind: 'heading', segments: parseInlineMarkdown(heading[1]) }
    }

    const ordered = trimmed.match(/^(\d+[.)])\s+(.+)$/)
    if (ordered?.[1] && ordered[2]) {
      return {
        kind: 'ordered-list-item',
        marker: ordered[1],
        segments: parseInlineMarkdown(ordered[2]),
      }
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/)
    if (unordered?.[1]) {
      return {
        kind: 'unordered-list-item',
        marker: '•',
        segments: parseInlineMarkdown(unordered[1]),
      }
    }

    return { kind: 'paragraph', segments: parseInlineMarkdown(trimmed) }
  })
}
