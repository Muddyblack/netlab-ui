import type { RunningLabInfo } from "../hooks/useAppData";

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : "/";
}

/** The topology file a running instance was started from, when known. */
export function runningLabTopologyPath(info: RunningLabInfo): string | null {
  if (info.path) return info.path;
  if (info.dir && info.topology) {
    return info.topology.startsWith("/") ? info.topology : `${trimSlash(info.dir)}/${info.topology}`;
  }
  return null;
}

/** Whether `info` (one `netlab status` instance) is the lab at `yamlPath`.
 *
 * netlab allows one running lab per directory and records that directory, so
 * the match is on the exact topology file when it is known, else on the
 * file's *own* directory. A prefix match would claim every lab in a
 * subfolder of a running lab as "running" too; a bare name match would claim
 * every same-named lab in other folders — the name is only a fallback when
 * netlab reported no location at all. */
export function runningLabMatches(info: RunningLabInfo, yamlPath?: string | null, labName?: string | null): boolean {
  if (yamlPath) {
    const exact = runningLabTopologyPath(info);
    if (exact) return exact === yamlPath;
    if (info.dir) return trimSlash(info.dir) === parentDir(yamlPath);
  }
  return !!labName && !!info.name && info.name === labName && !info.dir && !info.path;
}
