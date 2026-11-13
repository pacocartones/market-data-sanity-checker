import { describe, expect, it } from 'vitest'
import { escapeTerminalText } from '../src/report/terminal'

describe('escapeTerminalText', () => {
  it('strips CSI and OSC commands while preserving ordinary visible text', () => {
    const text = [
      'before',
      '\u001b[2J',
      '\u001b[31mred\u001b[0m',
      '\u001b]8;;https://evil.example\u0007link\u001b]8;;\u0007',
      '\u001b]52;c;Y2xpcGJvYXJk\u0007',
      'after',
    ].join('')

    expect(escapeTerminalText(text)).toBe('beforeredlinkafter')
  })

  it('visibly encodes remaining controls, bidi marks, and non-printable separators', () => {
    expect(escapeTerminalText('\u0000\t\r\n\u007f\u0085\u200b\u202e\u2066\u2028')).toBe(
      '\\x00\\t\\r\\n\\x7F\\x85\\u200B\\u202E\\u2066\\u2028',
    )
  })

  it('preserves printable Unicode and neutralizes an unterminated escape introducer', () => {
    expect(escapeTerminalText('München 東京 📈')).toBe('München 東京 📈')
    expect(escapeTerminalText('before\u001b]52;c;unterminated')).not.toContain('\u001b')
  })
})
