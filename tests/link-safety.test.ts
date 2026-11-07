import { describe, expect, it } from 'vitest'
import { safeLinkHref } from '../src/features/editor/linkSafety'

describe('link destination safety', () => {
  it('accepts ordinary web, mail, anchor and relative links', () => {
    for (const href of ['https://example.com/a', 'mailto:a@example.com', '#section', './note.md']) expect(safeLinkHref(href)).toBe(href)
  })
  it('rejects active and control character URLs', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,a', '//evil.example/x', 'https://x\nalert']) expect(safeLinkHref(href)).toBeNull()
  })
})
