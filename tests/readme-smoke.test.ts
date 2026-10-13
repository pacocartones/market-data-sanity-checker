import { describe, expect, it } from 'vitest'
import { readmeCommands } from '../scripts/readme-smoke'

describe('readmeCommands', () => {
  it('takes mdsc and npx lines from shell blocks only, without trailing comments', () => {
    const markdown = [
      'Run `mdsc rules` inline (not a block).',
      '```bash',
      'mdsc rules   # list the catalog',
      'npx market-data-sanity-checker check --file x.csv',
      'pnpm install',
      '```',
      '```ts',
      'mdsc check --file not-shell.csv',
      '```',
    ].join('\n')
    expect(readmeCommands(markdown)).toEqual(['mdsc rules', 'npx market-data-sanity-checker check --file x.csv'])
  })
})
