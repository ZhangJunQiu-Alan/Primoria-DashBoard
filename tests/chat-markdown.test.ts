import { describe, expect, it } from 'vitest'
import { parseChatMarkdown, parseInlineMarkdown } from '@/lib/ai/chatMarkdown'

describe('chat markdown parsing', () => {
  it('parses double-star bold segments without exposing markdown markers', () => {
    expect(parseInlineMarkdown('1. **习惯养成**：阅读')).toEqual([
      { strong: false, text: '1. ' },
      { strong: true, text: '习惯养成' },
      { strong: false, text: '：阅读' },
    ])
  })

  it('parses headings, ordered lists, bullets, paragraphs, and blank lines', () => {
    expect(parseChatMarkdown('# 今日反思\n\n1. **任务**：完成\n- 建议\n普通段落')).toEqual([
      { kind: 'heading', segments: [{ strong: false, text: '今日反思' }] },
      { kind: 'blank', segments: [] },
      {
        kind: 'ordered-list-item',
        marker: '1.',
        segments: [
          { strong: true, text: '任务' },
          { strong: false, text: '：完成' },
        ],
      },
      {
        kind: 'unordered-list-item',
        marker: '•',
        segments: [{ strong: false, text: '建议' }],
      },
      {
        kind: 'paragraph',
        segments: [{ strong: false, text: '普通段落' }],
      },
    ])
  })
})
