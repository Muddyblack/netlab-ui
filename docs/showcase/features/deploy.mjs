export default {
  id: "deploy",
  title: "Deploy with live progress",
  summary: "One click on Deploy, then watch nodes come up as containerlab starts them and Ansible configures them.",
  lab: "fabric",
  state: "undeployed",
  needsDocker: true,
  async run(s) {
    await s.openLab("fabric");
    await s.say("Deploy — straight from the canvas");
    await s.click(s.byTestId("navbar-deploy"));
    // A valid, unchanged lab deploys right away; the review dialog only shows
    // up when there is something to decide (issues, conflicts, YAML changes).
    const review = s.page.getByRole("dialog").filter({ hasText: "Review changes before deploy" }).first();
    const log = s.page.getByRole("dialog").filter({ hasText: "Deploying lab" }).first();
    await s.until(review.or(log), { timeout: 60_000 });
    if (await review.isVisible()) await s.click(review.getByRole("button", { name: /^Deploy/ }).last());
    await s.until(log, { timeout: 60_000 });
    await s.say("Live: containerlab starts the nodes, Ansible configures them");
    await s.wait(2500);
    await s.shot("progress", undefined, { alt: "netlab up running, with its live output" });
    const done = log.getByText(/^(Completed|Failed)$/).first();
    await s.until(done, { timeout: 900_000 });
    if ((await done.innerText()).trim() === "Failed") throw new Error(`deploy failed: ${(await log.innerText()).slice(-400)}`);
    await s.wait(1200);
    await s.shot("completed", log, { pad: 0, alt: "netlab up finished: every node configured" });
    await s.click(log.getByRole("button", { name: "OK" }));
    await s.wait(3500);
    await s.say("Up and running");
    await s.shot("running", undefined, { alt: "The fabric lab running" });
  },
};
