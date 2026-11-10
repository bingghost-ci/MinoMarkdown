import type { EditorCommand } from '../features/editor/EditorAdapter'
import type { TextTransform } from '../features/editor/textTransform'

/** Native Format menu items that map one-to-one onto editor commands. */
export const formatMenuCommands: Readonly<Record<string, EditorCommand>> = {
  'format-paragraph': 'paragraph',
  'format-heading1': 'heading1',
  'format-heading2': 'heading2',
  'format-heading3': 'heading3',
  'format-heading4': 'heading4',
  'format-heading5': 'heading5',
  'format-heading6': 'heading6',
  'format-bold': 'bold',
  'format-italic': 'italic',
  'format-strike': 'strike',
  'format-inline-code': 'inlineCode',
  'format-bullet': 'bullet',
  'format-ordered': 'ordered',
  'format-task': 'task',
  'format-quote': 'quote',
  'format-code-block': 'codeBlock',
}

export const transformMenuActions: Readonly<Record<string, TextTransform>> = {
  'transform-upper': 'upper',
  'transform-lower': 'lower',
  'transform-title': 'title',
  'transform-cjk-spacing': 'cjkSpacing',
  'transform-full-punct': 'fullPunct',
  'transform-half-punct': 'halfPunct',
}
