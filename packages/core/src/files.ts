import { readFile, stat } from 'node:fs/promises';

/**
 * Read access to the files a command looks for on its own, such as
 * configuration files. It is part of the {@link Runtime} so that tests answer
 * from memory instead of the disk, whose latency they cannot control.
 */
export interface FileReader {
  /** The file's text, or `undefined` when nothing exists at `path`. Other failures reject. */
  readText(path: string): Promise<string | undefined>;
  exists(path: string): Promise<boolean>;
}

export const nodeFiles: FileReader = {
  async readText(path) {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  },
  exists: (path) =>
    stat(path).then(
      () => true,
      () => false,
    ),
};
