// A change made by hand on a device (here: from the CLI, off screen) shows up
// as a per-node diff against a snapshot of the running configurations.
// netlab exec passes each argument through as is: no extra shell quoting.
const CHANGE = ["configure terminal", "ip route 192.0.2.0/24 Null0", "interface lo", "description changed by hand"];
const REVERT = ["configure terminal", "no ip route 192.0.2.0/24 Null0", "interface lo", "no description"];
const vtysh = (lines) => ["exec", "-q", "l1", "vtysh", ...lines.flatMap((line) => ["-c", line])];

export default {
  id: "config-drift",
  title: "See what changed on the devices",
  summary: "Snapshot every node's running config, change things by hand, and get a per-device diff of exactly what moved.",
  lab: "fabric",
  state: "deployed",
  needsDocker: true,
  async run(s) {
    try {
      await s.say("Snapshot every device's running config");
      await s.palette("Running configs & changes");
      const dialog = s.page.getByRole("dialog").filter({ hasText: "Running configurations" }).first();
      await s.until(dialog, { timeout: 30_000 });
      // The button is grayed out while the dialog compares: wait until it is usable.
      const take = dialog.locator("button:not([disabled])", { hasText: "Take snapshot" });
      await s.until(take, { timeout: 120_000 });
      await s.beat(800);
      await s.click(take);
      await s.until(dialog.getByText("unchanged").first(), { timeout: 180_000 });
      await s.until(take, { timeout: 120_000 });
      await s.beat(1500);
      await s.say("Someone changes l1 by hand…");
      s.netlabCli(...vtysh(CHANGE));
      await s.beat(900);
      await s.click(dialog.getByLabel("Refresh drift"));
      const changed = dialog.getByText(/^\+\d+ −\d+$/).first();
      await s.until(changed, { timeout: 120_000 });
      // l1 is selected automatically once it has changed: no click needed.
      await s.say("…and the diff shows exactly what moved");
      await s.wait(2500);
      await s.shot("diff", dialog, { pad: 0, hero: true, alt: "Running-config drift: l1 changed since the snapshot, with its diff" });
    } finally {
      s.netlabCli(...vtysh(REVERT));
    }
  },
};
