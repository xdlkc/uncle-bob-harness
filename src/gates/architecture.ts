/**
 * Architecture checker: import graph vs architecture.rules.json. No GUI in v1.
 * @module uncle-bob-harness/gates/architecture
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import ts from 'typescript'
import { isRecord } from '../util.ts'
import { gateReport, utcNow, type GateInput } from './types.ts'
import type { GateReport } from '../schema.ts'

/** One module in architecture.rules.json. */
export interface ArchitectureModule {
  name: string
  pattern: string
  mayDependOn: string[]
}

/** Committed architecture rules. */
export interface ArchitectureRules {
  modules: ArchitectureModule[]
  externalAllow: string[]
  forbidCycles: boolean
}

function globToRegExp(pattern: string): RegExp {
  const posix = pattern.split(sep).join('/')
  let re = ''
  for (let i = 0; i < posix.length;) {
    if (posix.startsWith('**/', i)) {
      re += '(?:.*/)?'
      i += 3
      continue
    }
    if (posix.startsWith('**', i) && i + 2 === posix.length) {
      re += '.*'
      i += 2
      continue
    }
    const ch = posix[i]!
    if (ch === '*') {
      re += '[^/]*'
      i += 1
      continue
    }
    if ('+.^${}()|[]\\'.includes(ch)) re += `\\${ch}`
    else re += ch
    i += 1
  }
  return new RegExp(`^${re}$`)
}

/**
 * Score glob specificity: exact beats wildcards; longer beats shorter.
 * @param pattern - glob.
 * @returns higher is more specific.
 */
function specificity(pattern: string): number {
  const wildcards = (pattern.match(/\*/g) ?? []).length
  return pattern.length * 4 - wildcards * 20
}

/**
 * Map a relative file path to a module name.
 * @param file - posix-relative path.
 * @param modules - rules modules.
 * @returns module name or undefined.
 */
export function moduleFor(file: string, modules: readonly ArchitectureModule[]): string | undefined {
  const posix = file.split(sep).join('/')
  let best: ArchitectureModule | undefined
  let bestScore = Number.NEGATIVE_INFINITY
  for (const mod of modules) {
    if (!globToRegExp(mod.pattern).test(posix)) continue
    const score = specificity(mod.pattern)
    if (score > bestScore) {
      best = mod
      bestScore = score
    }
  }
  return best?.name
}

function collectTsFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) collectTsFiles(path, out)
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(path)
  }
}

function resolveImport(fromFile: string, specifier: string, cwd: string): { kind: 'external'; name: string } | { kind: 'internal'; file: string } {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const base = join(dirname(fromFile), specifier)
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      join(base, 'index.ts'),
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return { kind: 'internal', file: relative(cwd, candidate).split(sep).join('/') }
      }
    }
    return { kind: 'internal', file: relative(cwd, base).split(sep).join('/') }
  }
  return { kind: 'external', name: specifier }
}

function isAllowedExternal(name: string, allow: readonly string[]): boolean {
  return allow.some(prefix => prefix.length > 0 && (name === prefix || name.startsWith(prefix)))
}

function walkImports(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const specifiers: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments[0] !== undefined
      && ts.isStringLiteral(node.arguments[0])) {
      specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specifiers
}

function findCycles(edges: ReadonlyMap<string, Set<string>>): string[][] {
  const cycles: string[][] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const visit = (node: string): void => {
    if (visited.has(node)) return
    if (visiting.has(node)) {
      const start = stack.indexOf(node)
      cycles.push(stack.slice(start).concat(node))
      return
    }
    visiting.add(node)
    stack.push(node)
    for (const next of edges.get(node) ?? []) visit(next)
    stack.pop()
    visiting.delete(node)
    visited.add(node)
  }
  for (const node of edges.keys()) visit(node)
  return cycles
}

/**
 * Load architecture.rules.json.
 * @param path - absolute path.
 * @returns rules or an error string.
 */
export function loadArchitectureRules(path: string): ArchitectureRules | { error: string } {
  if (!existsSync(path)) return { error: `architecture rules missing: ${path}` }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return { error: `architecture rules are not valid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['modules'])) {
    return { error: 'architecture rules must have a modules array' }
  }
  const modules: ArchitectureModule[] = []
  for (const item of parsed['modules']) {
    if (!isRecord(item) || typeof item['name'] !== 'string' || typeof item['pattern'] !== 'string' || !Array.isArray(item['mayDependOn'])) {
      return { error: 'each module needs name, pattern, mayDependOn' }
    }
    modules.push({
      name: item['name'],
      pattern: item['pattern'],
      mayDependOn: item['mayDependOn'].filter((value): value is string => typeof value === 'string'),
    })
  }
  const externalAllow = Array.isArray(parsed['externalAllow'])
    ? parsed['externalAllow'].filter((value): value is string => typeof value === 'string')
    : []
  return {
    modules,
    externalAllow,
    forbidCycles: parsed['forbidCycles'] === true,
  }
}

/**
 * Run the architecture gate.
 * @param input - gate input.
 * @returns host gate report.
 */
export async function runArchitectureGate(input: GateInput): Promise<GateReport> {
  const startedUtc = utcNow()
  const rulesPath = join(input.cwd, input.config.architectureRulesPath)
  const loaded = loadArchitectureRules(rulesPath)
  const base = {
    gate: 'architecture',
    stage: input.stage,
    attempt: input.attempt,
    cwd: input.cwd,
    candidate: { dirty: true, worktreeFingerprint: input.worktreeFingerprint },
    command: ['architecture-in-process'],
    startedUtc,
    artifacts: [] as string[],
  }
  if ('error' in loaded) {
    return gateReport({
      ...base,
      endedUtc: utcNow(),
      exitCode: 1,
      verdict: 'BLOCKED',
      reason: loaded.error,
    })
  }
  if (loaded.modules.length === 0) {
    return gateReport({
      ...base,
      endedUtc: utcNow(),
      exitCode: 1,
      verdict: 'BLOCKED',
      reason: 'architecture rules modules array is empty',
    })
  }

  const files: string[] = []
  collectTsFiles(join(input.cwd, 'src'), files)
  const illegal: string[] = []
  const moduleEdges = new Map<string, Set<string>>()
  for (const mod of loaded.modules) moduleEdges.set(mod.name, new Set())

  for (const file of files) {
    const rel = relative(input.cwd, file).split(sep).join('/')
    const fromModule = moduleFor(rel, loaded.modules)
    if (fromModule === undefined) {
      illegal.push(`${rel} matches no architecture module`)
      continue
    }
    const allowed = loaded.modules.find(mod => mod.name === fromModule)?.mayDependOn ?? []
    for (const specifier of walkImports(file)) {
      const resolved = resolveImport(file, specifier, input.cwd)
      if (resolved.kind === 'external') {
        if (!isAllowedExternal(resolved.name, loaded.externalAllow)) {
          illegal.push(`${rel} imports external "${resolved.name}"`)
        }
        continue
      }
      const toModule = moduleFor(resolved.file, loaded.modules)
      if (toModule === undefined) continue
      if (toModule === fromModule) continue
      moduleEdges.get(fromModule)?.add(toModule)
      if (!allowed.includes(toModule)) {
        illegal.push(`${rel} (${fromModule}) may not depend on ${resolved.file} (${toModule})`)
      }
    }
  }

  if (loaded.forbidCycles) {
    for (const cycle of findCycles(moduleEdges)) {
      if (cycle.length > 0) illegal.push(`cycle: ${cycle.join(' -> ')}`)
    }
  }

  if (illegal.length > 0) {
    return gateReport({
      ...base,
      endedUtc: utcNow(),
      exitCode: 1,
      verdict: 'FAIL',
      reason: illegal.join('; '),
      violations: illegal,
    })
  }
  return gateReport({
    ...base,
    endedUtc: utcNow(),
    exitCode: 0,
    verdict: 'PASS',
    reason: 'architecture rules hold',
  })
}
