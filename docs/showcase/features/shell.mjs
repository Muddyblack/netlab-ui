export default {
  id: "shell",
  title: "A shell on every node",
  summary: "Terminals in the browser — the device CLI or Linux shell netlab connect would give you.",
  lab: "fabric",
  state: "deployed",
  needsDocker: true,
  async run(s) {
    await s.openLab("fabric");
    await s.expandRunningLab("fabric");
    await s.say("A shell on any node, in the browser");
    await s.rightClick(s.page.getByText("s1", { exact: true }).first());
    await s.hover(s.menuItem("Access"));
    await s.click(s.menuItem(/attach shell/i));
    const terminal = s.page.locator(".xterm").first();
    await s.until(terminal, { timeout: 30_000 });
    await s.wait(2500);
    await s.click(terminal);
    await s.type("vtysh -c 'show ip ospf neighbor'\n", { delay: 35 });
    await s.wait(2500);
    await s.type("vtysh -c 'show bgp summary'\n", { delay: 35 });
    await s.wait(3000);
    await s.shot("vtysh", undefined, { alt: "A web shell on s1 showing OSPF neighbors and the BGP summary" });
  },
};
