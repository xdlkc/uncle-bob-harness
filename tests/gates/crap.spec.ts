import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { artifactLayout } from '../../src/artifacts.ts'
import { resolveConfig } from '../../src/config.ts'
import { analyzeTsComplexity, crapPasses, crapScore, joinCrap, runCrapGate } from '../../src/gates/crap.ts'
import { captureProtectedSurfaces } from '../../src/gates/tamper.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/gates')

describe('CRAP formula', () => {
  it('matches known (cc, cov) tuples', () => {
    // Implementation adaptation: CRAP(cc, cov) = cc^2 * (1-cov)^3 + cc
    expect(crapScore(1, 1)).toBe(1)
    expect(crapScore(2, 1)).toBe(2)
    expect(crapScore(6, 0)).toBe(6 ** 2 + 6)
    expect(crapScore(9, 1)).toBe(9)
    expect(crapScore(6, 0.4)).toBeCloseTo(6 ** 2 * (0.6) ** 3 + 6, 10)
  })

  it('fails when score > cap; equality passes', () => {
    expect(crapPasses(crapScore(2, 1), 8)).toBe(true)
    expect(crapPasses(8, 8)).toBe(true)
    expect(crapPasses(crapScore(6, 0), 8)).toBe(false)
    expect(crapPasses(crapScore(9, 1), 8)).toBe(false)
    expect(crapScore(6, 0) > 8).toBe(true)
    expect(crapScore(9, 1) > 8).toBe(true)
  })

  it('joinCrap treats missing coverage as 0', () => {
    const complexity = new Map([['src/index.ts:fizzBuzz:1', { cc: 6, startLine: 1 }]])
    const rows = joinCrap(complexity, new Map(), 8)
    expect(rows[0]?.coverage).toBe(0)
    expect(rows[0]?.pass).toBe(false)
  })

  it('walks the crap-fail fixture to a high-cc function', () => {
    const map = analyzeTsComplexity(join(FIXTURES, 'crap-fail'))
    const row = [...map.values()].find(item => item.name === 'fizzBuzz')
    expect(row?.cc).toBeGreaterThanOrEqual(6)
  })

  it('production path without coverage JSON fails a high-cc function', async () => {
    const cwd = join(FIXTURES, 'crap-fail')
    const report = await runCrapGate({
      ctx: new Context(),
      cwd,
      config: resolveConfig({}),
      stage: 'cleaner',
      attempt: 1,
      layout: artifactLayout(cwd, '.uncle-bob', 'stest'),
      signal: new AbortController().signal,
      srcBefore: new Map(),
      testsBefore: new Map(),
      startSurfaces: await captureProtectedSurfaces(cwd, 'architecture.rules.json'),
      worktreeFingerprint: 'sha256:test',
    })
    expect(report.verdict).toBe('FAIL')
    expect(report.reason).toMatch(/CRAP/)
  })

  it('loads Istanbul coverage-final.json so a covered high-cc function can pass', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ub-crap-cov-'))
    mkdirSync(join(cwd, 'src'), { recursive: true })
    mkdirSync(join(cwd, 'coverage'), { recursive: true })
    writeFileSync(join(cwd, 'src/index.ts'), 'export function ping(): string { return "pong" }\n')
    const abs = join(cwd, 'src/index.ts')
    writeFileSync(join(cwd, 'coverage/coverage-final.json'), JSON.stringify({
      [abs]: {
        path: abs,
        fnMap: {
          '0': {
            name: 'ping',
            loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 40 } },
          },
        },
        f: { '0': 1 },
        statementMap: {
          '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 40 } },
        },
        s: { '0': 1 },
      },
    }))
    const report = await runCrapGate({
      ctx: new Context(),
      cwd,
      config: resolveConfig({}),
      stage: 'cleaner',
      attempt: 1,
      layout: artifactLayout(cwd, '.uncle-bob', 'stest'),
      signal: new AbortController().signal,
      srcBefore: new Map(),
      testsBefore: new Map(),
      startSurfaces: await captureProtectedSurfaces(cwd, 'architecture.rules.json'),
      worktreeFingerprint: 'sha256:test',
    })
    expect(report.verdict).toBe('PASS')
    const ping = (report.functions as { id: string; coverage: number }[] | undefined)
      ?.find(row => row.id.includes('ping'))
    expect(ping?.coverage).toBe(1)
  })
})
