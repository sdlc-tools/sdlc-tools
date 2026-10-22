/** A comma separated setting as a list; blank items are dropped. */
export function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/**
 * Like `splitList`, but a comma inside parentheses or brackets belongs to the item: CI systems name
 * a matrix job "build (node 22, linux)", and that is one status context, not two.
 */
export function splitOutsideBrackets(value: string | undefined): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value ?? '') {
    if (char === '(' || char === '[') depth += 1;
    else if ((char === ')' || char === ']') && depth > 0) depth -= 1;
    if (char === ',' && depth === 0) {
      items.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  items.push(current);
  return items.map((item) => item.trim()).filter((item) => item !== '');
}

/** All items in order, each user once; Forgejo logins that differ only in case are the same user. */
export function mergeLogins(...lists: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  return lists.flat().filter((login) => {
    const key = login.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
