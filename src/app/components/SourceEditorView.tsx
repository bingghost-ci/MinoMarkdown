import { useEffect, useRef, type RefObject } from 'react'
import { SourceEditor, type SourceLanguage } from '../../features/source/SourceEditor'

type Props = { editorRef: RefObject<SourceEditor | null>; text: string; label: string; dark: boolean; onChange: () => void; onSelect: () => void; /** Markdown source by default; a text or source file passes its name instead (T84, T85). */ fileName?: string; readOnly?: boolean }

/** Owns the editor instance. `text` is read once: the body stays out of React so large files type smoothly. */
export default function SourceEditorView({ editorRef, text, label, dark, onChange, onSelect, fileName, readOnly = false }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const latest = useRef({ onChange, onSelect, text, label, dark, fileName, readOnly })
  latest.current = { onChange, onSelect, text, label, dark, fileName, readOnly }
  useEffect(() => {
    const initial = latest.current
    const editor = new SourceEditor(host.current as HTMLDivElement, initial.text, initial.label, initial.dark, { onChange: () => latest.current.onChange(), onSelect: () => latest.current.onSelect() }, (initial.fileName === undefined ? 'markdown' : 'plain') satisfies SourceLanguage, initial.readOnly)
    editorRef.current = editor
    let disposed = false
    // A source file gets its colors from the language packages the editor already ships; a text file has none.
    if (initial.fileName !== undefined) void import('@codemirror/language').then(async ({ LanguageDescription }) => {
      const { languages } = await import('@codemirror/language-data')
      const support = await LanguageDescription.matchFilename(languages, initial.fileName ?? '')?.load()
      if (support && !disposed) editor.setLanguage(support)
    }).catch(() => undefined)
    return () => {
      disposed = true
      if (editorRef.current === editor) editorRef.current = null
      editor.destroy()
    }
  }, [editorRef])
  useEffect(() => { editorRef.current?.setDark(dark) }, [editorRef, dark])
  useEffect(() => { if (editorRef.current) editorRef.current.readOnly = readOnly }, [editorRef, readOnly])
  return <div ref={host} className="source-editor" />
}
