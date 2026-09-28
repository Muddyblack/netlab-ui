export default {
  id: "run-on-nodes",
  title: "One command, every node",
  summary: "Send a command to a group of nodes and read every answer, one collapsible section per node. show commands go to each device's CLI.",
  lab: "fabric",
  state: "deployed",
  needsDocker: true,
  async run(s) {
    await s.openLab("fabric");
    await s.say("Ctrl+` — one command on every node");
    await s.click(s.page.locator(".react-flow__pane").first(), { position: { x: 60, y: 60 } });
    await s.press("Control+`");
    await s.wait(2000);
    await s.click(s.page.getByLabel("Maximize panel"));
    await s.click(s.page.getByPlaceholder(/show ip route|command/i).first());
    await s.type("show ip ospf neighbor");
    await s.press("Enter");
    const completed = s.page.getByText(/5\/5 done/);
    await s.until(completed, { timeout: 90_000 });
    if ((await completed.innerText()).includes("failed")) throw new Error("A node's show command failed");
    await s.until(s.page.getByRole("button", { name: "Run show ip ospf neighbor again", exact: true }));
    // This control belongs to the current results layout, not the old grid.
    const collapse = s.page.getByRole("button", { name: "Collapse all outputs", exact: true });
    await s.until(collapse);
    await s.say("Every reply in a collapsible section");
    await s.shot("results", undefined, { alt: "OSPF neighbors from all five routers in collapsible output sections" });
    await s.click(collapse);
    await s.say("Collapse the replies, then expand the one you need");
    await s.click(s.page.getByRole("button", { name: /^Expand output of s1$/ }));
    await s.shot("focused", undefined, { hero: true, alt: "The current Run on nodes panel with s1's output expanded" });
  },
};
