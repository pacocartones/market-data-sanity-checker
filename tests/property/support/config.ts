import fc from 'fast-check'

/**
 * Run configuration shared by every property test.
 *
 * - `FC_NUM_RUNS`: cases per property. Default 100 when `CI` is set, 25 locally.
 * - `FC_SEED`: integer seed, or `random` to draw a fresh one. The default is a
 *   FIXED seed, so `pnpm test` is reproducible and a red CI run can always be
 *   replayed locally. Use `FC_SEED=random` to explore new inputs.
 * - `FC_PATH`: the `path` that fast-check prints for a failing case; with the
 *   same `FC_SEED` it re-runs only that case (and its shrinking).
 *
 * On failure `check()` appends the exact replay command to the error message.
 */

const DEFAULT_SEED = 20261015

function readRuns(): number {
  const raw = process.env.FC_NUM_RUNS
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
    throw new Error(`FC_NUM_RUNS must be a positive integer, got "${raw}"`)
  }
  return process.env.CI ? 100 : 25
}

function readSeed(): number {
  const raw = process.env.FC_SEED
  if (raw === undefined || raw === '') return DEFAULT_SEED
  if (raw === 'random') return Math.floor(Math.random() * 2 ** 31)
  const parsed = Number(raw)
  if (Number.isInteger(parsed)) return parsed
  throw new Error(`FC_SEED must be an integer or "random", got "${raw}"`)
}

export const NUM_RUNS = readRuns()
export const SEED = readSeed()
const PATH = process.env.FC_PATH

/** `fc.assert` with the project's runs/seed, and a replay hint on failure. */
export function check<T>(property: fc.IPropertyWithHooks<T>, runs = NUM_RUNS): void {
  const parameters: fc.Parameters<T> = {
    numRuns: runs,
    seed: SEED,
    ...(PATH ? { path: PATH } : {}),
  }
  try {
    fc.assert(property, parameters)
  } catch (error) {
    if (error instanceof Error) {
      error.message +=
        `\nReplay: FC_SEED=${SEED} FC_NUM_RUNS=${runs} pnpm test:property ` +
        '(add FC_PATH=<path printed above> to re-run only the failing case)'
    }
    throw error
  }
}
