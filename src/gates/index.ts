/**
 * Dispatch one named host gate.
 * @module uncle-bob-harness/gates
 */

import type { Stage } from '../fsm.ts'
import { assertNever } from '../util.ts'
import { runArchitectureGate } from './architecture.ts'
import { runCrapGate } from './crap.ts'
import { runGherkinParseGate } from './gherkin-parse.ts'
import { runIndependentRerunGate } from './independent-rerun.ts'
import { runMutationGate } from './mutation.ts'
import { runQaGate } from './qa.ts'
import { runTamperGate } from './tamper.ts'
import { runUnitAcceptanceGate } from './unit-acceptance.ts'
import type { GateInput } from './types.ts'
import type { GateReport } from '../schema.ts'

export type { GateInput, ProtectedSurfaces } from './types.ts'
export { captureProtectedSurfaces } from './tamper.ts'

/**
 * Run the host gate for a pipeline stage.
 * @param stage - current stage.
 * @param input - gate input.
 * @returns host-owned report. Child structured status is ignored.
 */
export async function runGate(stage: Stage, input: GateInput): Promise<GateReport> {
  switch (stage) {
    case 'specifier':
      return runGherkinParseGate(input)
    case 'coder':
      return runUnitAcceptanceGate(input)
    case 'cleaner': {
      const tests = await runUnitAcceptanceGate(input)
      if (tests.verdict !== 'PASS') return tests
      const crap = await runCrapGate(input)
      if (crap.verdict !== 'PASS') return crap
      return runArchitectureGate(input)
    }
    case 'hardener':
      return runMutationGate(input)
    case 'qa':
      return runQaGate(input)
    case 'independent-rerun':
      return runIndependentRerunGate(input)
    case 'diagnostic':
      throw new Error('diagnostic stage has no host gate')
    default:
      return assertNever(stage)
  }
}

export {
  runArchitectureGate,
  runCrapGate,
  runGherkinParseGate,
  runIndependentRerunGate,
  runMutationGate,
  runQaGate,
  runTamperGate,
  runUnitAcceptanceGate,
}
