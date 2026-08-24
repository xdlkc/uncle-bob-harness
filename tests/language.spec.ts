import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../src/language.ts'

describe('detectLanguage', () => {
  it('returns typescript when tsconfig.json and package.json exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ub-lang-ts-'))
    writeFileSync(join(dir, 'tsconfig.json'), '{}\n')
    writeFileSync(join(dir, 'package.json'), '{}\n')
    expect(detectLanguage(dir)).toBe('typescript')
  })

  it('returns unsupported for an empty dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ub-lang-empty-'))
    expect(detectLanguage(dir)).toBe('unsupported')
  })

  it('returns unsupported when only package.json exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ub-lang-pkg-'))
    writeFileSync(join(dir, 'package.json'), '{}\n')
    mkdirSync(join(dir, 'src'))
    expect(detectLanguage(dir)).toBe('unsupported')
  })
})
