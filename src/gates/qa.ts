/**
 * QA gate: tests/qa exists, no src/ edits, public-entry imports only, qaCommand.
 * @module uncle-bob-harness/gates/qa
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'
import { srcDiff } from '../git.ts'
import { outputTail, runCommand } from '../subprocess-run.ts'
import { gateReport, utcNow, type GateInput } from './types.ts'
import type { GateReport } from '../schema.ts'

function collectFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) collectFiles(path, out)
    else if (entry.isFile()) out.push(path)
  }
}

/**
 * Public entry listed in qa.md, default src/index.ts.
 * @param qaMd - qa.md contents.
 * @returns relative public module path.
 */
export function publicEntryFromQaMd(qaMd: string): string {
  const match = /from\s+`?([A-Za-z0-9_./-]+\.ts)`?/.exec(qaMd)
    ?? /public interface:.*?([A-Za-z0-9_./-]+\.ts)/i.exec(qaMd)
    ?? /exported \w+\([^)]*\)[^\n]*from\s+(\S+\.ts)/i.exec(qaMd)
  if (match?.[1] !== undefined) return match[1].replace(/^\.\//, '')
  return 'src/index.ts'
}

/**
 * Product imports in tests/qa other than the public entry.
 * @param cwd - workspace.
 * @param publicEntry - allowed relative path (posix).
 * @returns illegal import descriptions.
 */
export function qaIllegalImports(cwd: string, publicEntry: string): string[] {
  const dir = join(cwd, 'tests', 'qa')
  const files: string[] = []
  collectFiles(dir, files)
  const allowed = publicEntry.split(sep).join('/')
  const illegal: string[] = []
  for (const file of files) {
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue
    const text = readFileSync(file, 'utf8')
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const relFile = relative(cwd, file).split(sep).join('/')
    const visit = (node: ts.Node): void => {
      let specifier: string | undefined
      if (ts.isImportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
        specifier = node.moduleSpecifier.text
      }
      if (specifier !== undefined && (specifier.startsWith('.') || specifier.includes('src/'))) {
        const resolved = join(file, '..', specifier).split(sep).join('/')
        const rel = relative(cwd, resolved).split(sep).join('/')
        const candidates = [rel, `${rel}.ts`, `${rel}.js`]
        const hitsSrc = candidates.some(path => path.includes('/src/') || path.startsWith('src/'))
          || specifier.includes('src/')
        if (hitsSrc) {
          const normalized = specifier.replace(/^\.\.\//g, '').replace(/^\.\//, '')
          const ok = candidates.some(path => path === allowed || path === allowed.replace(/\.ts$/, ''))
            || specifier.endsWith(allowed)
            || specifier.endsWith(allowed.replace(/\.ts$/, '.js'))
            || normalized.endsWith(allowed)
          if (!ok) {
            illegal.push(`${relFile} imports ${specifier} (public entry is ${allowed})`)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return illegal
}

/**
 * Run the QA gate.
 * @param input - gate input.
 * @returns host gate report.
 */
export async function runQaGate(input: GateInput): Promise<GateReport> {
  const startedUtc = utcNow()
  const command = [...input.config.qaCommand]
  const base = {
    gate: 'qa',
    stage: input.stage,
    attempt: input.attempt,
    cwd: input.cwd,
    candidate: { dirty: true, worktreeFingerprint: input.worktreeFingerprint },
    command,
    startedUtc,
    artifacts: [] as string[],
  }

  const qaDir = join(input.cwd, 'tests', 'qa')
  if (!existsSync(qaDir) || !statSync(qaDir).isDirectory()) {
    return gateReport({
      ...base,
      endedUtc: utcNow(),
      exitCode: 1,
      verdict: 'FAIL',
      reason: 'tests/qa/ is missing',
    })
  }

  const srcChanges = await srcDiff(input.cwd, input.srcBefore)
  if (srcChanges.length > 0) {
    // Implementation adaptation: QA must not patch product code.
    return gateReport({
      ...base,
      endedUtc: utcNow(),
      exitCode: 1,
      verdict: 'FAIL',
      reason: `QA must not modify src/: ${srcChanges.join(', ')}`,
      adaptation: 'QA product-diff is an Implementation adaptation of the role table',
    })
  }

  if (!existsSync(input.layout.qaReport) || readFileSync(input.layout.qaReport, 'utf8').trim().length === 0) {
    return gateReport({
      ...base,
      endedUtc: utcNow(),
      exitCode: 1,
      verdict: 'FAIL',
      reason: 'qa-report.md is missing or empty',
    })
  }

  const qaMd = existsSync(input.layout.qaMd) ? readFileSync(input.layout.qaMd, 'utf8') : ''
  const publicEntry = publicEntryFromQaMd(qaMd)
  const illegal = qaIllegalImports(input.cwd, publicEntry)
  if (illegal.length > 0) {
    return gateReport({
      ...base,
      endedUtc: utcNow(),
      exitCode: 1,
      verdict: 'FAIL',
      reason: `QA files may import only ${publicEntry}: ${illegal.join('; ')}`,
    })
  }

  const ran = await runCommand({
    ctx: input.ctx,
    argv: input.config.qaCommand,
    cwd: input.cwd,
    timeoutMs: input.config.gateTimeoutMs,
    signal: input.signal,
  })
  if (ran.spawnError !== undefined) {
    return gateReport({
      ...base,
      endedUtc: utcNow(),
      exitCode: 1,
      verdict: 'BLOCKED',
      reason: ran.spawnError,
    })
  }
  if (ran.timedOut) {
    return gateReport({
      ...base,
      endedUtc: utcNow(),
      exitCode: 1,
      verdict: 'BLOCKED',
      reason: `QA command timed out after ${input.config.gateTimeoutMs}ms`,
    })
  }
  if (ran.exitCode !== 0) {
    return gateReport({
      ...base,
      endedUtc: utcNow(),
      exitCode: ran.exitCode ?? 1,
      verdict: 'FAIL',
      reason: `QA tests failed (exit ${ran.exitCode}): ${outputTail(ran.stderr || ran.stdout)}`,
    })
  }

  return gateReport({
    ...base,
    endedUtc: utcNow(),
    exitCode: 0,
    verdict: 'PASS',
    reason: 'QA tests exited 0; product tree unchanged',
  })
}
