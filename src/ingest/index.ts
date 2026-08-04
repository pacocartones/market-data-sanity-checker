import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { IngestError, parseOhlcvCsv, type IngestOptions } from './csv'
import { parseMarketDataJson } from './json'

export { IngestError, parseOhlcvCsv, parseMarketDataJson }
export type { IngestOptions }

/** Reads a .csv or .json file and normalizes it to the canonical (unvalidated) dataset shape. */
export async function ingestFile(path: string, options: IngestOptions = {}): Promise<unknown> {
  const text = await readFile(path, 'utf8')
  const extension = extname(path).toLowerCase()

  switch (extension) {
    case '.csv':
      return parseOhlcvCsv(text, options)
    case '.json':
      return parseMarketDataJson(text, options)
    default:
      throw new IngestError(`Unsupported file extension "${extension}". Use .csv or .json`)
  }
}
