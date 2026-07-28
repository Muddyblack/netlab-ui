"use strict";

const input = document.getElementById("server-url");
const button = document.getElementById("connect-btn");
const status = document.getElementById("status");
const form = document.getElementById("connect-form");

window.netlabDesktop.getServerUrl().then((url) => {
  input.value = url;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  status.textContent = "Connecting…";
  status.style.color = "#9aa4b2";

  const ok = await window.netlabDesktop.connect(input.value.trim());
  if (!ok) {
    status.textContent = "Could not reach that server. Is the backend running?";
    status.style.color = "#ff6b6b";
    button.disabled = false;
  }
  // On success the main process navigates this window away, nothing left to do.
});
