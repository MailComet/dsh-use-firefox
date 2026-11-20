import z from '@deepseek-ai/schemastery'
import { createRuntime } from './runtime.js'
import { registerTools } from './tools.js'
import { GUIDE } from './guide.js'
import { registerAnnotationRoutes } from './routes.js'

export const name = 'use-firefox'

export const inject = ['tools', 'systemPrompt']

export const Config = z.object({
  home: z.string().default(''),
  mode: z.string().default('full'),
  bridgePort: z.number().default(39271),
  groupTitle: z.string().default('DSH'),
  groupColor: z.string().default('blue'),
  maxSnapshotChars: z.number().default(20000),
  requestTimeoutMs: z.number().default(60000),
  annotationTimeoutMs: z.number().default(120000),
  audit: z.boolean().default(true),
})

export async function apply(ctx, config) {
  const runtime = await createRuntime(ctx, config)

  ctx.systemPrompt.section({
    name: 'dsh-use-firefox:guide',
    order: 4001,
    text: GUIDE,
    interpolate: false,
  })

  registerTools(ctx, runtime)

  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    runtime.noteAgent(agent)
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const mentioned = await runtime.prepareAnnotationMentions(decision.messages)
    const pending = runtime.takePendingAnnotations(agent)
    if (mentioned === decision.messages && pending.length === 0) return decision
    return { ...decision, messages: [...mentioned, ...pending] }
  })

  ctx.effect(() => {
    void runtime.start()
    return () => {
      void runtime.dispose()
    }
  }, 'dsh-use-firefox: bridge')

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => registerAnnotationRoutes(webCtx.webServer, runtime),
      'dsh-use-firefox: annotation routes',
    )
  })
}
