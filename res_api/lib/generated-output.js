import { mkdirSync, rmSync } from 'node:fs';

/** Reset a generated directory so a failed refresh cannot reuse yesterday's files. */
export function resetGeneratedDirectory(directory) {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
}

/** Remove a generated artifact before attempting to rebuild it. */
export function removeGeneratedFile(file) {
  rmSync(file, { force: true });
}
