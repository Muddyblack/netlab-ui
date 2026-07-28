import type { FileSystemAdapter } from "@srl-labs/clab-ui/session";

const DEMO_FS_PREFIX = "netlab:demo-fs:";

export function normalizePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/\/+/g, "/");
  const withLeadingSlash = normalized.startsWith("/") ? normalized : "/" + normalized;
  return withLeadingSlash.replace(/\/$/, "") || "/";
}

export function dirname(filePath: string): string {
  const normalized = normalizePath(filePath);
  const idx = normalized.lastIndexOf("/");
  return idx <= 0 ? "/" : normalized.slice(0, idx);
}

export function basename(filePath: string): string {
  const normalized = normalizePath(filePath);
  const idx = normalized.lastIndexOf("/");
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

export function join(...segments: string[]): string {
  return normalizePath(segments.filter(Boolean).join("/"));
}

export class BrowserStorageFs implements FileSystemAdapter {
  async readFile(filePath: string): Promise<string> {
    const content = window.localStorage.getItem(this.key(filePath));
    if (content === null) {
      const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`) as Error & {
        code: string;
      };
      error.code = "ENOENT";
      throw error;
    }
    return content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    window.localStorage.setItem(this.key(filePath), content);
  }

  async unlink(filePath: string): Promise<void> {
    window.localStorage.removeItem(this.key(filePath));
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const content = await this.readFile(oldPath);
    await this.writeFile(newPath, content);
    await this.unlink(oldPath);
  }

  async exists(filePath: string): Promise<boolean> {
    return window.localStorage.getItem(this.key(filePath)) !== null;
  }

  dirname(filePath: string): string {
    return dirname(filePath);
  }

  basename(filePath: string): string {
    return basename(filePath);
  }

  join(...segments: string[]): string {
    return join(...segments);
  }

  private key(filePath: string): string {
    return DEMO_FS_PREFIX + normalizePath(filePath);
  }
}
