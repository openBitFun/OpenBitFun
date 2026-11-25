// Structural sharing for derived row lists.
//
// A list rebuilt from signals hands out new row objects every time, so a keyed
// `Each` re-renders every row even when one changed. These helpers keep the row
// object a list held before whenever the rebuilt row has the same fields, and
// keep the list itself when no row changed, so the signal or `computed` holding
// it reports no change at all. They compare one level deep: a row whose nested
// list was shared first (its own `reuseRows`) compares equal by identity.

/** Whether two flat records hold the same own fields with the same values (`===`). */
export function sameRecord(a: object, b: object): boolean {
  if (a === b) return true;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!(key in right) || left[key] !== right[key]) return false;
  }
  return true;
}

/** `held` when `fresh` has the same fields, else `fresh`. */
export function keepIfSame<T extends object>(held: T, fresh: T): T {
  return sameRecord(held, fresh) ? held : fresh;
}

/**
 * `next` with every row replaced by what `reuse` makes of it and the row
 * `previous` held under the same key (the first row of a key), and `previous`
 * itself when every resulting row is the one it held at the same position.
 */
export function reuseRows<T extends object>(
  previous: readonly T[] | undefined,
  next: readonly T[],
  keyOf: (row: T) => string,
  reuse: (held: T, fresh: T) => T = keepIfSame,
): T[] {
  if (!previous) return next as T[];
  const held = new Map<string, T>();
  for (const row of previous) {
    const key = keyOf(row);
    if (!held.has(key)) held.set(key, row);
  }
  let unchanged = previous.length === next.length;
  const rows = next.map((row, index) => {
    const old = held.get(keyOf(row));
    const kept = old ? reuse(old, row) : row;
    if (kept !== previous[index]) unchanged = false;
    return kept;
  });
  return unchanged ? (previous as T[]) : rows;
}
