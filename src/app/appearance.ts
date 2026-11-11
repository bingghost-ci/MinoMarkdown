import { readingStyles, type FontPresetId, type StyleId } from '../features/reading/styles'

export type { ThemeId } from '../features/reading/styles'

/** Theme menu entries: following the system first, then every reading style in catalog order. */
export const themeOptions: readonly { id: 'system' | StyleId; label: string }[] = [{ id: 'system', label: '跟随系统' }, ...readingStyles.map((style) => ({ id: style.id, label: style.name }))]

export type FontPreset = FontPresetId | 'auto' | 'system'
export const fontPresetOptions: readonly { id: FontPreset; label: string; note: string }[] = [
  { id: 'auto', label: '随风格', note: '使用当前阅读风格推荐的字体' },
  { id: 'song', label: '书宋', note: '思源宋体，适合长文与书稿' },
  { id: 'kai', label: '文楷', note: '霞鹜文楷，适合笔记与随笔' },
  { id: 'hei', label: '黑体', note: '苹方，适合技术文档' },
  { id: 'system', label: '系统字体', note: '从下方选择本机字体' },
]

export const fontOptions = [
  { id: 'system', label: '系统字体', note: '中英混排的稳妥选择', recommended: false },
  { id: 'pingfang', label: '苹方', note: '推荐中文日常写作', recommended: true },
  { id: 'songti', label: '宋体', note: '适合中文长文阅读', recommended: false },
  { id: 'kaiti', label: '楷体', note: '适合笔记与书写感', recommended: false },
  { id: 'yahei', label: '微软雅黑', note: '需本机安装，未安装时使用苹方', recommended: false },
  { id: 'georgia', label: 'Georgia', note: '推荐英文长文阅读', recommended: true },
  { id: 'avenir', label: 'Avenir Next', note: '适合简洁的英文界面', recommended: false },
  { id: 'serif', label: '通用衬线', note: '英文与中文衬线回退', recommended: false },
  { id: 'mono', label: '等宽字体', note: '适合代码与技术笔记', recommended: false },
] as const

export type EditorFontId = (typeof fontOptions)[number]['id']

export const fontFamilies: Record<EditorFontId, string> = {
  system: "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif",
  pingfang: "'PingFang SC', 'Hiragino Sans GB', sans-serif",
  songti: "'Songti SC', 'STSong', serif",
  kaiti: "'Kaiti SC', 'STKaiti', 'Songti SC', serif",
  yahei: "'Microsoft YaHei', 'PingFang SC', sans-serif",
  georgia: "Georgia, 'Songti SC', serif",
  avenir: "'Avenir Next', 'PingFang SC', sans-serif",
  serif: "Georgia, 'Songti SC', serif",
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}
