import { stripVTControlCharacters } from 'node:util'

// Cc covers C0/C1 (including ESC), Cf covers bidi and zero-width formatting,
// Cs covers lone surrogates, and Zl/Zp cover Unicode line separators.
const NON_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu

function visibleCodePoint(character: string): string {
  if (character === '\n') return '\\n'
  if (character === '\r') return '\\r'
  if (character === '\t') return '\\t'

  const codePoint = character.codePointAt(0)!
  if (codePoint <= 0xff) return `\\x${codePoint.toString(16).toUpperCase().padStart(2, '0')}`
  if (codePoint <= 0xffff) return `\\u${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
  return `\\u{${codePoint.toString(16).toUpperCase()}}`
}

/** Neutralizes untrusted text before it is written to a terminal or control-aware log. */
export function escapeTerminalText(value: string): string {
  return stripVTControlCharacters(value).replace(NON_PRINTABLE, visibleCodePoint)
}
