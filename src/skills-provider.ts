/**
 * Badge-style bundled skills. Optional loaders, not the control plane.
 * @module uncle-bob-harness/skills-provider
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

const PROVIDER_NAME = 'uncle-bob-bundled'
const RESOURCE_BASE = {
  kind: 'directory' as const,
  path: fileURLToPath(new URL('../assets/skills/', import.meta.url)),
}
const INVOCATION = { modelInvocable: true, userInvocable: false } as const

interface BundledSkill {
  name: string
  description: string
  file: string
}

const SKILLS: readonly BundledSkill[] = [
  {
    name: 'gherkin-acceptance',
    description: 'Convert one User Story into Gherkin + qa.md. Do not invent product policy.',
    file: 'gherkin-acceptance/SKILL.md',
  },
  {
    name: 'coder-tdd',
    description: 'Write a failing test then production code. Host does not police keystrokes.',
    file: 'coder-tdd/SKILL.md',
  },
  {
    name: 'crap-cleanup',
    description: 'Refactor high CRAP scores without changing behavior or gaming excludes.',
    file: 'crap-cleanup/SKILL.md',
  },
  {
    name: 'architecture-deps',
    description: 'Honor architecture.rules.json. Invert dependencies; do not delete rules.',
    file: 'architecture-deps/SKILL.md',
  },
  {
    name: 'mutation-gaps',
    description: 'Kill surviving mutants with stronger tests. No self-approved waivers.',
    file: 'mutation-gaps/SKILL.md',
  },
  {
    name: 'black-box-qa',
    description: 'Black-box tests against the public interface. Never patch src/.',
    file: 'black-box-qa/SKILL.md',
  },
]

function candidateOf(skill: BundledSkill): SkillCandidate {
  return {
    name: skill.name,
    description: skill.description,
    invocation: INVOCATION,
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: RESOURCE_BASE,
    rank: BUNDLED_SKILL_RANK,
    locator: new URL(`../assets/skills/${skill.file}`, import.meta.url),
  }
}

const CANDIDATES: SkillCandidate[] = SKILLS.map(candidateOf)

const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve(CANDIDATES),
  async get(candidate): Promise<SkillDefinition> {
    const locator = typeof candidate.locator === 'string' || candidate.locator instanceof URL
      ? candidate.locator
      : candidateOf(SKILLS.find(skill => skill.name === candidate.name) ?? SKILLS[0]!).locator
    return {
      name: candidate.name,
      description: candidate.description,
      invocation: candidate.invocation,
      provider: candidate.provider,
      source: candidate.source,
      resourceBase: RESOURCE_BASE,
      content: await readFile(locator as URL, 'utf8'),
    }
  },
}

/**
 * Register the bundled skill provider.
 * @param ctx - context with ctx.skills.
 */
export function registerBundledSkills(ctx: Context): void {
  ctx.skills.registerProvider(() => provider)
}

/**
 * Bundled skill names (tests).
 * @returns the six skill names.
 */
export function bundledSkillNames(): string[] {
  return SKILLS.map(skill => skill.name)
}
