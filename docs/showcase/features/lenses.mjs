// Every lens in one take: the same running lab seen as cabling, addresses,
// routing, services, a traced path and live traffic. One clip, so the viewer
// sees that they are views of one lab, not separate tools.
const lensTab = (s, name) => s.page.getByRole("tablist", { name: "Netlab lens" }).getByRole("tab", { name: new RegExp(`^${name}`) });

async function pickNode(s, label, node) {
  const select = s.page.locator(".MuiFormControl-root").filter({ hasText: label }).getByRole("combobox").first();
  // Still captures have no pacing pauses. Wait for the previous menu's
  // backdrop to stop intercepting clicks before opening the next selector.
  await s.moveTo(select);
  await select.click();
  const option = s.page.getByRole("listbox").getByRole("option", { name: node, exact: true });
  await s.moveTo(option);
  await option.click();
  await s.until(s.page.getByRole("listbox"), { state: "hidden" });
  await s.until(select.filter({ hasText: new RegExp(`^${node}$`) }));
}

export default {
  id: "lenses",
  title: "Lenses: one lab, every view",
  summary: "Physical cabling, addressing, routing, services, paths and live traffic: switch the canvas between views of the same running lab.",
  lab: "fabric",
  state: "deployed",
  needsDocker: true,
  async run(s) {
    // Something to look at in the traffic lens: leaves ping across the fabric.
    // netlab exec passes each argument through as is: no extra shell quoting.
    s.netlabCli("exec", "-q", "l1", "sh", "-c", "(ping -q -i 0.01 -s 1200 -w 150 -I 10.0.0.3 10.0.0.5 >/dev/null 2>&1 &)");
    s.netlabCli("exec", "-q", "l2", "sh", "-c", "(ping -q -i 0.02 -s 600 -w 150 -I 10.0.0.4 10.0.0.3 >/dev/null 2>&1 &)");
    await s.openLab("fabric");
    await s.say("Lenses: the same lab, seen differently");
    // Open the Lenses panel on screen. (The palette's "Show live traffic" would
    // jump straight to the Traffic lens and skip the panel opening.)
    await s.click(s.page.getByRole("tab", { name: "Lenses", exact: true }));
    await s.until(lensTab(s, "Physical"), { timeout: 20_000 });

    await s.click(lensTab(s, "Physical"));
    await s.say("Physical: who is cabled to whom, on which interface");
    await s.wait(2500);
    await s.shot("physical", undefined, { alt: "Physical lens: the cabling with netlab's interface names on every link" });

    await s.click(lensTab(s, "Addressing"));
    await s.say("Addressing: every subnet, loopback and address");
    await s.wait(2500);
    await s.shot("addressing", undefined, { alt: "Addressing lens: subnets and addresses on the canvas" });

    await s.click(lensTab(s, "Routing"));
    await s.say("Routing: OSPF areas, BGP sessions, route reflectors");
    await s.wait(2500);
    await s.shot("routing", undefined, { hero: true, alt: "Routing lens: OSPF and iBGP drawn on the topology" });

    await s.click(lensTab(s, "Services"));
    await s.say("Services: what the lab provides on top");
    await s.wait(2000);
    await s.shot("services", undefined, { alt: "Services lens: the lab's VLANs, VRFs and overlays" });

    await s.click(lensTab(s, "Paths"));
    await s.say("Paths: trace how l1 reaches l3, hop by hop");
    await pickNode(s, "Source", "l1");
    await pickNode(s, "Destination", "l3");
    await s.click(s.page.getByRole("button", { name: "Trace", exact: true }));
    await s.wait(6000);
    await s.shot("paths", undefined, { alt: "Paths lens: the route from l1 to l3 traced hop by hop over OSPF" });

    await s.click(lensTab(s, "Traffic"));
    await s.say("Traffic: load, drops and errors on every link, live");
    await s.wait(12000);
    await s.shot("traffic", undefined, { alt: "Traffic lens with per-link rates on the running fabric" });
    await s.wait(1500);
  },
};
