/**
 * Last-green snapshot and restore: copy-tree (v1 default) or git-commit.
 * @module uncle-bob-harness/git
 */

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import type { SnapshotMode } from './config.ts'
import type { Stage } from './fsm.ts'

const SNAPSHOT_ENTRIES = ['src', 'tests', 'package.json', 'architecture.rules.json'] as const
const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'] as const

async function runGit(cwd: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', error => {
      reject(error)
    })
    child.on('close', exitCode => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr })
    })
  })
}

async function listFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) return []
  const info = await stat(root)
  if (!info.isDirectory()) return [root]
  const out: string[] = []
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      out.push(...await listFiles(path))
    } else if (entry.isFile()) {
      out.push(path)
    }
  }
  return out
}

/**
 * SHA-256 of sorted path+content pairs under src/ and tests/.
 * @param cwd - workspace root.
 * @returns hex digest prefixed with sha256:.
 */
export async function worktreeFingerprint(cwd: string): Promise<string> {
  const files = [
    ...await listFiles(join(cwd, 'src')),
    ...await listFiles(join(cwd, 'tests')),
  ].sort()
  const hash = createHash('sha256')
  for (const file of files) {
    const rel = relative(cwd, file).split(sep).join('/')
    hash.update(rel)
    hash.update('\0')
    hash.update(await readFile(file))
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

/**
 * SHA-256 fingerprint of one file's contents, or empty if missing.
 * @param path - absolute path.
 * @returns hex digest or empty string.
 */
export async function fileFingerprint(path: string): Promise<string> {
  try {
    return createHash('sha256').update(await readFile(path)).digest('hex')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

/**
 * Recursively hash a directory tree (missing → empty).
 * @param root - directory.
 * @returns hex digest.
 */
export async function directoryFingerprint(root: string): Promise<string> {
  const files = (await listFiles(root)).sort()
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(relative(root, file).split(sep).join('/'))
    hash.update('\0')
    hash.update(await readFile(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function copyEntry(cwd: string, dest: string, name: string): Promise<void> {
  const from = join(cwd, name)
  if (!existsSync(from)) return
  const to = join(dest, name)
  await mkdir(dirname(to), { recursive: true })
  await cp(from, to, { recursive: true })
}

async function copySnapshotTree(cwd: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true })
  for (const name of SNAPSHOT_ENTRIES) {
    await copyEntry(cwd, dest, name)
  }
  for (const name of LOCKFILES) {
    await copyEntry(cwd, dest, name)
  }
}

async function restoreSnapshotTree(cwd: string, src: string): Promise<void> {
  for (const name of SNAPSHOT_ENTRIES) {
    const from = join(src, name)
    const to = join(cwd, name)
    await rm(to, { recursive: true, force: true })
    if (existsSync(from)) {
      await mkdir(dirname(to), { recursive: true })
      await cp(from, to, { recursive: true })
    }
  }
  for (const name of LOCKFILES) {
    const from = join(src, name)
    const to = join(cwd, name)
    if (existsSync(from)) {
      await cp(from, to, { recursive: true })
    }
  }
}

/**
 * Snapshot last-green after a stage PASS.
 * @param args - mode, cwd, destination root for copy-tree, stage id.
 * @returns snapshot id (directory name or git SHA).
 */
export async function snapshotGreen(args: {
  mode: SnapshotMode
  cwd: string
  greenDir: string
  stage: Stage
  storyId: string
}): Promise<string> {
  if (args.mode === 'copy-tree') {
    const id = args.stage
    const dest = join(args.greenDir, id)
    await rm(dest, { recursive: true, force: true })
    await copySnapshotTree(args.cwd, dest)
    return id
  }
  const add = await runGit(args.cwd, ['add', '-A'])
  if (add.exitCode !== 0) {
    throw new Error(`git add failed: ${add.stderr || add.stdout}`)
  }
  const commit = await runGit(args.cwd, [
    'commit',
    '-m',
    `uncle-bob: story ${args.storyId} ${args.stage} pass`,
    '--allow-empty',
  ])
  if (commit.exitCode !== 0) {
    throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`)
  }
  const rev = await runGit(args.cwd, ['rev-parse', 'HEAD'])
  if (rev.exitCode !== 0) {
    throw new Error(`git rev-parse failed: ${rev.stderr || rev.stdout}`)
  }
  return rev.stdout.trim()
}

/**
 * Restore last-green. Only the director restores; children never git reset.
 * @param args - mode, cwd, green dir, snapshot id.
 * @returns a promise that rejects when restore fails (fail closed).
 */
export async function restoreGreen(args: {
  mode: SnapshotMode
  cwd: string
  greenDir: string
  lastGreenId: string
}): Promise<void> {
  if (args.mode === 'copy-tree') {
    const src = join(args.greenDir, args.lastGreenId)
    if (!existsSync(src)) {
      throw new Error(`copy-tree snapshot missing: ${src}`)
    }
    await restoreSnapshotTree(args.cwd, src)
    return
  }
  const reset = await runGit(args.cwd, ['reset', '--hard', args.lastGreenId])
  if (reset.exitCode !== 0) {
    throw new Error(`git reset --hard failed: ${reset.stderr || reset.stdout}`)
  }
}

/**
 * Relative paths under `src/` that differ between two fingerprints' file lists.
 * Used by Specifier/QA product-diff gates.
 * @param cwd - workspace.
 * @param previous - map of relative path → sha256 at pre-stage.
 * @returns changed relative paths under src/.
 */
export async function srcDiff(cwd: string, previous: ReadonlyMap<string, string>): Promise<string[]> {
  const current = await srcFileMap(cwd)
  const changed: string[] = []
  const keys = new Set([...previous.keys(), ...current.keys()])
  for (const key of keys) {
    if (previous.get(key) !== current.get(key)) changed.push(key)
  }
  return changed.sort()
}

/**
 * Map relative src/ paths to content hashes.
 * @param cwd - workspace.
 * @returns path → sha256.
 */
export async function srcFileMap(cwd: string): Promise<Map<string, string>> {
  const files = await listFiles(join(cwd, 'src'))
  const map = new Map<string, string>()
  for (const file of files) {
    const rel = relative(cwd, file).split(sep).join('/')
    map.set(rel, createHash('sha256').update(await readFile(file)).digest('hex'))
  }
  return map
}

/**
 * Map relative tests/ paths to content hashes.
 * @param cwd - workspace.
 * @returns path → sha256.
 */
export async function testsFileMap(cwd: string): Promise<Map<string, string>> {
  const files = await listFiles(join(cwd, 'tests'))
  const map = new Map<string, string>()
  for (const file of files) {
    const rel = relative(cwd, file).split(sep).join('/')
    map.set(rel, createHash('sha256').update(await readFile(file)).digest('hex'))
  }
  return map
}

/**
 * Persist a JSON file map for pre-stage diffs.
 * @param path - destination.
 * @param map - path → hash.
 */
export async function writeFileMap(path: string, map: ReadonlyMap<string, string>): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(Object.fromEntries(map), null, 2)}\n`, 'utf8')
}

/**
 * Copy Specifier-authored Gherkin to a deterministic cucumber path.
 * @param from - artifact acceptance.feature.
 * @param cwd - workspace.
 * @returns destination path.
 */
export async function copyAcceptanceFeature(from: string, cwd: string): Promise<string> {
  const destDir = join(cwd, 'tests', 'acceptance')
  await mkdir(destDir, { recursive: true })
  const dest = join(destDir, 'acceptance.feature')
  await cp(from, dest)
  return dest
}
