import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { restoreGreen, snapshotGreen } from '../src/git.ts'

function workspace(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'ub-git-'))
  mkdirSync(join(cwd, 'src'))
  mkdirSync(join(cwd, 'tests'))
  writeFileSync(join(cwd, 'package.json'), '{"name":"snap"}\n')
  writeFileSync(join(cwd, 'src/index.ts'), 'export const n = 1\n')
  writeFileSync(join(cwd, 'architecture.rules.json'), '{}\n')
  return cwd
}

describe('last-green snapshot', () => {
  it('copy-tree snapshots and restores src/', async () => {
    const cwd = workspace()
    const greenDir = join(cwd, '.uncle-bob', 'green')
    const id = await snapshotGreen({
      mode: 'copy-tree',
      cwd,
      greenDir,
      stage: 'coder',
      storyId: 's1',
    })
    expect(id).toBe('coder')
    expect(existsSync(join(greenDir, 'coder', 'src', 'index.ts'))).toBe(true)
    writeFileSync(join(cwd, 'src/index.ts'), 'export const n = 2\n')
    await restoreGreen({ mode: 'copy-tree', cwd, greenDir, lastGreenId: id })
    expect(readFileSync(join(cwd, 'src/index.ts'), 'utf8')).toBe('export const n = 1\n')
  })

  it('git-commit snapshots and restores with a temp repo identity', async () => {
    const cwd = workspace()
    execFileSync('git', ['init'], { cwd })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd })
    const sha = await snapshotGreen({
      mode: 'git-commit',
      cwd,
      greenDir: join(cwd, 'green'),
      stage: 'coder',
      storyId: 's1',
    })
    expect(sha).toMatch(/^[0-9a-f]{40}$/)
    writeFileSync(join(cwd, 'src/index.ts'), 'export const n = 99\n')
    await restoreGreen({ mode: 'git-commit', cwd, greenDir: join(cwd, 'green'), lastGreenId: sha })
    expect(readFileSync(join(cwd, 'src/index.ts'), 'utf8')).toBe('export const n = 1\n')
  })
})
