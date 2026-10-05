// A deployed fabric does not guarantee that its separate monitoring stack is up.
export async function ensureMonitoring(s, dialog) {
  const status = dialog.locator(".MuiChip-root").filter({ hasText: /^(Running|Stopped|Partly running)$/ });
  await s.until(status, { timeout: 30_000 });
  const current = (await status.innerText()).trim();
  if (current === "Running") return;
  if (current === "Partly running") {
    throw new Error("The monitoring stack is only partly running; check its containers before recording fault tests.");
  }
  await s.click(dialog.getByRole("tab", { name: "Setup", exact: true }));
  const runs = dialog.getByRole("button", { name: /^Runs\b/ });
  await s.until(runs);
  if (await runs.getAttribute("aria-expanded") !== "true") await s.click(runs);
  const [response] = await Promise.all([
    s.page.waitForResponse((response) => response.url().endsWith("/api/lab/monitoring/action") && response.request().method() === "POST", { timeout: 180_000 }),
    s.click(dialog.getByRole("button", { name: "Start now", exact: true })),
  ]);
  if (!response.ok()) throw new Error(`Monitoring start failed: ${await response.text()}`);
  const result = await response.json();
  if (result.code !== 0) throw new Error(`Monitoring start failed: ${result.stderr || result.stdout || `exit ${result.code}`}`);
  await s.until(status.filter({ hasText: /^Running$/ }), { timeout: 180_000 });
  await s.click(dialog.getByRole("tab", { name: "Health", exact: true }));
}
