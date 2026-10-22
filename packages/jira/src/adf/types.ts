export interface AdfMark {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
}

export interface AdfNode {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly content?: readonly AdfNode[];
  readonly text?: string;
  readonly marks?: readonly AdfMark[];
}

export interface AdfDocument {
  readonly type: 'doc';
  readonly version: 1;
  readonly content: readonly AdfNode[];
}
