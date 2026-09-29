// Every lab netlab knows about on the host — not just the one on the canvas —
// with the clean-up actions next to it.
export default {
  id: "running-labs",
  title: "Every running lab, one place to clean up",
  summary: "See every lab netlab is tracking on the host, then shut one down, force a cleanup, or forget a stale record.",
  lab: "fabric",
  state: "deployed",
  async run(s) {
    await s.openLab("fabric");
    await s.say("Every lab netlab is running, on this host");
    await s.palette("Running netlab labs");
    const dialog = s.page.getByRole("dialog").filter({ hasText: "Running netlab labs" }).first();
    await dialog.waitFor();
    await s.wait(2500);
    await s.shot("dialog", dialog, { pad: 0, hero: true, alt: "The running labs dialog with shut down, force cleanup and forget record" });
    await s.say("Shut down, force a cleanup, or forget a stale record");
    await s.wait(1800);
    await s.press("Escape");
  },
};
