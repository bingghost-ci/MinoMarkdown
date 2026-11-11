export const themeOptions = [
  { id: 'system', label: '跟随系统' },
  { id: 'light', label: '浅色' },
  { id: 'mint', label: '护眼绿' },
  { id: 'butter', label: '护眼黄' },
  { id: 'paper', label: '暖纸' },
  { id: 'eink', label: '水墨屏' },
  { id: 'blueprint', label: '科技蓝白' },
  { id: 'dark', label: '深色' },
  { id: 'graphite', label: '夜间护眼' },
] as const

export type ThemeId = (typeof themeOptions)[number]['id']

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
