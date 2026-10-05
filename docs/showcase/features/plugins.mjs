// netlab plugins as a catalogue: what is enabled in this lab, what each one
// hooks into, and its manual behind the (i) button.
export default {
  id: "plugins",
  title: "netlab plugins, documented in place",
  summary: "Browse every netlab plugin, switch them on per lab, see what they hook into, and read the manual behind the info button.",
  lab: "fabric",
  state: "any",
  async run(s) {
    await s.openLab("fabric");
    await s.say("The Plugins tab: everything netlab can load");
    const byId = s.byTestId("panel-tab-netlab-plugins");
    await s.click((await byId.count()) ? byId : s.page.getByRole("tab", { name: /^Plugins/ }).first());
    await s.until(s.page.getByPlaceholder("Search plugins..."), { timeout: 20_000 });
    await s.wait(1500);
    await s.shot("catalogue", undefined, { alt: "The Plugins tab listing netlab's plugins with the ones this lab uses switched on" });

    await s.say("Search, then open one to see what it hooks into");
    await s.click(s.page.getByPlaceholder("Search plugins..."));
    await s.type("monitoring");
    const card = s.page.locator(".MuiAccordion-root").filter({ hasText: "monitoring" }).first();
    await s.until(card, { timeout: 15_000 });
    await s.click(card.locator(".MuiAccordionSummary-expandIconWrapper"));
    await s.wait(1200);
    await s.shot("details", undefined, { hero: true, alt: "The monitoring plugin expanded: where it runs, what it requires and its arguments" });

    await s.say("The info button opens the plugin's manual");
    await s.click(card.getByRole("button", { name: "Open monitoring plugin docs", exact: true }));
    const manual = s.page.getByRole("dialog").first();
    await s.until(manual, { timeout: 20_000 });
    await s.wait(2000);
    await s.shot("manual", manual, { pad: 0, alt: "The monitoring plugin's manual, rendered in the app" });
    await s.beat(1500);
    await s.press("Escape");
  },
};
