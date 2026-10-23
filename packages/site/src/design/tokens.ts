/**
 * The design system's two token layers. Components never see the first one.
 *
 * - Primitive tokens (`--prim-*`) are the raw palette and scales. They carry no
 *   meaning and do not change with the theme.
 * - Semantic tokens (`--color-*`, `--space-*`, `--text-*` ...) say what a value is
 *   for. A theme is a different mapping from semantic tokens to primitives; the
 *   stylesheets in `styles/` reference semantic tokens only.
 */

export const primitives = {
  'prim-white': '#ffffff',
  'prim-slate-50': '#f8fafc',
  'prim-slate-100': '#f1f5f9',
  'prim-slate-300': '#cbd5e1',
  'prim-slate-400': '#94a3b8',
  'prim-slate-500': '#64748b',
  'prim-slate-600': '#475569',
  'prim-slate-700': '#334155',
  'prim-slate-800': '#1e293b',
  'prim-slate-900': '#0f172a',
  'prim-slate-950': '#020617',
  'prim-teal-200': '#99f6e4',
  'prim-teal-300': '#5eead4',
  'prim-teal-700': '#0f766e',
  'prim-teal-800': '#115e59',
} as const;

export type PrimitiveColor = keyof typeof primitives;

/** Sizes and spacing are unitless-theme values: the same in both themes. */
export const scales = {
  'prim-font-sans':
    'system-ui, -apple-system, "Segoe UI", Roboto, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif',
  'prim-font-mono':
    'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  'prim-size-100': '0.875rem',
  'prim-size-200': '1rem',
  'prim-size-300': '1.125rem',
  'prim-size-400': '1.25rem',
  'prim-size-500': '1.625rem',
  'prim-size-900': 'clamp(2rem, 1.25rem + 3.5vw, 3.25rem)',
  'prim-space-1': '0.25rem',
  'prim-space-2': '0.5rem',
  'prim-space-3': '0.75rem',
  'prim-space-4': '1rem',
  'prim-space-6': '1.5rem',
  'prim-space-8': '2rem',
  'prim-space-12': '3rem',
  'prim-space-fluid': 'clamp(3rem, 2rem + 5vw, 6rem)',
  'prim-radius-1': '0.375rem',
  'prim-radius-2': '0.75rem',
  'prim-measure': '68ch',
  'prim-container': '72rem',
} as const;

type ScaleName = keyof typeof scales;

/** Theme-independent semantic tokens, each an alias of a scale value. */
export const semanticShared = {
  'font-body': 'prim-font-sans',
  'font-code': 'prim-font-mono',
  'text-small': 'prim-size-100',
  'text-body': 'prim-size-200',
  'text-lead': 'prim-size-300',
  'text-subheading': 'prim-size-400',
  'text-heading': 'prim-size-500',
  'text-display': 'prim-size-900',
  'space-tight': 'prim-space-2',
  'space-control': 'prim-space-3',
  'space-gap': 'prim-space-4',
  'space-stack': 'prim-space-6',
  'space-block': 'prim-space-8',
  'space-region': 'prim-space-12',
  'space-section': 'prim-space-fluid',
  'radius-control': 'prim-radius-1',
  'radius-surface': 'prim-radius-2',
  'size-measure': 'prim-measure',
  'size-container': 'prim-container',
} as const satisfies Record<string, ScaleName>;

/** Literal values that carry no palette or scale meaning of their own. */
export const semanticLiterals = {
  'leading-body': '1.6',
  'leading-heading': '1.2',
  'size-target': '2.75rem',
  'size-gutter': '1rem',
  'width-border': '1px',
  'width-focus': '3px',
  'offset-focus': '3px',
} as const;

export const colorRoles = [
  'bg',
  'surface',
  'text',
  'text-muted',
  'border',
  'border-strong',
  'link',
  'link-hover',
  'focus',
  'button-bg',
  'button-bg-hover',
  'button-text',
  'code-bg',
  'code-text',
  'code-muted',
  'code-accent',
] as const;

export type ColorRole = (typeof colorRoles)[number];
export type Theme = Readonly<Record<ColorRole, PrimitiveColor>>;

export const light: Theme = {
  bg: 'prim-white',
  surface: 'prim-slate-50',
  text: 'prim-slate-900',
  'text-muted': 'prim-slate-600',
  border: 'prim-slate-300',
  'border-strong': 'prim-slate-500',
  link: 'prim-teal-700',
  'link-hover': 'prim-teal-800',
  focus: 'prim-slate-900',
  'button-bg': 'prim-teal-700',
  'button-bg-hover': 'prim-teal-800',
  'button-text': 'prim-white',
  'code-bg': 'prim-slate-100',
  'code-text': 'prim-slate-900',
  'code-muted': 'prim-slate-600',
  'code-accent': 'prim-teal-700',
};

export const dark: Theme = {
  bg: 'prim-slate-900',
  surface: 'prim-slate-800',
  text: 'prim-slate-100',
  'text-muted': 'prim-slate-400',
  border: 'prim-slate-700',
  'border-strong': 'prim-slate-400',
  link: 'prim-teal-300',
  'link-hover': 'prim-teal-200',
  focus: 'prim-teal-300',
  'button-bg': 'prim-teal-300',
  'button-bg-hover': 'prim-teal-200',
  'button-text': 'prim-slate-900',
  'code-bg': 'prim-slate-950',
  'code-text': 'prim-slate-100',
  'code-muted': 'prim-slate-400',
  'code-accent': 'prim-teal-300',
};

/**
 * WCAG 2.2 contrast requirements per pair of roles: 4.5 for text (1.4.3), 3 for
 * the boundaries and indicators a person needs to find a control (1.4.11, 2.4.11).
 * `border` only decorates a surface that is already distinguishable by its fill
 * and content, so it is deliberately absent; every other role must be listed.
 */
export const contrastRequirements: readonly (readonly [ColorRole, ColorRole, number])[] = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['text-muted', 'bg', 4.5],
  ['text-muted', 'surface', 4.5],
  ['link', 'bg', 4.5],
  ['link', 'surface', 4.5],
  ['link-hover', 'bg', 4.5],
  ['link-hover', 'surface', 4.5],
  ['button-text', 'button-bg', 4.5],
  ['button-text', 'button-bg-hover', 4.5],
  ['code-text', 'code-bg', 4.5],
  ['code-muted', 'code-bg', 4.5],
  ['code-accent', 'code-bg', 4.5],
  ['border-strong', 'bg', 3],
  ['border-strong', 'surface', 3],
  ['button-bg', 'bg', 3],
  ['button-bg', 'surface', 3],
  ['focus', 'bg', 3],
  ['focus', 'surface', 3],
];

export const decorativeRoles: readonly ColorRole[] = ['border'];

function declarations(entries: readonly (readonly [string, string])[]): string {
  return entries.map(([name, value]) => `  --${name}: ${value};`).join('\n');
}

const themeDeclarations = (theme: Theme): string =>
  declarations(colorRoles.map((role) => [`color-${role}`, `var(--${theme[role]})`]));

/** The token layer of the stylesheet: primitives, shared semantics, then each theme. */
export function tokensCss(): string {
  const palette = declarations(Object.entries(primitives));
  const scale = declarations(Object.entries(scales));
  const shared = declarations([
    ...Object.entries(semanticShared).map(([name, alias]) => [name, `var(--${alias})`] as const),
    ...Object.entries(semanticLiterals),
  ]);
  return `:root {
  color-scheme: light dark;
${palette}
${scale}
${shared}
${themeDeclarations(light)}
}

@media (prefers-color-scheme: dark) {
  :root {
${themeDeclarations(dark).replace(/^/gm, '  ')}
  }
}
`;
}
