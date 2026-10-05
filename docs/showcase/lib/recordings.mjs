// A recording belongs to the source files it captured, including local edits.
// Git revisions alone miss exactly the UI changes the showcase demonstrates.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export function validateFeatureOrder(files, order) {
  const issues = [
    ["not listed", files.filter((file) => !order.includes(file))],
    ["file does not exist", order.filter((file) => !files.includes(file))],
    ["listed more than once", [...new Set(order.filter((file, index) => order.indexOf(file) !== index))]],
  ].filter(([, names]) => names.length);
  if (issues.length) {
    throw new Error(`features/index.mjs: ${issues.map(([issue, names]) => `${issue}: ${names.join(", ")}`).join("; ")}`);
  }
}

function filesUnder(root, relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) return [];
  if (!fs.statSync(file).isDirectory()) return [relative];
  return fs.readdirSync(file).sort().flatMap((name) =>
    name === "__pycache__" ? [] : filesUnder(root, path.join(relative, name)));
}

export function fileHash(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function sourceHash(root = REPO, { excludeFeatures = false } = {}) {
  const inputs = [
    "frontend/src", "frontend/public", "frontend/patches", "frontend/index.html",
    "frontend/package.json", "frontend/package-lock.json", "frontend/vite.config.ts",
    "frontend/tsconfig.json", "frontend/tsconfig.app.json", "frontend/tsconfig.node.json",
    "backend/app", "backend/services", "backend/pyproject.toml", "monitoring/plugin", "flake.nix", "flake.lock",
    "docs/showcase/features", "docs/showcase/labs", "docs/showcase/lib",
    "docs/showcase/showcase.mjs", "docs/showcase/run.sh", "docs/showcase/package.json",
  ];
  const hash = createHash("sha256");
  for (const file of inputs.flatMap((input) => filesUnder(root, input)).sort()) {
    if (file.endsWith(".test.mjs") || file.endsWith(".pyc")) continue;
    if (excludeFeatures && file.startsWith("docs/showcase/features/")) continue;
    hash.update(file).update("\0").update(fileHash(path.join(root, file))).update("\0");
  }
  return hash.digest("hex");
}

export function mediaFiles(manifest) {
  return [manifest.video, ...manifest.features.flatMap((feature) => [
    feature.clip, feature.preview, feature.timing,
    ...feature.shots.flatMap((shot) => Object.values(shot.files)),
  ])].filter(Boolean);
}

export function sealManifest(manifest, directory) {
  manifest.files = Object.fromEntries(mediaFiles(manifest).map((file) => [file, fileHash(path.join(directory, file))]));
  return manifest;
}

export function verifyManifest(manifest, directory, currentSource, { featureIds, requireVideo = false, allowSourceChange = false } = {}) {
  // allowSourceChange: reuse clips recorded from older source (their files and
  // hashes are still verified) so a fix only needs its own scenes re-recorded.
  if (manifest.sourceHash !== currentSource && !allowSourceChange) {
    throw new Error("Showcase media does not match the current source. Run docs/showcase/run.sh for a fresh full recording.");
  }
  if (featureIds && JSON.stringify(manifest.features.map((f) => f.id)) !== JSON.stringify(featureIds)) {
    throw new Error("Showcase feature order or coverage is incomplete; run the full showcase.");
  }
  for (const feature of manifest.features) {
    if (!feature.shots.length) throw new Error(`Missing screenshots: ${feature.id}`);
    if (requireVideo && (!feature.clip || !feature.preview || !feature.timing)) {
      throw new Error(`Missing clip, preview or caption timings: ${feature.id}`);
    }
  }
  if (requireVideo && !manifest.video) throw new Error("Missing combined showcase video");
  for (const file of mediaFiles(manifest)) {
    const full = path.join(directory, file);
    if (!fs.existsSync(full) || manifest.files?.[file] !== fileHash(full)) {
      throw new Error(`Missing or changed showcase media: ${file}; regenerate the showcase.`);
    }
  }
  for (const feature of manifest.features) {
    if (!feature.timing) continue;
    const timing = JSON.parse(fs.readFileSync(path.join(directory, feature.timing), "utf8"));
    previewStart(timing);
    for (const caption of timing.captions) {
      if (caption.visibleSeconds + 0.001 < caption.minSeconds) {
        throw new Error(`Caption is too short in ${feature.id}: ${caption.text}`);
      }
    }
  }
}

/** Use the recorded end of the title's fade, never a guessed skip time. */
export function previewStart(timing) {
  const title = timing.captions.find((caption) => caption.kind === "title");
  if (!title || !Number.isFinite(timing.contentStartSeconds) || timing.contentStartSeconds < title.endSeconds || timing.contentStartSeconds >= timing.duration) {
    throw new Error("Recording has no valid end-of-title marker; regenerate it before making a preview.");
  }
  return timing.contentStartSeconds;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(sourceHash());
}
