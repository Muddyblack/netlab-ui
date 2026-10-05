export default {
  id: "reports",
  title: "netlab reports, interactive",
  summary: "Addressing, BGP, OSPF and wiring reports as searchable tables, rendered HTML or text — download any format.",
  lab: "fabric",
  state: "deployed",
  async run(s) {
    await s.openLab("fabric");
    await s.say("netlab's reports as searchable tables");
    await s.palette("Reports…");
    const dialog = s.page.getByRole("dialog", { name: "Reports" });
    await dialog.waitFor();
    await s.wait(3500);
    await s.shot("gallery", undefined, { hero: true, alt: "The report gallery over the lab" });
    await s.shot("addressing", dialog, { pad: 0, alt: "Addressing report as a table linked to the canvas" });
    await s.say("OSPF, BGP, wiring — download as Markdown, HTML or text");
    await s.click(dialog.getByRole("combobox"));
    // Type to filter: the list narrows to the match instead of scrolling.
    await s.type("OSPF");
    await s.click(s.page.getByRole("option", { name: /OSPF Areas/ }).first());
    await s.wait(3500);
    await s.shot("ospf", dialog, { pad: 0, alt: "OSPF areas report rendered from netlab's HTML" });
  },
};
