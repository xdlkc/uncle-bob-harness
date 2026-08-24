import { describe, expect, it } from 'vitest'
import { readStageReport } from '../src/schema.ts'

const valid = {
  status: 'complete',
  summary: 'wrote acceptance.feature',
  artifactsWritten: ['acceptance.feature'],
  evidence: ['parsed'],
  blocker: '',
}

describe('readStageReport', () => {
  it('accepts a valid complete report', () => {
    expect(readStageReport(valid, 16_384)).toEqual(valid)
  })

  it('rejects extra keys', () => {
    const result = readStageReport({ ...valid, extra: true }, 16_384)
    expect(result).toMatchObject({ error: expect.stringContaining('extra or missing keys') })
  })

  it('rejects empty summary', () => {
    const result = readStageReport({ ...valid, summary: '' }, 16_384)
    expect(result).toMatchObject({ error: expect.stringContaining('summary') })
  })

  it('rejects padded summary', () => {
    const result = readStageReport({ ...valid, summary: '  padded  ' }, 16_384)
    expect(result).toMatchObject({ error: expect.stringContaining('summary') })
  })

  it('rejects oversized JSON', () => {
    const result = readStageReport({ ...valid, summary: 'x'.repeat(100) }, 80)
    expect(result).toMatchObject({ error: expect.stringContaining('maxHandoffChars') })
  })

  it('rejects empty array entries', () => {
    const result = readStageReport({ ...valid, evidence: [''] }, 16_384)
    expect(result).toMatchObject({ error: expect.stringContaining('arrays') })
  })

  it('requires blocker when blocked', () => {
    const result = readStageReport({ ...valid, status: 'blocked', blocker: '' }, 16_384)
    expect(result).toMatchObject({ error: expect.stringContaining('blocker') })
  })

  it('rejects a non-object', () => {
    expect(readStageReport(null, 16_384)).toMatchObject({ error: expect.stringContaining('not an object') })
  })
})
