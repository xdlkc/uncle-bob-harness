/**
 * CRAP gate: cyclomatic complexity × coverage. Formula is an Implementation adaptation.
 * @module uncle-bob-harness/gates/crap
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'
import { isRecord } from '../util.ts'
import { gateReport, utcNow, type GateInput } from './types.ts'
import type { GateReport } from '../schema.ts'

/** One function's CRAP row. */
export interface CrapFunction {
  id: string
  cc: number
  coverage: number
  crap: number
  cap: number
  pass: boolean
}

/**
 * CRAP(cc, cov) = cc² * (1 - cov)³ + cc with cov in 0..1.
 * Implementation adaptation — not an Uncle Bob quote.
 * @param cc - cyclomatic complexity (>= 1).
 * @param cov - coverage in 0..1.
 * @returns the score.
 */
export function crapScore(cc: number, cov: number): number {
  const clamped = Math.min(1, Math.max(0, cov))
  return cc ** 2 * (1 - clamped) ** 3 + cc
}

/**
 * Whether a function passes the cap (equality passes; fail when score > cap).
 * @param score - CRAP score.
 * @param cap - configured cap.
 * @returns true when score <= cap.
 */
export function crapPasses(score: number, cap: number): boolean {
  return score <= cap
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
    || ts.isConstructorDeclaration(node)
}

function functionName(node: ts.FunctionLikeDeclaration): string {
  if (node.name !== undefined && ts.isIdentifier(node.name)) return node.name.text
  const parent = node.parent
  if (parent !== undefined && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text
  }
  if (parent !== undefined && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text
  }
  return '<anonymous>'
}

function complexityOf(node: ts.FunctionLikeDeclaration): number {
  let cc = 1
  const visit = (child: ts.Node): void => {
    if (isFunctionLike(child) && child !== node) return
    switch (child.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ConditionalExpression:
      case ts.SyntaxKind.CaseClause:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CatchClause:
        cc += 1
        break
      case ts.SyntaxKind.BinaryExpression: {
        const operator = (child as ts.BinaryExpression).operatorToken.kind
        if (
          operator === ts.SyntaxKind.AmpersandAmpersandToken
          || operator === ts.SyntaxKind.BarBarToken
          || operator === ts.SyntaxKind.QuestionQuestionToken
        ) {
          cc += 1
        }
        break
      }
      default:
        break
    }
    ts.forEachChild(child, visit)
  }
  if (node.body !== undefined) ts.forEachChild(node.body, visit)
  return cc
}

function collectTsFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) collectTsFiles(path, out)
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(path)
  }
}

/**
 * Walk TypeScript sources and return cyclomatic complexity per function.
 * Implementation adaptation of “cyclomatic complexity.”
 * @param cwd - workspace root.
 * @returns map of `relativePath:name:startLine` → { cc, startLine }.
 */
export function analyzeTsComplexity(cwd: string): Map<string, { cc: number; startLine: number; name: string; path: string }> {
  const files: string[] = []
  collectTsFiles(join(cwd, 'src'), files)
  const result = new Map<string, { cc: number; startLine: number; name: string; path: string }>()
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const rel = relative(cwd, file).split(sep).join('/')
    const visit = (node: ts.Node): void => {
      if (isFunctionLike(node) && node.body !== undefined) {
        const start = source.getLineAndCharacterOfPosition(node.getStart(source, false)).line + 1
        const name = functionName(node)
        const cc = complexityOf(node)
        result.set(`${rel}:${name}:${start}`, { cc, startLine: start, name, path: rel })
        ts.forEachChild(node, visit)
        return
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return result
}

interface IstanbulRange {
  start: { line: number; column: number }
  end: { line: number; column: number }
}

function rangesOverlap(fn: IstanbulRange, stmt: IstanbulRange): boolean {
  if (stmt.end.line < fn.start.line || stmt.start.line > fn.end.line) return false
  return true
}

/**
 * Parse Istanbul/nyc coverage JSON into per-function coverage in 0..1.
 * Missing coverage for an executable function is handled by the joiner (cov = 0).
 * @param coverageJson - Istanbul file map.
 * @param cwd - workspace, used to relativize paths.
 * @returns map of `relativePath:name:startLine` → coverage.
 */
export function parseIstanbulCoverage(coverageJson: unknown, cwd: string): Map<string, number> {
  const out = new Map<string, number>()
  if (!isRecord(coverageJson)) return out
  for (const [filePath, file] of Object.entries(coverageJson)) {
    if (!isRecord(file)) continue
    const rel = (typeof file['path'] === 'string' ? file['path'] : filePath)
    const relativePath = rel.startsWith(cwd) ? relative(cwd, rel).split(sep).join('/') : rel.split(sep).join('/')
    const fnMap = isRecord(file['fnMap']) ? file['fnMap'] : {}
    const fHits = isRecord(file['f']) ? file['f'] : {}
    const statementMap = isRecord(file['statementMap']) ? file['statementMap'] : {}
    const sHits = isRecord(file['s']) ? file['s'] : {}
    for (const [id, meta] of Object.entries(fnMap)) {
      if (!isRecord(meta)) continue
      const name = typeof meta['name'] === 'string' ? meta['name'] : '<anonymous>'
      const loc = isRecord(meta['loc']) ? meta['loc'] : isRecord(meta['decl']) ? meta['decl'] : undefined
      if (!isRecord(loc) || !isRecord(loc['start'])) continue
      const startLine = Number((loc['start'] as { line?: number }).line ?? 0)
      const end = isRecord(loc['end']) ? loc['end'] as { line?: number; column?: number } : { line: startLine, column: 0 }
      const fnRange: IstanbulRange = {
        start: { line: startLine, column: Number((loc['start'] as { column?: number }).column ?? 0) },
        end: { line: Number(end.line ?? startLine), column: Number(end.column ?? 0) },
      }
      let executable = 0
      let hit = 0
      for (const [sid, stmt] of Object.entries(statementMap)) {
        if (!isRecord(stmt) || !isRecord(stmt['start']) || !isRecord(stmt['end'])) continue
        const range: IstanbulRange = {
          start: { line: Number((stmt['start'] as { line?: number }).line ?? 0), column: Number((stmt['start'] as { column?: number }).column ?? 0) },
          end: { line: Number((stmt['end'] as { line?: number }).line ?? 0), column: Number((stmt['end'] as { column?: number }).column ?? 0) },
        }
        if (!rangesOverlap(fnRange, range)) continue
        executable += 1
        const count = Number(sHits[sid] ?? 0)
        if (count > 0) hit += 1
      }
      const fallbackHits = Number(fHits[id] ?? 0)
      const coverage = executable > 0 ? hit / executable : (fallbackHits > 0 ? 1 : 0)
      out.set(`${relativePath}:${name}:${startLine}`, coverage)
    }
  }
  return out
}

/**
 * Join complexity and coverage by `relativePath:name:startLine`.
 * Missing coverage for an executable function → cov = 0 (fail closed).
 * @param complexity - complexity map.
 * @param coverage - coverage map.
 * @param crapCap - fail when score > cap.
 * @returns per-function rows.
 */
function lookupCoverage(coverage: ReadonlyMap<string, number>, id: string): number | undefined {
  const exact = coverage.get(id)
  if (exact !== undefined) return exact
  const lastColon = id.lastIndexOf(':')
  if (lastColon < 0) return undefined
  const prefix = id.slice(0, lastColon)
  for (const [key, value] of coverage) {
    if (key === prefix || key.startsWith(`${prefix}:`)) return value
  }
  return undefined
}

/**
 * Load Istanbul coverage-final.json from well-known paths. Missing file → empty map.
 * @param cwd - workspace root.
 * @returns per-function coverage.
 */
export function loadCoverageFromDisk(cwd: string): Map<string, number> {
  const candidates = [join(cwd, 'coverage', 'coverage-final.json'), join(cwd, 'coverage-final.json')]
  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      const json = JSON.parse(readFileSync(path, 'utf8')) as unknown
      return parseIstanbulCoverage(json, cwd)
    } catch {
      continue
    }
  }
  return new Map()
}

export function joinCrap(
  complexity: ReadonlyMap<string, { cc: number; startLine: number; name?: string; path?: string }>,
  coverage: ReadonlyMap<string, number>,
  crapCap: number,
): CrapFunction[] {
  const rows: CrapFunction[] = []
  for (const [id, meta] of complexity) {
    const cov = lookupCoverage(coverage, id) ?? 0
    const score = crapScore(meta.cc, cov)
    rows.push({
      id,
      cc: meta.cc,
      coverage: cov,
      crap: score,
      cap: crapCap,
      pass: crapPasses(score, crapCap),
    })
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Run the CRAP gate from synthetic maps or by walking cwd.
 * @param input - gate input.
 * @param maps - optional synthetic maps (unit tests).
 * @returns host gate report.
 */
export async function runCrapGate(
  input: GateInput,
  maps?: {
    complexity: ReadonlyMap<string, { cc: number; startLine: number }>
    coverage: ReadonlyMap<string, number>
  },
): Promise<GateReport> {
  const startedUtc = utcNow()
  const complexity = maps?.complexity ?? analyzeTsComplexity(input.cwd)
  const coverage = maps?.coverage ?? loadCoverageFromDisk(input.cwd)
  const functions = joinCrap(complexity, coverage, input.config.crapCap)
  const failing = functions.filter(row => !row.pass)
  const verdict = failing.length === 0 ? 'PASS' : 'FAIL'
  const reason = failing.length === 0
    ? `all ${functions.length} function(s) CRAP <= ${input.config.crapCap}`
    : failing.map(row => `function ${row.id} CRAP ${row.crap} > cap ${row.cap}`).join('; ')
  return gateReport({
    gate: 'crap',
    stage: input.stage,
    attempt: input.attempt,
    cwd: input.cwd,
    candidate: { dirty: true, worktreeFingerprint: input.worktreeFingerprint },
    command: ['crap-in-process'],
    startedUtc,
    endedUtc: utcNow(),
    exitCode: verdict === 'PASS' ? 0 : 1,
    verdict,
    reason,
    adaptation: 'CRAP formula and cap are Implementation adaptations, not Uncle Bob quotes',
    functions,
    artifacts: [],
  })
}

