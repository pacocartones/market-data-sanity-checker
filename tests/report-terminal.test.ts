import { describe, expect, it } from 'vitest'
import { escapeTerminalText, formatTerminalError } from '../src/report/terminal'

describe('escapeTerminalText', () => {
  it('strips CSI and OSC commands while preserving ordinary visible text', () => {
    const text = [
      'before',
      '\u001b[2J',
      '\u001b[31mred\u001b[0m',
      '\u001b]8;;https://evil.example\u0007link\u001b]8;;\u0007',
      '\u001b]52;c;Y2xpcGJvYXJk\u0007',
      '\u001b]52;c;c3Q=\u001b\\',
      'after',
    ].join('')

    expect(escapeTerminalText(text)).toBe('beforeredlinkafter')
  })

  it('visibly encodes remaining controls, lone surrogates, and line separators', () => {
    expect(escapeTerminalText('\u0000\t\r\n\u007f\u0085\ud800\u2028\u2029')).toBe(
      '\\x00\\t\\r\\n\\x7F\\x85\\uD800\\u2028\\u2029',
    )
  })

  it('visibly encodes Unicode bidi controls', () => {
    expect(escapeTerminalText('\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069')).toBe(
      '\\u061C\\u200E\\u200F\\u202A\\u202B\\u202C\\u202D\\u202E\\u2066\\u2067\\u2068\\u2069',
    )
  })

  it('preserves legitimate Unicode format characters and joined emoji', () => {
    const text = 'München 東京 A\u200bB\u200cC\u200dD\u2060E 👩‍💻'
    expect(escapeTerminalText(text)).toBe(text)
  })

  it('neutralizes an unterminated escape introducer', () => {
    expect(escapeTerminalText('before\u001b]52;c;unterminated')).not.toContain('\u001b')
  })
})

describe('formatTerminalError', () => {
  it.each([
    [new Error('bad\n\u202e'), 'bad\\n\\u202E'],
    ['failed\r\u2066', 'failed\\r\\u2066'],
  ])('formats Error and non-Error values as terminal-safe fragments', (error, expected) => {
    expect(formatTerminalError(error)).toBe(expected)
  })
})
