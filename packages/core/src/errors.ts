/**
 * Process exit codes shared by every sdlc-tools CLI. Codes are split where the
 * caller's next action differs: fix the invocation (2), sign in again (3),
 * request access (4), re-check the target (5), retry later (6, 7).
 */
export const ExitCode = {
  Ok: 0,
  Unexpected: 1,
  Usage: 2,
  Auth: 3,
  Permission: 4,
  NotFound: 5,
  Server: 6,
  Network: 7,
  Cancelled: 130,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export type ErrorKind =
  | 'usage'
  | 'config'
  | 'auth'
  | 'permission'
  | 'not-found'
  | 'server'
  | 'network'
  | 'cancelled'
  | 'unexpected';

const EXIT_CODE_BY_KIND: Readonly<Record<ErrorKind, ExitCode>> = {
  usage: ExitCode.Usage,
  config: ExitCode.Usage,
  auth: ExitCode.Auth,
  permission: ExitCode.Permission,
  'not-found': ExitCode.NotFound,
  server: ExitCode.Server,
  network: ExitCode.Network,
  cancelled: ExitCode.Cancelled,
  unexpected: ExitCode.Unexpected,
};

export interface CliErrorOptions {
  /** Stable machine-readable subtype within a kind, such as `no_credentials`. */
  readonly code?: string;
  /** Likely causes, most probable first. */
  readonly causes?: readonly string[];
  /** Concrete next steps the reader can take. */
  readonly next?: readonly string[];
  /** HTTP status of the response that produced this error. */
  readonly status?: number;
  /** Extra structured data; included in `--json` error output. */
  readonly details?: Readonly<Record<string, unknown>>;
  /** Command help appended to the text rendering of usage errors. */
  readonly usage?: string;
  readonly cause?: unknown;
}

export interface CliErrorJson {
  readonly kind: ErrorKind;
  readonly code?: string;
  readonly exitCode: ExitCode;
  readonly message: string;
  readonly status?: number;
  readonly causes?: readonly string[];
  readonly next?: readonly string[];
  readonly details?: Readonly<Record<string, unknown>>;
  readonly usage?: string;
}

/**
 * The one error type commands throw on purpose. Anything else that escapes a
 * command is reported as an unexpected error (exit code 1).
 */
export class CliError extends Error {
  readonly kind: ErrorKind;
  readonly exitCode: ExitCode;
  readonly code: string | undefined;
  readonly causes: readonly string[];
  readonly next: readonly string[];
  readonly status: number | undefined;
  readonly details: Readonly<Record<string, unknown>> | undefined;
  readonly usage: string | undefined;

  constructor(kind: ErrorKind, message: string, options: CliErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CliError';
    this.kind = kind;
    this.exitCode = EXIT_CODE_BY_KIND[kind];
    this.code = options.code;
    this.causes = options.causes ?? [];
    this.next = options.next ?? [];
    this.status = options.status;
    this.details = options.details;
    this.usage = options.usage;
  }

  /** A copy of this error carrying extra options; existing fields are kept unless overridden. */
  with(options: CliErrorOptions): CliError {
    return new CliError(this.kind, this.message, {
      ...(this.code === undefined ? {} : { code: this.code }),
      causes: this.causes,
      next: this.next,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.details === undefined ? {} : { details: this.details }),
      ...(this.usage === undefined ? {} : { usage: this.usage }),
      cause: this.cause,
      ...options,
    });
  }

  toJSON(): CliErrorJson {
    return {
      kind: this.kind,
      ...(this.code === undefined ? {} : { code: this.code }),
      exitCode: this.exitCode,
      message: this.message,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.causes.length === 0 ? {} : { causes: this.causes }),
      ...(this.next.length === 0 ? {} : { next: this.next }),
      ...(this.details === undefined ? {} : { details: this.details }),
      ...(this.usage === undefined ? {} : { usage: this.usage }),
    };
  }
}

export function isCliError(value: unknown): value is CliError {
  return value instanceof CliError;
}

/** Human-readable rendering printed to stderr. */
export function formatErrorText(error: CliError): string {
  const lines = [`error: ${error.message}`];
  if (error.causes.length > 0) {
    lines.push('', 'Likely causes:', ...error.causes.map((cause) => `  - ${cause}`));
  }
  if (error.next.length > 0) {
    lines.push('', 'Next steps:', ...error.next.map((step) => `  - ${step}`));
  }
  if (error.usage !== undefined) {
    lines.push('', error.usage.trimEnd());
  }
  return lines.join('\n');
}

export function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : JSON.stringify(error);
}
