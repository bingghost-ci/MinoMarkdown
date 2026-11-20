import type { ReactNode } from 'react'

/** The rows and switches of the settings, shared by the settings pages and the floating appearance panel. */

/** One choice out of a few, as a row of buttons. `label` names the group for assistive technology. */
export function Segmented<T extends string | boolean>({ value, options, onChange, t, className = 'settings-segmented', label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void; t: (text: string) => string; className?: string; label?: string }) {
  return <div className={className} role={label ? 'group' : undefined} aria-label={label}>{options.map(([option, text]) => <button key={String(option)} type="button" aria-pressed={value === option} onClick={() => onChange(option)}>{t(text)}</button>)}</div>
}

/** A setting: its name, an optional note under it, and its control. */
export function Row({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <div className="settings-row"><span>{title}{note && <small>{note}</small>}</span>{children}</div>
}

/** A setting that is on or off. The whole row is the label of its checkbox. */
export function ToggleRow({ title, note, checked, onChange }: { title: string; note?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="settings-row settings-toggle"><span>{title}{note && <small>{note}</small>}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>
}
