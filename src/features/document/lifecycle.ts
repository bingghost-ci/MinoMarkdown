export type UnsavedAction = 'save' | 'discard' | 'cancel'

export async function mayLeaveDocument(action: UnsavedAction, save: () => Promise<boolean>): Promise<boolean> {
  if (action === 'discard') return true
  if (action === 'save') return await save()
  return false
}
