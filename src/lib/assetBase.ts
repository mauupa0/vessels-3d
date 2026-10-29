import type { AnatomyMeta } from './anatomy'

export const BASE = import.meta.env.BASE_URL + 'anatomy/'

export async function fetchMeta(): Promise<AnatomyMeta> {
  const r = await fetch(BASE + 'anatomy.json')
  if (!r.ok) throw new Error('anatomy.json: HTTP ' + r.status)
  return r.json()
}
