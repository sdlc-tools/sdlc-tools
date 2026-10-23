import { CliError } from './errors.js';
import type { Runtime } from './runtime.js';

export interface SecretOptions {
  /** What is being read, as it appears in messages: "API token". */
  readonly label: string;
  /** Shown before the hidden prompt; defaults to the label followed by a colon. */
  readonly prompt?: string;
}

/**
 * Reads a secret the user supplies, without it ever touching the command line:
 * typed at a hidden prompt when standard input is a terminal, read from the
 * pipe or file otherwise. The result is a single word; surrounding whitespace
 * (the newline `echo` adds) is removed, and nothing at all or anything with
 * whitespace inside is refused with a usage error, so no request is made with
 * input that cannot be a token. The message never includes the input.
 */
export async function readSecret(
  runtime: Pick<Runtime, 'stdin'>,
  options: SecretOptions,
): Promise<string> {
  const { stdin } = runtime;
  const raw = stdin.isTTY
    ? await stdin.readHidden(options.prompt ?? `${options.label}: `)
    : await stdin.readAll();
  const secret = raw.trim();
  const source = stdin.isTTY ? 'Nothing was typed' : 'Standard input was empty';

  if (secret === '') {
    throw new CliError('usage', `${source}: the ${options.label} is missing.`, {
      code: 'empty_secret',
      next: [
        stdin.isTTY
          ? `Run the command again and type the ${options.label} at the prompt.`
          : `Pipe the ${options.label} in on standard input.`,
      ],
    });
  }
  if (/\s/.test(secret)) {
    throw new CliError(
      'usage',
      `The ${options.label} must be a single word without spaces or line breaks.`,
      {
        code: 'invalid_secret',
        next: [`Check that you copied only the ${options.label}.`],
      },
    );
  }
  return secret;
}
