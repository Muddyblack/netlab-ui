export default {
  id: "node-editor",
  title: "Edit nodes the netlab way",
  summary: "Device, modules, custom configs and a preview of the exact configuration netlab generates.",
  lab: "fabric",
  state: "deployed",
  async run(s) {
    await s.openLab("fabric");
    await s.say("Double-click a node to edit it");
    await s.click(s.byTestId("navbar-lock"));
    await s.dblclick(s.node("l1"));
    await s.wait(800);
    await s.say("Preview the exact configuration netlab generates");
    await s.click(s.page.getByRole("tab", { name: /configuration/i }).first());
    await s.until(s.page.getByText("Exact files produced by netlab create", { exact: false }), { timeout: 60_000 });
    await s.until(s.page.getByRole("combobox", { name: "Generated file" }), { timeout: 60_000 });
    await s.wait(600);
    const panel = s.page.locator(".MuiDrawer-paper, [class*=EditorPanel], [class*=panel]").filter({ hasText: "Node Editor" }).first();
    await s.shot("editor", undefined, { hero: true, alt: "The node editor next to the canvas" });
    await s.shot("configuration", (await panel.count()) ? panel : undefined, { pad: 0, alt: "Node editor with netlab's generated FRR configuration" });
    await s.say("Modules and their settings, per node");
    await s.click(s.page.getByRole("tab", { name: /modules/i }).first());
    await s.wait(900);
  },
};
