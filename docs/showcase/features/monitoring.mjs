export default {
  id: "monitoring",
  title: "Monitor any lab",
  summary: "Switch on the monitoring plugin — health against the topology, every vendor, Grafana dashboards.",
  lab: "fabric",
  state: "deployed",
  needsDocker: true,
  async run(s) {
    await s.openLab("fabric");
    await s.say("Ctrl+P — Monitoring");
    await s.palette("Monitoring");
    await s.wait(1500);
    const dialog = s.page.getByRole("dialog").first();
    const toggle = dialog.getByRole("checkbox", { name: "Monitor this lab" });
    if (!(await toggle.isChecked())) {
      await s.say("One switch adds plugin: [ monitoring ]");
      await toggle.click();
      await s.wait(1500);
    }
    await s.shot("dialog", dialog, { hero: true, alt: "The Monitoring dialog: health vs topology, dashboards, how each node is collected" });
    await s.press("Escape");
  },
};
