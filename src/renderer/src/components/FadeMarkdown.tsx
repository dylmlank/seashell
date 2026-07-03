import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { visit, SKIP } from 'unist-util-visit'

interface HastText {
  type: 'text'
  value: string
}
interface HastElement {
  type: 'element'
  tagName: string
  properties?: Record<string, unknown>
  children: HastNode[]
}
type HastNode = HastText | HastElement | { type: string; children?: HastNode[] }

const STAGGER_MS = 24
const MAX_DELAY_MS = 1200

/** Rehype plugin: wrap every word in a span with an incrementing fade delay,
 *  so revealed text melts in word by word instead of popping. Code blocks are
 *  left intact (they fade as one unit via CSS). */
function rehypeFadeWords() {
  return (tree: HastNode): void => {
    let i = 0
    visit(
      tree as never,
      'text',
      (node: HastText, index: number | undefined, parent: HastElement | undefined) => {
        if (!parent || index === undefined) return undefined
        if (parent.tagName === 'code' || parent.tagName === 'pre') return SKIP
        const parts = node.value.split(/(\s+)/).filter((p) => p !== '')
        if (parts.length === 0) return undefined
        const replacement: HastNode[] = parts.map((part) => {
          if (/^\s+$/.test(part)) return { type: 'text', value: part } as HastText
          const delay = Math.min(i++ * STAGGER_MS, MAX_DELAY_MS)
          return {
            type: 'element',
            tagName: 'span',
            properties: { className: ['w'], style: `--d:${delay}ms` },
            children: [{ type: 'text', value: part }]
          } as HastElement
        })
        parent.children.splice(index, 1, ...replacement)
        // Skip over the nodes we just inserted.
        return index + replacement.length
      }
    )
  }
}

/** Markdown that fades in word by word — used for the newest revealed block. */
export const FadeMarkdown = memo(function FadeMarkdown({
  text
}: {
  text: string
}): React.JSX.Element {
  return (
    <div className="md fade-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, rehypeFadeWords]}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
