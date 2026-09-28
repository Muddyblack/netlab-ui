// The README's complete animated collaboration lockup, in the app's theme.
export const OUTRO = { seconds: 14, fps: 30 };
export const outroHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
body{background:var(--clab-ui-editor-background,#1e1e1e);color:var(--clab-ui-editor-foreground,#d4d4d4);font-family:Roboto,Arial,sans-serif}
.stage{position:relative;width:1600px;height:900px;display:flex;flex-direction:column;align-items:center;text-align:center}
.art{position:relative;width:960px;height:336px;margin-top:40px;flex-shrink:0}
.art:before{content:'';position:absolute;inset:55px 160px;background:radial-gradient(ellipse,rgba(255,120,0,.1),transparent 65%);filter:blur(28px)}
.mark{position:relative;width:100%;height:100%}.mark svg{width:100%;height:100%;max-width:none!important;max-height:none!important}
.copy{animation:enter 1s .2s both}h1{font-size:58px;font-weight:500;letter-spacing:-1.5px;margin:4px 0 24px;line-height:1.2;color:#f2f2f2}
.names{font-size:29px;font-weight:500;line-height:1.5;margin:0 0 18px;color:#ddd}
.description{font-size:23px;line-height:1.6;color:#a6a6a6;margin:0}
.bottom{position:absolute;bottom:58px;left:160px;right:160px;border-top:1px solid #ffffff1f;padding-top:27px;animation:enter 1s .5s both}
.url{font-size:26px;color:#edac7f;margin-bottom:18px}.upstream{font-size:18px;color:#999;display:flex;justify-content:center;gap:36px}
@keyframes enter{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
</style></head><body><main class="stage">
<div class="art"><div class="mark" id="clab-mark"></div></div>
<section class="copy"><h1>Thank you for making this possible.</h1><p class="names">The containerlab community · SRL Labs · Nokia</p><p class="description">Built with your open-source work on containerlab and clab-ui.<br>With thanks to everyone who builds, shares and contributes.</p></section>
<footer class="bottom"><div class="url">github.com/Muddyblack/netlab-ui</div><div class="upstream"><span>containerlab.dev</span><span>github.com/srl-labs/containerlab-app</span></div></footer>
</main></body></html>`;
