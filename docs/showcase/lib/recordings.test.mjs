import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { previewStart, sealManifest, sourceHash, validateFeatureOrder, verifyManifest } from "./recordings.mjs";
import featureOrder from "../features/index.mjs";

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "showcase-recordings-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("the tour draws first, deploys second, and keeps later scenes deployed", async () => {
  const features = await Promise.all(featureOrder.map(async (file) => (await import(`../features/${file}`)).default));
  assert.deepEqual(features.slice(0, 2).map((f) => [f.id, f.state]), [["canvas", "undeployed"], ["deploy", "undeployed"]]);
  assert.ok(features.slice(2).every((f) => f.state === "deployed"));
  const files = fs.readdirSync(new URL("../features/", import.meta.url)).filter((f) => f.endsWith(".mjs") && f !== "index.mjs");
  validateFeatureOrder(files, featureOrder);
});

test("a new feature omitted from the order list is named in the error", () => {
  assert.throws(() => validateFeatureOrder(["canvas.mjs", "new-feature.mjs"], ["canvas.mjs"]), /not listed: new-feature\.mjs/);
});

test("a typo or deleted feature in the order list is named in the error", () => {
  assert.throws(() => validateFeatureOrder(["canvas.mjs"], ["canvas.mjs", "typo.mjs"]), /file does not exist: typo\.mjs/);
});

test("duplicate scenes are rejected while changing their order is allowed", () => {
  const files = ["canvas.mjs", "deploy.mjs"];
  assert.throws(() => validateFeatureOrder(files, [...files, "canvas.mjs"]), /listed more than once: canvas\.mjs/);
  assert.doesNotThrow(() => validateFeatureOrder(files, [...files].reverse()));
});

test("local source and patch edits invalidate media even without a new commit", (t) => {
  const root = workspace(t);
  fs.mkdirSync(path.join(root, "frontend/src"), { recursive: true });
  fs.mkdirSync(path.join(root, "frontend/patches"), { recursive: true });
  fs.writeFileSync(path.join(root, "frontend/src/app.tsx"), "old UI");
  const first = sourceHash(root);
  fs.writeFileSync(path.join(root, "frontend/src/app.tsx"), "current UI");
  const second = sourceHash(root);
  assert.notEqual(first, second);
  fs.writeFileSync(path.join(root, "frontend/patches/canvas.patch"), "new canvas");
  assert.notEqual(second, sourceHash(root));
});

test("generated output does not invalidate its own source fingerprint", (t) => {
  const root = workspace(t);
  const before = sourceHash(root);
  fs.mkdirSync(path.join(root, "docs/showcase/media"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/showcase/media/manifest.json"), "{}");
  assert.equal(before, sourceHash(root));
});

test("legacy media and a changed source cannot be reused by a partial run", () => {
  assert.throws(() => verifyManifest({ features: [] }, "/unused", "current"), /fresh full recording/);
  assert.throws(() => verifyManifest({ sourceHash: "old", features: [] }, "/unused", "current"), /fresh full recording/);
});

function recordedFixture(root) {
  for (const file of ["screen.webp", "clip.mp4", "preview.webp", "tour.mp4"]) fs.writeFileSync(path.join(root, file), file);
  fs.writeFileSync(path.join(root, "timing.json"), JSON.stringify({
    duration: 10, contentStartSeconds: 5,
    captions: [{ kind: "title", endSeconds: 4, minSeconds: 3, visibleSeconds: 3 }],
  }));
  return sealManifest({
    sourceHash: "current", video: "tour.mp4",
    features: [{ id: "deploy", shots: [{ files: { dark: "screen.webp" } }], clip: "clip.mp4", preview: "preview.webp", timing: "timing.json" }],
  }, root);
}

test("missing and replaced media fail verification", (t) => {
  const root = workspace(t);
  const manifest = recordedFixture(root);
  verifyManifest(manifest, root, "current", { featureIds: ["deploy"], requireVideo: true });
  fs.writeFileSync(path.join(root, "preview.webp"), "an old preview copied over the new one");
  assert.throws(() => verifyManifest(manifest, root, "current"), /changed showcase media: preview.webp/);
  fs.rmSync(path.join(root, "clip.mp4"));
  assert.throws(() => verifyManifest(manifest, root, "current"), /changed showcase media: clip.mp4/);
});

test("an incomplete tour cannot pass as a full recording", (t) => {
  const root = workspace(t);
  const manifest = recordedFixture(root);
  assert.throws(() => verifyManifest(manifest, root, "current", { featureIds: ["deploy", "canvas"] }), /coverage is incomplete/);
  delete manifest.features[0].preview;
  assert.throws(() => verifyManifest(manifest, root, "current", { requireVideo: true }), /Missing clip, preview or caption timings/);
});

test("preview generation requires an actual marker after the title has faded", () => {
  const timing = { duration: 20, captions: [{ kind: "title", endSeconds: 7 }] };
  assert.throws(() => previewStart(timing), /end-of-title marker/);
  assert.throws(() => previewStart({ ...timing, contentStartSeconds: 6 }), /end-of-title marker/);
  assert.throws(() => previewStart({ ...timing, contentStartSeconds: 20 }), /end-of-title marker/);
  assert.equal(previewStart({ ...timing, contentStartSeconds: 7.6 }), 7.6);
});

test("short captions fail verification even when media checksums match", (t) => {
  const root = workspace(t);
  const manifest = recordedFixture(root);
  const file = path.join(root, "timing.json");
  const timing = JSON.parse(fs.readFileSync(file));
  timing.captions.push({ text: "Too fast", minSeconds: 3, visibleSeconds: 0.5 });
  fs.writeFileSync(file, JSON.stringify(timing));
  sealManifest(manifest, root);
  assert.throws(() => verifyManifest(manifest, root, "current"), /Caption is too short/);
});
