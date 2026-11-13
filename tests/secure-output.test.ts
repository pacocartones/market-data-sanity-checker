import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileSecurely } from '../src/filesystem/secure-output'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mdsc-secure-output-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('writeFileSecurely', () => {
  it('creates and overwrites regular output files', async () => {
    const report = join(dir, 'report.html')
    await writeFileSecurely(report, 'first report')
    await writeFileSecurely(report, 'replacement')
    expect(await readFile(report, 'utf8')).toBe('replacement')
  })

  it('refuses an output symlink without truncating its target', async () => {
    const reports = join(dir, 'reports')
    const target = join(dir, 'outside.html')
    const report = join(reports, 'report.html')
    await mkdir(reports)
    await writeFile(target, 'unchanged', 'utf8')
    await symlink(target, report, 'file')

    await expect(writeFileSecurely(report, 'replacement')).rejects.toThrow('symbolic links')
    expect(await readFile(target, 'utf8')).toBe('unchanged')
  })

  it('refuses a symlinked parent without creating an external report', async () => {
    const outside = join(dir, 'outside')
    const linkedParent = join(dir, 'linked-reports')
    await mkdir(outside)
    await symlink(outside, linkedParent, 'dir')

    await expect(writeFileSecurely(join(linkedParent, 'report.html'), 'report')).rejects.toThrow(
      'symbolic links',
    )
    await expect(access(join(outside, 'report.html'))).rejects.toThrow()
  })
})
