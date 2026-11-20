import { vi } from 'vitest'
import { Editor, parserCtx, SchemaReady, schemaCtx, SerializerReady, serializerCtx } from '@milkdown/kit/core'
import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import type { Node as ProseNode, Schema } from '@milkdown/kit/prose/model'

export type MilkdownPipeline = {
  schema: Schema
  parse: (markdown: string) => ProseNode
  serialize: (doc: ProseNode) => string
  /** Markdown through the parser and back, as a save of an unedited document writes it. */
  roundTrip: (markdown: string) => string
}

/**
 * Boots the real Milkdown schema, parser and serializer without a DOM: only the view fails to start, and that
 * failure is ignored. Milkdown's startup timers signal through window events, so those are stubbed; a test that
 * needs the globals back calls `vi.unstubAllGlobals()` afterwards.
 *
 * `configure` runs as `Editor.config` does, and `plugins` are added after CommonMark and GFM.
 */
export function bootMilkdown({ configure, plugins = [] }: { configure?: (ctx: Ctx) => void; plugins?: readonly (MilkdownPlugin | MilkdownPlugin[])[] } = {}): Promise<MilkdownPipeline> {
  const events = new EventTarget()
  vi.stubGlobal('document', { body: {} })
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events))
  vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events))
  vi.stubGlobal('dispatchEvent', events.dispatchEvent.bind(events))
  return new Promise((resolve) => {
    const capture: MilkdownPlugin = (ctx) => async () => {
      await ctx.wait(SchemaReady)
      await ctx.wait(SerializerReady)
      const parse = ctx.get(parserCtx)
      const serialize = ctx.get(serializerCtx)
      resolve({ schema: ctx.get(schemaCtx), parse, serialize, roundTrip: (markdown) => serialize(parse(markdown)) })
    }
    let editor = Editor.make()
    if (configure) editor = editor.config(configure)
    editor = editor.use(commonmark).use(gfm)
    for (const plugin of plugins) editor = editor.use(plugin)
    void editor.use(capture).create().catch(() => undefined)
  })
}
