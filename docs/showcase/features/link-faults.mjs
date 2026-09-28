export default {
  id: "link-faults",
  title: "Break things on purpose",
  summary: "Take a link down or add delay and loss from its menu — then watch the routing protocols react.",
  lab: "fabric",
  state: "deployed",
  needsDocker: true,
  async run(s) {
    await s.openLab("fabric");
    await s.palette("Show live traffic");
    await s.wait(2000);
    await s.say("Right-click a link");
    await s.rightClickEdge("s1", "l2");
    await s.wait(600);
    await s.shot("menu", s.page.getByRole("menu").first(), { pad: 12, alt: "Link menu with fault injection" });
    await s.say("Take it down — OSPF routes around it");
    await s.click(s.menuItem("Take Link Down"));
    await s.until(s.page.getByText("Links down").locator("..").getByText("1", { exact: true }), { timeout: 30_000 });
    await s.wait(2000);
    await s.shot("link-down", undefined, { alt: "Link s1–l2 down, flagged by the traffic lens" });
    await s.say("And bring it back");
    await s.rightClickEdge("s1", "l2");
    await s.click(s.menuItem("Bring Link Up"));
    await s.wait(2000);
  },
};
