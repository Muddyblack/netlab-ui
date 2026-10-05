// The showcase fabric lists the monitoring plugin. Ensure its stack is running
// (VictoriaMetrics and Grafana, next to the lab). This scene shows the
// health view and the two Grafana dashboards inside the app. The outage band
// on the dashboards comes from the fault test run in the previous scene.
import { ensureMonitoring } from "../lib/monitoring.mjs";

async function openDashboard(s, item, { reopen = true } = {}) {
  if (reopen) await s.palette("Monitoring");
  const dialog = s.page.getByRole("dialog").first();
  // Enabled once the stack is up: it started together with the lab.
  const open = dialog.locator("button:not([disabled])", { hasText: "Open dashboard" });
  await s.until(open, { timeout: 180_000 });
  await s.click(open);
  await s.click(s.page.getByRole("menuitem", { name: item }));
  // Grafana is a tab of the app: wait for its page, then for the panels to draw.
  // Earlier dashboards stay open as hidden background tabs: wait for the visible one.
  await s.until(s.page.locator("iframe:visible").first(), { timeout: 30_000 });
  // Panels have drawn once their headers are in; give the lines a moment to settle.
  const panels = s.page.frameLocator("iframe:visible").locator('[data-testid^="data-testid Panel header"]');
  await s.until(panels.first(), { timeout: 60_000 });
  await s.focus(s.page.locator("iframe:visible").first());
  await s.wait(3000);
}

export default {
  id: "monitoring",
  title: "Monitor any lab, with Grafana inside",
  summary: "Health against the topology, per-link and per-protocol metrics, and Grafana dashboards in a tab, for FRR or any other vendor.",
  lab: "fabric",
  state: "deployed",
  needsDocker: true,
  // Recreate the fault-test outage band if resuming into a fresh workspace.
  resumeFrom: "validation",
  // The Short's voice-over: one paragraph per caption below, spoken while it
  // is up, so each must fit its scene (shorts.sh warns when one doesn't).
  // The Short's camera, per caption: "wide" fits a whole Grafana tab (squeezed).
  framing: [null, null, "wide", "wide"],
  narration: [
    "What's your lab really doing? With netlab-ui, monitoring is just one line in your topology.",
    "Pick the nodes you want to watch. Each one is collected the right way for its vendor.",
    "Then open Grafana, right inside the app, as a tab.",
    // "…" is a real pause: the list is spoken item by item, a little slower.
    { text: "Every route flap… every SPF run… and every BGP peer… down to the moment it broke. Feel free to try netlab-ui… it is open source… see the link below.", speed: 1.02 },
  ],
  async run(s) {
    await s.openLab("fabric");
    await s.say("Ctrl+P — Monitoring: the plugin is one line in the topology");
    await s.palette("Monitoring");
    const dialog = s.page.getByRole("dialog").first();
    await s.focus(dialog);
    await ensureMonitoring(s, dialog);
    await s.until(dialog.getByText("Nodes up"), { timeout: 120_000 });
    await s.beat(2500);
    await s.shot("health", dialog, { hero: true, alt: "The Monitoring dialog: nodes, BGP sessions and OSPF adjacencies up against what the topology defines" });
    await s.say("How each node is collected, vendor by vendor");
    await s.click(dialog.getByRole("tab", { name: "Setup" }));
    await s.beat(3000);
    await s.shot("setup", dialog, { alt: "Setup tab: where the stack runs and how every node is collected" });

    // Back to Health in the same dialog: its Open dashboard menu is right there.
    await s.click(dialog.getByRole("tab", { name: "Health", exact: true }));
    await s.say("Lab overview in Grafana, as a tab of the app");
    await openDashboard(s, "Lab overview", { reopen: false });
    await s.shot("overview", undefined, { alt: "The lab overview dashboard in a Grafana tab next to the canvas" });

    await s.say("Routing and convergence: flaps, SPF runs and BGP per peer");
    await openDashboard(s, "Routing and convergence");
    await s.shot("routing", undefined, { alt: "The routing and convergence dashboard with the fault test's outage band" });
    // End on the dashboard: the cursor glides into it, and the Short's crop follows.
    await s.moveTo(s.page.locator("iframe:visible").first());
    await s.beat(1500);
  },
};
