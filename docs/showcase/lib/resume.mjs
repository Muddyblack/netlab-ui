import fs from "node:fs";
import path from "node:path";
import { fileHash, mediaFiles, sealManifest, verifyManifest } from "./recordings.mjs";

const FILE = "progress.json";
export function saveProgress(directory, progress) {
  const temp = path.join(directory, `${FILE}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(progress, null, 2) + "\n");
  fs.renameSync(temp, path.join(directory, FILE));
}

export function captureOptions(args) {
  return { themes: args.themes, videoTheme: args.videoTheme, video: args.video, previews: args.previews };
}

export function sceneHashes(features, directory) {
  return Object.fromEntries(features.map((f) => [f.id, fileHash(path.join(directory, f.file))]));
}

export function completeScene(directory, entry, feature, options) {
  if (!entry.shots?.length) throw new Error(`No screenshots completed for ${entry.id}`);
  for (const shot of entry.shots) {
    for (const theme of feature.themes ?? options.themes) {
      if (!shot.files[theme]) throw new Error(`Missing ${theme} screenshot for ${entry.id}/${shot.name}`);
    }
  }
  if (options.video && (!entry.clip || !entry.timing || (options.previews && !entry.preview))) {
    throw new Error(`Incomplete video capture for ${entry.id}`);
  }
  const manifest = sealManifest({ sourceHash: "checkpoint", features: [entry] }, directory);
  verifyManifest(manifest, directory, "checkpoint");
  return { entry: structuredClone(entry), files: manifest.files };
}

export function loadResume(directory, features, commonHash, hashes, restart) {
  const file = path.join(directory, FILE);
  if (!fs.existsSync(file)) throw new Error(`No resume checkpoint in ${directory}. Older captures cannot be safely resumed; start one new recording to enable checkpoints.`);
  const progress = JSON.parse(fs.readFileSync(file, "utf8"));
  const ids = features.map((f) => f.id);
  if (progress.version !== 1 || JSON.stringify(progress.featureIds) !== JSON.stringify(ids)) {
    throw new Error("Resume checkpoint version or feature order differs; start a new recording.");
  }
  // A fix to the app or the recorder must not throw away scenes that are
  // already done: keep them and say so. --restart <id> redoes earlier ones.
  const appChanged = progress.commonHash !== commonHash;
  if (!Array.isArray(progress.completed) || progress.completed.length > ids.length) throw new Error("Invalid completed-scene checkpoint");
  let start = progress.completed.length;
  for (const [index, scene] of progress.completed.entries()) {
    if (scene.entry.id !== ids[index]) throw new Error("Resume checkpoint is not a consecutive completed prefix");
    if (progress.sceneHashes[ids[index]] !== hashes[ids[index]]) start = Math.min(start, index);
  }
  if (restart) {
    const index = ids.indexOf(restart);
    if (index < 0) throw new Error(`Unknown restart feature: ${restart}`);
    if (index > start) throw new Error(`Cannot skip unfinished or changed scene ${ids[start]}; restart there or earlier.`);
    start = index;
  }
  start = resumeStart(features, start);
  // Completed artifacts are checked before deployment/build and again before copying.
  for (const scene of progress.completed.slice(0, start)) {
    for (const relative of mediaFiles({ features: [scene.entry] })) {
      if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..") || !relative.startsWith(scene.entry.id + "/")) throw new Error("Invalid checkpoint artifact path");
    }
    verifyManifest({ sourceHash: "checkpoint", features: [scene.entry], files: scene.files }, directory, "checkpoint");
    completeScene(directory, scene.entry, features[ids.indexOf(scene.entry.id)], progress.options);
  }
  return { directory, progress, start, appChanged };
}

export function copyCompleted(resume, output) {
  for (const scene of resume.progress.completed.slice(0, resume.start)) {
    for (const file of mediaFiles({ features: [scene.entry] })) {
      const dest = path.join(output, file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(resume.directory, file), dest);
      if (fileHash(dest) !== scene.files[file]) throw new Error(`Capture changed while copying ${file}`);
    }
  }
}

// A fresh workspace loses side effects such as the fault-test outage bands.
export function resumeStart(features, start) {
  while (features[start]?.resumeFrom) {
    const earlier = features.findIndex((f) => f.id === features[start].resumeFrom);
    if (earlier < 0 || earlier >= start) throw new Error("Invalid resume scene prerequisite");
    start = earlier;
  }
  return start;
}
