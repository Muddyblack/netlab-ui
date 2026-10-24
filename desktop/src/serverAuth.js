"use strict";

/** URL patterns (http and ws) covering every request the page makes to the configured server. */
function serverUrlPatterns(serverUrl) {
  const { origin } = new URL(serverUrl);
  return [`${origin}/*`, `${origin.replace(/^http/, "ws")}/*`];
}

/** Request headers with the bearer token added, unless the request already carries credentials. */
function withBearer(requestHeaders, token) {
  if (!token || Object.keys(requestHeaders).some((name) => name.toLowerCase() === "authorization")) {
    return requestHeaders;
  }
  return { ...requestHeaders, Authorization: `Bearer ${token}` };
}

module.exports = { serverUrlPatterns, withBearer };
