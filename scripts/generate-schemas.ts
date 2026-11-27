/**
 * Writes the published JSON Schemas of the check and compare reports to
 * schemas/ from the zod schemas in src/report/schema.ts.
 *
 *   pnpm schemas
 *
 * tests/report-schema.test.ts fails when the committed files differ from
 * this output, so run it after changing the zod schemas.
 */
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { REPORT_SCHEMA_NAMES, reportJsonSchema, reportSchemaFile } from '../src/report/schema'

const dir = fileURLToPath(new URL('../schemas/', import.meta.url))

for (const name of REPORT_SCHEMA_NAMES) {
  const path = `${dir}${reportSchemaFile(name)}`
  await writeFile(path, `${JSON.stringify(reportJsonSchema(name), null, 2)}\n`, 'utf8')
  console.log(`wrote schemas/${reportSchemaFile(name)}`)
}
