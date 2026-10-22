import type { FileReader } from '../files.js';

/** An in-memory {@link FileReader} for tests; it starts empty and never touches the disk. */
export class MemoryFiles implements FileReader {
  readonly #files = new Map<string, string>();

  /** Makes `path` a file with `text`; a directory exists once a file or {@link directory} is under it. */
  set(path: string, text: string): this {
    this.#files.set(path, text);
    return this;
  }

  /** Marks `path` as an existing directory, for example a repository's `.git`. */
  directory(path: string): this {
    this.#files.set(path, '');
    return this;
  }

  readText(path: string): Promise<string | undefined> {
    return Promise.resolve(this.#files.get(path));
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.#files.has(path));
  }
}
