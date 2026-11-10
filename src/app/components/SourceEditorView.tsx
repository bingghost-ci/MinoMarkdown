import { useEffect, useRef, type RefObject } from 'react'
import { SourceEditor } from '../../features/source/SourceEditor'

type Props = { editorRef: RefObject<SourceEditor | null>; text: string; label: string; dark: boolean; onChange: () => void; onSelect: () => void }

/** Owns the editor instance. `text` is read once: the body stays out of React so large files type smoothly. */
export default function SourceEditorView({ editorRef, text, label, dark, onChange, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const latest = useRef({ onChange, onSelect, text, label, dark })
  latest.current = { onChange, onSelect, text, label, dark }
  useEffect(() => {
    const initial = latest.current
    const editor = new SourceEditor(host.current as HTMLDivElement, initial.text, initial.label, initial.dark, { onChange: () => latest.current.onChange(), onSelect: () => latest.current.onSelect() })
    editorRef.current = editor
    return () => {
      if (editorRef.current === editor) editorRef.current = null
      editor.destroy()
    }
  }, [editorRef])
  useEffect(() => { editorRef.current?.setDark(dark) }, [editorRef, dark])
  return <div ref={host} className="source-editor" />
}
