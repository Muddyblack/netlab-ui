/** Monaco language id for a file path, by extension. */
export function languageForPath(path: string): string {
  if (/\.ya?ml$/i.test(path)) return "yaml";
  if (/\.json$/i.test(path)) return "json";
  if (/\.(sh|bash)$/i.test(path)) return "shell";
  if (/\.py$/i.test(path)) return "python";
  return "plaintext";
}
