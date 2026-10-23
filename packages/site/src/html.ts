/**
 * Minimal HTML templating: every interpolated string is escaped unless it is `raw`.
 * The tag is not called `html` on purpose: Prettier would reformat the template, and
 * whitespace inside <pre> is content.
 */

class Markup {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export type Interpolation =
  string | number | Markup | readonly Interpolation[] | false | null | undefined;

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

export function raw(value: string): Markup {
  return new Markup(value);
}

function render(value: Interpolation): string {
  if (value === false || value === null || value === undefined) return '';
  if (value instanceof Markup) return value.value;
  if (Array.isArray(value)) return (value as readonly Interpolation[]).map(render).join('');
  return escapeHtml(String(value));
}

export function markup(strings: TemplateStringsArray, ...values: Interpolation[]): Markup {
  let out = '';
  strings.forEach((chunk, index) => {
    out += chunk;
    if (index < values.length) out += render(values[index]);
  });
  return new Markup(out);
}
