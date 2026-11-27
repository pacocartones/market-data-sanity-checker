import { afterEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_API_KEY = process.env.ALPHA_VANTAGE_API_KEY

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (ORIGINAL_API_KEY === undefined) delete process.env.ALPHA_VANTAGE_API_KEY
  else process.env.ALPHA_VANTAGE_API_KEY = ORIGINAL_API_KEY
})

describe('scoreboard provider failures', () => {
  it('logs only the categorized Alpha Vantage parser failure', async () => {
    const apiKey = 'response-secret-key'
    process.env.ALPHA_VANTAGE_API_KEY = apiKey
    const stdout: string[] = []
    const stderr: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => stdout.push(args.map(String).join(' ')))
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => stderr.push(args.map(String).join(' ')))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes('alphavantage.co')) return new Response(`${apiKey}\n{`)
        throw new Error('synthetic yahoo outage')
      }),
    )
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      ((callback: (...args: unknown[]) => void) => {
        callback()
        return undefined as unknown as NodeJS.Timeout
      }) as typeof setTimeout,
    )
    vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`scoreboard exit ${String(code)}`)
    }) as typeof process.exit)

    await expect(import('../scripts/scoreboard')).rejects.toThrow('scoreboard exit 1')

    expect(stdout.find((line) => line.startsWith('alpha-vantage/AAPL:'))).toBe(
      'alpha-vantage/AAPL: FETCH FAILED (Alpha Vantage request failed for AAPL)',
    )
    expect([...stdout, ...stderr].join('\n')).not.toContain(apiKey)
  })
})
