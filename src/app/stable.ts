import { useRef } from 'react'

type AnyFunction = (...input: never[]) => unknown

/**
 * Returns `value` with every function replaced by one whose identity never changes and which calls the function
 * of the latest render. The workspace hook defines its handlers anew on each render; passed on as they are, they
 * would make every `memo` component render again whenever anything in the app changed (T95). A handler reached
 * this way always sees current state, so nothing can act on a stale closure.
 *
 * `except` names functions whose result is shown on screen and depends on state: their identity must change with
 * that state, or a `memo` component would keep showing the old result.
 */
export function useStableFunctions<T extends object>(value: T, except: readonly (keyof T)[] = []): T {
  const latest = useRef(value)
  latest.current = value
  const wrappers = useRef(new Map<keyof T, AnyFunction>())
  const result = {} as T
  for (const key of Object.keys(value) as (keyof T)[]) {
    const item = value[key]
    if (typeof item !== 'function' || except.includes(key)) { result[key] = item; continue }
    let wrapper = wrappers.current.get(key)
    if (!wrapper) {
      wrapper = ((...input: never[]) => (latest.current[key] as AnyFunction)(...input)) as AnyFunction
      wrappers.current.set(key, wrapper)
    }
    result[key] = wrapper as T[keyof T]
  }
  return result
}

/** The named properties of `value`, to hand a `memo` component only what it reads. */
export function pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  const result = {} as Pick<T, K>
  for (const key of keys) result[key] = value[key]
  return result
}
