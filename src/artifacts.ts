/**
 * Story artifact paths under `<cwd>/<artifactRoot>/story-<id>/`.
 * @module uncle-bob-harness/artifacts
 */

import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Stage } from './fsm.ts'

/** Layout of one story's artifact directory. */
export interface ArtifactLayout {
  readonly storyId: string
  readonly root: string
  readonly storyMd: string
  readonly acceptance: string
  readonly qaMd: string
  readonly blockers: string
  readonly gatesDir: string
  readonly latestGate: string
  readonly report: string
  readonly greenDir: string
  readonly qaReport: string
}

/**
 * Mint a story id: `s` plus the first 12 hex chars of SHA-256(storyText + sessionId + startTime).
 * @param storyText - user story.
 * @param sessionId - parent session id.
 * @param startTime - start timestamp (ms or ISO string).
 * @returns branded-looking story id.
 */
export function makeStoryId(storyText: string, sessionId: string, startTime: string | number): string {
  const hash = createHash('sha256')
    .update(storyText)
    .update(String(sessionId))
    .update(String(startTime))
    .digest('hex')
  return `s${hash.slice(0, 12)}`
}

/**
 * Resolve artifact paths for one story.
 * @param cwd - session workspace.
 * @param artifactRoot - relative artifact root.
 * @param storyId - minted id.
 * @returns path layout.
 */
export function artifactLayout(cwd: string, artifactRoot: string, storyId: string): ArtifactLayout {
  const root = join(cwd, artifactRoot, `story-${storyId}`)
  return {
    storyId,
    root,
    storyMd: join(root, 'story.md'),
    acceptance: join(root, 'acceptance.feature'),
    qaMd: join(root, 'qa.md'),
    blockers: join(root, 'blockers.md'),
    gatesDir: join(root, 'gates'),
    latestGate: join(root, 'gates', 'latest.json'),
    report: join(root, 'REPORT.md'),
    greenDir: join(root, 'green'),
    qaReport: join(root, 'qa-report.md'),
  }
}

/**
 * Create the artifact directory. Collision with an existing directory fails closed.
 * @param layout - path layout.
 * @returns a promise that rejects on collision.
 */
export async function createArtifactDir(layout: ArtifactLayout): Promise<void> {
  if (existsSync(layout.root)) {
    throw new Error(`artifact directory already exists (story id collision): ${layout.root}`)
  }
  await mkdir(layout.gatesDir, { recursive: true })
  await mkdir(layout.greenDir, { recursive: true })
}

/**
 * Persist the user story before any child runs.
 * @param layout - path layout.
 * @param storyText - user story.
 * @returns a promise that settles when the file is written.
 */
export async function writeStoryMarkdown(layout: ArtifactLayout, storyText: string): Promise<void> {
  await writeFile(layout.storyMd, `${storyText.trim()}\n`, 'utf8')
}

/**
 * Write one host gate JSON and copy it to `gates/latest.json`.
 * @param layout - path layout.
 * @param stage - stage name.
 * @param attempt - 1-based attempt.
 * @param report - gate envelope.
 * @returns the written path.
 */
export async function writeGateReport(
  layout: ArtifactLayout,
  stage: Stage,
  attempt: number,
  report: unknown,
): Promise<string> {
  const name = stage === 'independent-rerun' ? 'independent-rerun.json' : `${stage}-${attempt}.json`
  const path = join(layout.gatesDir, name)
  const body = `${JSON.stringify(report, null, 2)}\n`
  await mkdir(layout.gatesDir, { recursive: true })
  await writeFile(path, body, 'utf8')
  await copyFile(path, layout.latestGate)
  return path
}

/**
 * Read the latest gate JSON if it exists.
 * @param layout - path layout.
 * @returns file contents or empty string.
 */
export async function readLatestGate(layout: ArtifactLayout): Promise<string> {
  try {
    return await readFile(layout.latestGate, 'utf8')
  } catch (error) {
    // Swallow only missing-file: retries have no prior gate.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

/**
 * Write the director REPORT.md at halt.
 * @param layout - path layout.
 * @param body - markdown body.
 * @returns a promise that settles when written.
 */
export async function writeReport(layout: ArtifactLayout, body: string): Promise<void> {
  await writeFile(layout.report, body.endsWith('\n') ? body : `${body}\n`, 'utf8')
}
