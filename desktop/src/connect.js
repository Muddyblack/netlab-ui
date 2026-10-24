"use strict";

const input = document.getElementById("server-url");
const tokenInput = document.getElementById("token");
const button = document.getElementById("connect-btn");
const status = document.getElementById("status");
const form = document.getElementById("connect-form");

const MESSAGES = {
  unreachable: "Could not reach that server. Is the backend running?",
  unauthorized: "The server rejected that token. Check it with `netlab-gui token` on the server.",
};

window.netlabDesktop.getServerUrl().then((url) => {
  input.value = url;
});
window.netlabDesktop.getToken().then((token) => {
  tokenInput.value = token;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  status.textContent = "Connecting…";
  status.style.color = "#9aa4b2";

  const result = await window.netlabDesktop.connect(input.value.trim(), tokenInput.value.trim());
  if (result !== "ok") {
    status.textContent = MESSAGES[result] ?? MESSAGES.unreachable;
    status.style.color = "#ff6b6b";
    button.disabled = false;
  }
  // On success the main process navigates this window away, nothing left to do.
});
