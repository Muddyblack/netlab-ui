// Retry only startup: replaying a feature could repeat topology edits or commands.
export async function loadShowcasePage(page, base, lab, browserErrors, log = console.log) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const errorOffset = browserErrors.length;
    try {
      await page.goto(base, { waitUntil: "load" });
      if (lab) {
        const escaped = lab.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        await page.getByText(new RegExp(`^${escaped}( \\(.*\\))?$`)).first().waitFor({ timeout: 30_000 });
      }
      await page.waitForTimeout(800);
      if (browserErrors.slice(errorOffset).some((error) => error.includes("net::ERR_NETWORK_CHANGED"))) {
        throw new Error("net::ERR_NETWORK_CHANGED while loading the showcase app");
      }
      return;
    } catch (error) {
      const networkChanged = [error.message, ...browserErrors.slice(errorOffset)]
        .some((message) => message.includes("net::ERR_NETWORK_CHANGED"));
      if (!networkChanged || attempt === 3) throw error;
      log(`  · browser network changed during startup; reloading (${attempt}/2)`);
      await page.waitForTimeout(attempt * 1000);
    }
  }
}
