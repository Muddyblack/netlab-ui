export default {
  id: "traffic",
  title: "Live traffic on the canvas",
  summary: "Links show their load as it happens; the traffic lens charts rates, drops and errors per link.",
  lab: "fabric",
  state: "deployed",
  needsDocker: true,
  async run(s) {
    // Something to look at: leaves ping each other's loopbacks across the fabric.
    // netlab exec passes each argument through as is: no extra shell quoting.
    s.netlabCli("exec", "-q", "l1", "sh", "-c", "(ping -q -i 0.01 -s 1200 -w 90 -I 10.0.0.3 10.0.0.5 >/dev/null 2>&1 &)");
    s.netlabCli("exec", "-q", "l2", "sh", "-c", "(ping -q -i 0.02 -s 600 -w 90 -I 10.0.0.4 10.0.0.3 >/dev/null 2>&1 &)");
    await s.openLab("fabric");
    await s.say("Live load on every link");
    await s.palette("Show live traffic");
    await s.wait(12000);
    await s.shot("lens", undefined, { alt: "Traffic lens with per-link rates on the running fabric" });
  },
};
