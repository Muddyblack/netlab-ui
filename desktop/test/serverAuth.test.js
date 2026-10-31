"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { serverUrlPatterns, withBearer } = require("../src/serverAuth");

test("patterns cover http and websocket traffic to the server origin only", () => {
  assert.deepEqual(serverUrlPatterns("http://lab.example:8000/some/path"), [
    "http://lab.example:8000/*",
    "ws://lab.example:8000/*",
  ]);
  assert.deepEqual(serverUrlPatterns("https://lab.example"), ["https://lab.example/*", "wss://lab.example/*"]);
});

test("the bearer token is added to requests without credentials", () => {
  assert.deepEqual(withBearer({ Accept: "*/*" }, "tok"), { Accept: "*/*", Authorization: "Bearer tok" });
});

test("existing credentials and an empty token leave the headers alone", () => {
  const basic = { authorization: "Basic abc" };
  assert.equal(withBearer(basic, "tok"), basic);
  const plain = { Accept: "*/*" };
  assert.equal(withBearer(plain, ""), plain);
});
