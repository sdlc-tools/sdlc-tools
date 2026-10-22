import {
  toFlagName,
  type Cli,
  type Command,
  type Group,
  type OptionSpec,
  type PositionalSpec,
} from './command.js';

interface Row {
  readonly label: string;
  readonly text: string;
}

function table(rows: readonly Row[]): string[] {
  const width = Math.max(...rows.map((row) => row.label.length));
  return rows.map((row) => `  ${row.label.padEnd(width)}  ${row.text}`.trimEnd());
}

function section(title: string, body: readonly string[]): string[] {
  return body.length === 0 ? [] : ['', `${title}:`, ...body];
}

function positionalUsage(spec: PositionalSpec): string {
  const label = toFlagName(spec.name);
  const name = spec.variadic === true ? `${label}...` : label;
  return spec.required === true ? `<${name}>` : `[${name}]`;
}

function valueLabel(spec: OptionSpec): string {
  if (spec.choices !== undefined) return `<${spec.choices.join('|')}>`;
  return `<${spec.valueName ?? 'value'}>`;
}

function optionLabel(key: string, spec: OptionSpec): string {
  const short = spec.short === undefined ? '    ' : `-${spec.short}, `;
  return `${short}--${toFlagName(key)}${spec.type === 'string' ? ` ${valueLabel(spec)}` : ''}`;
}

function optionText(spec: OptionSpec): string {
  const notes = [
    spec.required === true ? 'required' : undefined,
    spec.multiple === true ? 'repeatable' : undefined,
    spec.default === undefined ? undefined : `default: ${spec.default}`,
  ].filter((note) => note !== undefined);
  return notes.length === 0 ? spec.description : `${spec.description} (${notes.join(', ')})`;
}

export function renderCommandHelp(path: readonly string[], command: Command): string {
  const name = path.join(' ');
  const usage = [name, ...command.positionals.map(positionalUsage), '[options]'].join(' ');
  const options: Row[] = [
    ...Object.entries(command.options).map(([key, spec]) => ({
      label: optionLabel(key, spec),
      text: optionText(spec),
    })),
    { label: '    --json', text: 'Print the full result as JSON instead of a short summary' },
    { label: '-h, --help', text: 'Show this help' },
  ];

  return [
    `${name} - ${command.summary}`,
    ...(command.description === undefined ? [] : ['', command.description]),
    '',
    'Usage:',
    `  ${usage}`,
    ...section(
      'Arguments',
      command.positionals.length === 0
        ? []
        : table(
            command.positionals.map((spec) => ({
              label: positionalUsage(spec),
              text: spec.description,
            })),
          ),
    ),
    ...section('Options', table(options)),
    ...section(
      'Examples',
      command.examples.map((example) => `  $ ${example}`),
    ),
  ].join('\n');
}

export function renderGroupHelp(path: readonly string[], group: Group | Cli): string {
  const name = path.join(' ');
  const options: Row[] = [{ label: '-h, --help', text: 'Show this help' }];
  if (group.kind === 'cli') options.push({ label: '-V, --version', text: 'Print the version' });

  return [
    `${name} - ${group.summary}`,
    ...(group.description === undefined ? [] : ['', group.description]),
    '',
    'Usage:',
    `  ${name} <command> [options]`,
    ...section(
      'Commands',
      table(group.commands.map((node) => ({ label: node.name, text: node.summary }))),
    ),
    ...section('Options', table(options)),
    '',
    `Run '${name} <command> --help' for details on a command.`,
  ].join('\n');
}
