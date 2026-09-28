export default {
  id: "command-palette",
  title: "Everything one keystroke away",
  summary: "Ctrl+P finds labs, nodes, IP addresses, AS numbers and actions — and lights up what it found on the canvas.",
  lab: "fabric",
  state: "deployed",
  async run(s) {
    await s.say("Ctrl+P — search the lab by address");
    await s.press("Control+p");
    await s.type("10.0.0.3");
    await s.wait(900);
    await s.shot("palette", s.page.getByRole("dialog").first(), { alt: "The command palette finding the node that owns 10.0.0.3" });
    await s.press("Enter");
    await s.say("Found: l1 owns it — everything else fades");
    await s.wait(1800);
    await s.press("Escape");
    // Every node runs OSPF and BGP here, so a module filter would light up
    // everything; a group shows the spotlight doing something.
    await s.say("Or light up a whole group");
    await s.palette("spines");
    await s.wait(1800);
    await s.shot("spotlight", undefined, { hero: true, alt: "Canvas spotlight on the spine group" });
    await s.press("Escape");
  },
};
