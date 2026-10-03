// An agent connected over MCP proposes a change; the user reviews the diff and
// applies it. The "agent" is a scripted MCP client (Stage.mcp), so the clip is
// reproducible and needs no model or login — the panel, the proposal and the
// apply are the real thing.
export default {
  id: "ai-agents",
  title: "Bring your own AI agent",
  summary: "Claude Code, Codex, Copilot, Kiro or any MCP tool, connected to the lab. It proposes changes; you review the diff.",
  lab: "fabric",
  state: "deployed",
  async run(s) {
    await s.say("Your own agent, connected to the lab over MCP");
    await s.press("Control+i");
    await s.page.getByText("Your own AI agent, connected to this lab.").waitFor({ timeout: 10_000 });
    await s.wait(900);
    await s.shot("panel", undefined, { alt: "The AI agents panel: start Claude Code or Codex, or connect another tool" });

    await s.say("The agent proposes a change: a third spine");
    await s.mcp("propose_topology_edit", {
      lab: "fabric",
      rationale: "Add a third spine so every leaf keeps two uplinks if one spine fails",
      commands: [
        { type: "addNode", id: "s3", device: "frr" },
        { type: "assignGroup", id: "s3", group: "spines" },
        { type: "addLink", source: "s3", target: "l1" },
        { type: "addLink", source: "s3", target: "l2" },
        { type: "addLink", source: "s3", target: "l3" },
      ],
    });
    const apply = s.page.getByRole("button", { name: /^apply$/i }).first();
    await s.until(apply, { timeout: 15_000 });
    await s.wait(1200);
    await s.say("You review the diff, then apply it");
    await s.shot("proposal", undefined, { hero: true, alt: "An agent's proposed topology change, shown as a diff to apply or reject" });
    await s.click(apply, { after: 900 });
    await s.until(s.node("s3"), { timeout: 20_000 });
    await s.say("Applied like any canvas edit: Ctrl+Z undoes it");
    await s.wait(1000);
    // The toolbar button and Ctrl+Z share the same undo action. The button
    // also works while focus is still in the review panel.
    const undone = s.page.waitForResponse((response) => response.url().includes("/api/topology/command") && response.request().method() === "POST");
    await s.click(s.byTestId("navbar-undo"));
    const result = await (await undone).json();
    if (result.snapshot?.nodes.some((node) => node.id === "s3")) throw new Error("Undo did not remove the proposed spine");
    await s.until(s.node("s3"), { state: "hidden", timeout: 20_000 });
    await s.wait(1000);
  },
};
