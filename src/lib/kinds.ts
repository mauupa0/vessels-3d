export type TreeKind = 'artery' | 'vein' | 'pulmArtery' | 'pulmVein'
export const TREE_KINDS: TreeKind[] = ['artery', 'vein', 'pulmArtery', 'pulmVein']

// Arterial trees carry the pulse away from the heart; venous trees bring it back.
export const isArterial = (k: TreeKind) => k === 'artery' || k === 'pulmArtery'
// Colour convention of the atlas plates: oxygenated blood red, deoxygenated blue.
export const isOxygenated = (k: TreeKind) => k === 'artery' || k === 'pulmVein'
export const sideOf = (k: TreeKind): 'arteries' | 'veins' => (isArterial(k) ? 'arteries' : 'veins')
