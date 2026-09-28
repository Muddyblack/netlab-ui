// A feature is one file: what it shows (title, summary), which lab it needs
// and in which state, and the steps. Stills are taken in the dark theme; the
// same steps, slowed down, become this feature's part of the video.
import fs from "node:fs";
import path from "node:path";

export default {
  id: "canvas",
  title: "Draw labs on a canvas",
  summary: "Open a netlab topology as a diagram and edit it there — nodes, links and netlab's own interface names.",
  lab: "fabric",
  state: "undeployed",
  showOpen: true,
  async run(s) {
    // The new link goes into topology.yml; later features need the lab as shipped.
    const topology = path.join(s.workspace, "fabric", "topology.yml");
    const original = fs.readFileSync(topology, "utf8");
    try {
      await s.say("Open a lab from the explorer");
      await s.openLab("fabric");
      await s.shot("overview", undefined, { alt: "The fabric lab on the canvas with the explorer and palette" });
      await s.say("Unlock it, then connect two routers");
      await s.click(s.byTestId("navbar-lock"));
      await s.rightClick(s.node("s1"));
      await s.click(s.menuItem("Create Link"));
      await s.click(s.node("s2"), { after: 900 });
      await s.say("Saved straight to topology.yml");
      await s.wait(1400);
      await s.shot("new-link", undefined, { hero: true, alt: "A new s1–s2 link drawn on the canvas" });
    } finally {
      fs.writeFileSync(topology, original);
    }
  },
};
