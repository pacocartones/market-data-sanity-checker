import { constants, type BigIntStats } from 'node:fs'
import { lstat, mkdir, open, type FileHandle } from 'node:fs/promises'
import { dirname, join, parse, relative, resolve, sep } from 'node:path'

const NO_FOLLOW = constants.O_NOFOLLOW ?? 0

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === code
  )
}

async function lstatIfExists(path: string): Promise<BigIntStats | undefined> {
  try {
    return await lstat(path, { bigint: true })
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined
    throw error
  }
}

function rejectLink(path: string): never {
  throw new Error(
    `refusing to write '${path}': symbolic links and directory junctions are not supported for output paths`,
  )
}

async function ensureSafeParentDirectories(filePath: string, create: boolean): Promise<void> {
  const parent = dirname(filePath)
  const { root } = parse(parent)
  const components = relative(root, parent).split(sep).filter(Boolean)
  let current = root

  for (const component of components) {
    current = join(current, component)
    let stats = await lstatIfExists(current)
    if (!stats && create) {
      try {
        await mkdir(current)
      } catch (error) {
        // Another process may have created this component; inspect what now occupies it.
        if (!hasCode(error, 'EEXIST')) throw error
      }
      stats = await lstatIfExists(current)
    }
    if (!stats) {
      throw new Error(`cannot write '${filePath}': parent directory '${current}' does not exist`)
    }
    if (stats.isSymbolicLink()) rejectLink(current)
    if (!stats.isDirectory()) {
      throw new Error(`cannot write '${filePath}': parent path '${current}' is not a directory`)
    }
  }
}

async function ensureSafeExistingTarget(filePath: string): Promise<void> {
  const stats = await lstatIfExists(filePath)
  if (!stats) return
  if (stats.isSymbolicLink()) rejectLink(filePath)
  if (!stats.isFile()) {
    throw new Error(`refusing to write '${filePath}': output target is not a regular file`)
  }
}

async function ensureOpenedTargetIsCurrent(filePath: string, handle: FileHandle): Promise<void> {
  // Recheck after open so a final-component replacement is caught before any mutation.
  await ensureSafeParentDirectories(filePath, false)
  const [pathStats, handleStats] = await Promise.all([
    lstatIfExists(filePath),
    handle.stat({ bigint: true }),
  ])

  if (!pathStats) {
    throw new Error(`refusing to write '${filePath}': output target changed while it was opened`)
  }
  if (pathStats.isSymbolicLink()) rejectLink(filePath)
  if (!pathStats.isFile() || !handleStats.isFile()) {
    throw new Error(`refusing to write '${filePath}': output target is not a regular file`)
  }
  if (pathStats.dev !== handleStats.dev || pathStats.ino !== handleStats.ino) {
    throw new Error(`refusing to write '${filePath}': output target changed while it was opened`)
  }
}

async function openSecureOutput(
  filePath: string,
  flags: number,
  createParentDirectories: boolean,
): Promise<FileHandle> {
  const absolutePath = resolve(filePath)
  await ensureSafeParentDirectories(absolutePath, createParentDirectories)
  await ensureSafeExistingTarget(absolutePath)

  const handle = await open(absolutePath, flags | NO_FOLLOW, 0o666)
  try {
    await ensureOpenedTargetIsCurrent(absolutePath, handle)
    return handle
  } catch (error) {
    await handle.close()
    throw error
  }
}

/** Writes a UTF-8 file without following links in the target or any parent directory. */
export async function writeFileSecurely(filePath: string, content: string): Promise<void> {
  const handle = await openSecureOutput(
    filePath,
    constants.O_WRONLY | constants.O_CREAT,
    false,
  )
  try {
    // Delay truncation until the opened handle has been matched to the directory entry.
    await handle.truncate(0)
    await handle.writeFile(content, 'utf8')
  } finally {
    await handle.close()
  }
}

/** Appends UTF-8 content, creating safe parent directories and the final file as needed. */
export async function appendFileSecurely(filePath: string, content: string): Promise<void> {
  const handle = await openSecureOutput(
    filePath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND,
    true,
  )
  try {
    await handle.appendFile(content, 'utf8')
  } finally {
    await handle.close()
  }
}
