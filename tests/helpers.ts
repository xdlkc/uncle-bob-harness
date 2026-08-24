/**
 * Fake Cordis services and a stub SubagentProvider for keyless tests.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentCapabilities, SubagentProvider, SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as uncleBob from '../src/index.ts'
import { resolveConfig, type Config } from '../src/config.ts'

export class FakeTools extends Service {
  readonly registered: Array<{ name: string; execute?: Function; presentCall?: Function }> = []

  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  register(tool: { name: string }): () => void {
    this.registered.push(tool)
    return () => {
      const index = this.registered.indexOf(tool)
      if (index >= 0) this.registered.splice(index, 1)
    }
  }
}

export class FakeSkills extends Service {
  providers: Array<{ name: string; list: Function; get: Function }> = []

  constructor(ctx: Context) {
    super(ctx, 'skills')
  }

  registerProvider(create: (control: { signal: AbortSignal; invalidate: () => void }) => { name: string; list: Function; get: Function }): () => void {
    const provider = create({ signal: new AbortController().signal, invalidate: () => undefined })
    this.providers.push(provider)
    return () => {
      this.providers = this.providers.filter(item => item !== provider)
    }
  }
}

export class FakeCommands extends Service {
  readonly registered: Array<{ name: string; handler: Function; description: string; recordInput?: boolean }> = []

  constructor(ctx: Context) {
    super(ctx, 'commands')
  }

  register(definition: { name: string; handler: Function; description: string; recordInput?: boolean }): () => void {
    this.registered.push(definition)
    return () => {
      const index = this.registered.indexOf(definition)
      if (index >= 0) this.registered.splice(index, 1)
    }
  }
}

export class FakeSubprocess extends Service {
  exitCode = 0
  spawnError: string | undefined
  lastSpecs: SubprocessSpawnSpec[] = []

  constructor(ctx: Context) {
    super(ctx, 'subprocess')
  }

  resolveExecutable(command: string): Promise<string> {
    if (this.spawnError !== undefined) return Promise.reject(new Error(this.spawnError))
    return Promise.resolve(command)
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.lastSpecs.push(spec)
    if (this.spawnError !== undefined) throw new Error(this.spawnError)
    const outcome: SubprocessOutcome = { exitCode: this.exitCode, signal: null }
    const empty = { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) }
    return {
      pid: 1,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: { stdout: empty, stderr: empty },
      done: Promise.resolve(outcome),
      terminate: () => undefined,
      waitForExit: () => Promise.resolve(true),
    }
  }

  spawnTerminal(): Promise<never> {
    return Promise.reject(new Error('spawnTerminal is not used by uncle-bob tests'))
  }
}

export class FakeSubagents extends Service {
  readonly providers = new Map<string, SubagentProvider>()
  readonly starts: SubagentStartRequest[] = []

  constructor(ctx: Context) {
    super(ctx, 'subagents')
  }

  getProvider(name: string): SubagentProvider | undefined {
    return this.providers.get(name)
  }

  registerProvider(provider: SubagentProvider): () => void {
    this.providers.set(provider.name, provider)
    return () => this.providers.delete(provider.name)
  }

  async start(name: string, request: SubagentStartRequest): Promise<SubagentRun> {
    const provider = this.providers.get(name)
    if (provider === undefined) throw new Error(`provider "${name}" is not registered`)
    this.starts.push(request)
    return provider.start(request as never)
  }
}

export class StubProvider implements SubagentProvider {
  readonly name: string
  readonly capabilities: SubagentCapabilities
  readonly inheritsParentContext: boolean
  readonly requests: SubagentStartRequest[] = []
  structured: unknown = {
    status: 'complete',
    summary: 'stub complete',
    artifactsWritten: ['acceptance.feature'],
    evidence: ['wrote files'],
    blocker: '',
  }
  stopReason: SubagentResult['stopReason'] = 'completed'
  hang: Promise<void> | undefined
  onStart: ((request: SubagentStartRequest) => void | Promise<void>) | undefined
  disposed = 0

  constructor(options?: { name?: string; outputSchema?: boolean; inheritsParentContext?: boolean }) {
    this.name = options?.name ?? 'spawn'
    this.capabilities = {
      outputSchema: options?.outputSchema ?? true,
      depthLimit: true,
      toolFilter: true,
      persona: true,
    }
    this.inheritsParentContext = options?.inheritsParentContext ?? false
  }

  async start(request: SubagentStartRequest): Promise<SubagentRun> {
    this.requests.push(request)
    if (this.onStart !== undefined) await this.onStart(request)
    if (this.hang !== undefined) await this.hang
    const result: SubagentResult = {
      output: [],
      structured: this.structured,
      stopReason: this.stopReason,
    }
    return {
      id: SessionId(`child-${this.requests.length}`),
      localAgent: undefined,
      result: Promise.resolve(result),
      dispose: () => {
        this.disposed += 1
        return Promise.resolve()
      },
    }
  }
}

/**
 * Minimal Agent for director tests.
 * @param cwd - workspace.
 * @param id - session id.
 * @returns a structurally sufficient Agent.
 */
export function mockAgent(cwd: string, id = 'sess-1'): Agent {
  return {
    id: SessionId(id),
    options: {},
    session: {
      id: SessionId(id),
      header: { version: 0, id: SessionId(id), createdAt: 0, cwd },
    },
  } as unknown as Agent
}

/**
 * Load the director plugin onto fake services.
 * @param options - config and provider.
 * @returns hooked context.
 */
export async function setupPlugin(options?: {
  config?: Partial<Config>
  provider?: StubProvider | false
}): Promise<{
  ctx: Context
  provider: StubProvider | undefined
  tools: FakeTools
  skills: FakeSkills
  commands: FakeCommands
  subagents: FakeSubagents
  subprocess: FakeSubprocess
}> {
  const ctx = new Context()
  await ctx.plugin(FakeTools)
  await ctx.plugin(FakeSkills)
  await ctx.plugin(FakeCommands)
  await ctx.plugin(FakeSubagents)
  await ctx.plugin(FakeSubprocess)
  const subagents = ctx.subagents as unknown as FakeSubagents
  const provider = options?.provider === false ? undefined : options?.provider ?? new StubProvider()
  if (provider !== undefined) subagents.registerProvider(provider)
  const config = resolveConfig({
    subagentProvider: provider?.name ?? 'spawn',
    ...options?.config,
  })
  await ctx.plugin(uncleBob, config)
  return {
    ctx,
    provider,
    tools: ctx.tools as unknown as FakeTools,
    skills: ctx.skills as unknown as FakeSkills,
    commands: ctx.commands as unknown as FakeCommands,
    subagents,
    subprocess: ctx.subprocess as unknown as FakeSubprocess,
  }
}
