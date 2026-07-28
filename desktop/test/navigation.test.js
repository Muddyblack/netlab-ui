"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { canNavigateInApp, isSafeExternalUrl } = require("../src/navigation");

test("only HTTP(S) URLs may be opened by the operating system", () => {
  assert.equal(isSafeExternalUrl("https://example.com/docs"), true);
  assert.equal(isSafeExternalUrl("http://localhost:8000/docs"), true);
  assert.equal(isSafeExternalUrl("file:///etc/passwd"), false);
  assert.equal(isSafeExternalUrl("custom-handler://payload"), false);
  assert.equal(isSafeExternalUrl("not a URL"), false);
});

test("the backend may navigate within its own origin", () => {
  assert.equal(
    canNavigateInApp("https://netlab.example/app", "https://netlab.example/labs/one"),
    true,
  );
  assert.equal(
    canNavigateInApp("https://netlab.example/app", "https://other.example/labs/one"),
    false,
  );
  assert.equal(
    canNavigateInApp("https://netlab.example/app", "http://netlab.example/app"),
    false,
  );
});

test("the local connection screen cannot navigate itself", () => {
  assert.equal(
    canNavigateInApp("file:///opt/netlab/connect.html", "https://netlab.example"),
    false,
  );
});
