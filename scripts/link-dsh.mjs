#!/usr/bin/env node
/**
 * Symlink sibling deepseek-harness packages into node_modules so tests and tsc
 * resolve @deepseek-ai/* without pnpm workspace: protocol. No-op when the
 * checkout is not a sibling (profile `dsh plugin add` already has those deps).
 */
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dsh = join(root, '..', 'deepseek-harness')
if (!existsSync(dsh)) process.exit(0)

const links = {
  '@deepseek-ai/cordis': 'vendor/cordis',
  '@deepseek-ai/cosmokit': 'vendor/cosmokit',
  '@deepseek-ai/schemastery': 'vendor/schemastery',
  '@deepseek-ai/cordis-plugin-include': 'vendor/include',
  '@deepseek-ai/dsh-agent': 'packages/core/agent',
  '@deepseek-ai/dsh-brand': 'packages/util/brand',
  '@deepseek-ai/dsh-commands': 'packages/interaction/commands',
  '@deepseek-ai/dsh-invariants': 'packages/runtime-diagnostics/invariants',
  '@deepseek-ai/dsh-llm': 'packages/llm/llm',
  '@deepseek-ai/dsh-scope': 'packages/core/scope',
  '@deepseek-ai/dsh-session': 'packages/core/session',
  '@deepseek-ai/dsh-skill': 'packages/skill/skill',
  '@deepseek-ai/dsh-subagent': 'packages/subagent/subagent',
  '@deepseek-ai/dsh-subprocess': 'packages/subprocess/subprocess',
  '@deepseek-ai/dsh-system-prompt': 'packages/core/system-prompt',
  '@deepseek-ai/dsh-tools': 'packages/core/tools',
}

const nm = join(root, 'node_modules')
mkdirSync(join(nm, '@deepseek-ai'), { recursive: true })
for (const [name, rel] of Object.entries(links)) {
  const target = join(dsh, rel)
  const dest = join(nm, ...name.split('/'))
  if (!existsSync(target)) {
    console.warn(`link-dsh: skip ${name}, missing ${target}`)
    continue
  }
  mkdirSync(dirname(dest), { recursive: true })
  rmSync(dest, { recursive: true, force: true })
  symlinkSync(target, dest)
}
