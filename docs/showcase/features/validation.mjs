// netlab's own validate: tests, run from the Validation lens, and then as the
// pass/fail check of a fault test that takes a link down and brings it back.
// The tests and the fault test live in the showcase lab's topology.yml.
import { ensureMonitoring } from "../lib/monitoring.mjs";

export default {
  id: "validation",
  title: "Validate the lab, then break it",
  summary: "Run the lab's netlab validate tests, then a fault test: take a link down, check the fabric holds, and get a pass/fail verdict.",
  lab: "fabric",
  state: "deployed",
  needsDocker: true,
  async run(s) {
    await s.openLab("fabric");
    await s.say("Validation: the tests written into the topology");
    await s.click(s.page.getByRole("tab", { name: "Lenses", exact: true }));
    const lens = s.page.getByRole("tablist", { name: "Netlab lens" }).getByRole("tab", { name: /^Validation/ });
    await s.click(lens);
    await s.wait(1500);
    const runAll = s.page.getByRole("button", { name: "Run all tests" });
    await s.click(runAll);
    await s.say("netlab validate runs on the devices: adjacencies, sessions, reachability");
    await s.wait(2000);
    // The button reads "Running…" until every test has finished.
    await s.until(runAll, { timeout: 240_000 });
    await s.wait(1200);
    await s.shot("lens", undefined, { alt: "Validation lens: the lab's netlab validate tests with their results" });

    await s.say("The same tests become the check of a fault test");
    await s.palette("Monitoring");
    const dialog = s.page.getByRole("dialog").first();
    await ensureMonitoring(s, dialog);
    await s.until(dialog.getByRole("tab", { name: "Fault tests" }), { timeout: 20_000 });
    await s.click(dialog.getByRole("tab", { name: "Fault tests" }));
    await s.beat(1800);
    await s.shot("fault-tests", dialog, { alt: "Fault tests defined in the topology, with a Run button each" });
    await s.say("Take s1–l2 down, check, bring it back, check again");
    await s.click(dialog.getByRole("button", { name: "Run", exact: true }).first());
    // A "passed" badge from an earlier run can already be on screen: wait for
    // this run to start (Stop appears) and to finish (Stop goes away).
    const stop = dialog.getByRole("button", { name: /stop/i }).first();
    await s.until(stop, { timeout: 30_000 });
    await s.until(stop, { state: "hidden", timeout: 420_000 });
    const verdict = dialog.getByText(/^(passed|failed)$/).first();
    await s.until(verdict, { timeout: 30_000 });
    if ((await verdict.innerText()).trim() === "failed") throw new Error("the uplink_loss fault test failed");
    await s.beat(2500);
    await s.shot("verdict", dialog, { hero: true, alt: "A fault test that passed: validate checks while the link was down and after it recovered" });
    await s.press("Escape");
  },
};
