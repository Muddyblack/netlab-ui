"use strict";

const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isSafeExternalUrl(value) {
  const url = parseUrl(value);
  return url !== null && SAFE_EXTERNAL_PROTOCOLS.has(url.protocol);
}

function canNavigateInApp(currentValue, targetValue) {
  const current = parseUrl(currentValue);
  const target = parseUrl(targetValue);

  // Programmatic loadURL/loadFile calls are not covered by will-navigate. User-
  // initiated navigation is only allowed within the active backend origin.
  return (
    current !== null &&
    target !== null &&
    current.protocol !== "file:" &&
    target.origin === current.origin
  );
}

module.exports = { canNavigateInApp, isSafeExternalUrl };
