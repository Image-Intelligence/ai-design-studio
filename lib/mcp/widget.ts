/**
 * The results card the connector's tools render inside the chat (2026-10-20):
 * the pictures and clips a tool made, in the site's silver-on-navy look, each
 * with its model and ticket cost and a link to open it.
 *
 * One HTML file for both apps:
 *  - ChatGPT (Apps SDK): served as text/html+skybridge; the tool's
 *    structuredContent arrives as window.openai.toolOutput (and again with
 *    each "openai:set_globals" event).
 *  - Claude and other MCP Apps hosts: text/html;profile=mcp-app; the view
 *    shakes hands over postMessage (ui/initialize) and receives
 *    ui/notifications/tool-result.
 * The card only reads what the tool returned; it never calls the site.
 */

export const WIDGET_URI_OPENAI = 'ui://widget/studio-results.html'
export const WIDGET_URI_MCP_APPS = 'ui://aids/studio-results.html'

/** Where the card's pictures and clips load from (CSP): the media worker and the public bucket. */
export function mediaDomains(): string[] {
  const hosts = [process.env.MEDIA_HOST, process.env.R2_PUBLIC_URL, process.env.R2_PUBLIC_ASSET_URL]
    .map(u => { try { return u ? new URL(u).origin : null } catch { return null } })
    .filter((u): u is string => !!u)
  return [...new Set([...hosts, 'https://fal.media', 'https://v3.fal.media'])]
}

export function widgetHtml(origin: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #e2e8f0; background: transparent; }
  .card { border-radius: 18px; padding: 12px; background: linear-gradient(180deg, #0b0f1a, #070b14); border: 1px solid rgba(226,232,240,.14); }
  .head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .brand { font-weight: 800; letter-spacing: -.01em; background: linear-gradient(90deg, #f8fafc, #94a3b8, #e2e8f0); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .sub { margin-left: auto; font: 10px ui-monospace, monospace; text-transform: uppercase; letter-spacing: .18em; color: #64748b; }
  .grid { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
  .grid.one { grid-template-columns: 1fr; }
  .tile { position: relative; border-radius: 12px; overflow: hidden; background: #0f1524; border: 1px solid rgba(255,255,255,.08); }
  .tile img, .tile video { display: block; width: 100%; height: auto; max-height: 520px; object-fit: contain; background: #05080f; }
  .ph { aspect-ratio: 16/10; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #94a3b8; font-size: 12px; text-align: center; padding: 12px; }
  .spin { width: 22px; height: 22px; border-radius: 50%; border: 2px solid rgba(226,232,240,.18); border-top-color: #e2e8f0; animation: s 1s linear infinite; }
  @keyframes s { to { transform: rotate(360deg); } }
  .meta { display: flex; align-items: center; gap: 6px; padding: 7px 9px; font-size: 11px; color: #94a3b8; }
  .meta b { color: #e2e8f0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta .t { margin-left: auto; white-space: nowrap; color: #cbd5e1; }
  .meta a { color: #e2e8f0; text-decoration: none; border: 1px solid rgba(255,255,255,.15); border-radius: 999px; padding: 2px 8px; white-space: nowrap; }
  .fail { color: #fca5a5; }
  .empty { color: #64748b; padding: 8px 2px; }
</style></head>
<body><div class="card"><div class="head"><span class="brand">AI Design Studio</span><span class="sub" id="sub"></span></div><div id="out" class="empty">Working…</div></div>
<script>
(function () {
  var ORIGIN = ${JSON.stringify(origin)};
  var out = document.getElementById('out'), sub = document.getElementById('sub');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function open(url) {
    if (window.openai && window.openai.openExternal) { window.openai.openExternal({ href: url }); return; }
    if (bridge) { rpc('ui/open-link', { url: url }); return; }
    window.open(url, '_blank', 'noopener');
  }
  function render(data) {
    var items = (data && data.items) || [];
    if (!items.length) { out.className = 'empty'; out.textContent = data && data.library ? 'Nothing found.' : 'Working…'; return; }
    var spent = items.reduce(function (a, i) { return a + (i.tickets || 0); }, 0);
    sub.textContent = data.library ? 'your library' : (spent ? spent + ' tickets' : '');
    out.className = 'grid' + (items.length === 1 ? ' one' : '');
    out.innerHTML = items.map(function (it, n) {
      var media = it.status === 'done' && it.url
        ? (it.kind === 'video'
            ? '<video src="' + esc(it.url) + '" ' + (it.thumb ? 'poster="' + esc(it.thumb) + '" ' : '') + 'controls playsinline preload="metadata"></video>'
            : '<img src="' + esc(it.thumb || it.url) + '" alt="' + esc(it.prompt) + '" loading="lazy">')
        : it.status === 'rendering'
          ? '<div class="ph"><div class="spin"></div>' + (it.kind === 'video' ? 'Your video is rendering - usually 1-5 minutes.<br>Ask to check on it.' : 'Still rendering…') + '</div>'
          : '<div class="ph fail">' + esc(it.error || 'Failed') + '<br>Tickets were refunded.</div>';
      var link = it.status === 'done' && it.url ? '<a href="#" data-n="' + n + '">Open</a>' : '';
      return '<div class="tile">' + media + '<div class="meta"><b>' + esc(it.model) + (it.id ? ' · #' + it.id : '') + '</b><span class="t">' + (it.tickets ? it.tickets + ' t' : '') + '</span>' + link + '</div></div>';
    }).join('');
    Array.prototype.forEach.call(out.querySelectorAll('a[data-n]'), function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); var it = items[+a.getAttribute('data-n')]; open(it.url); });
    });
  }

  // ChatGPT (Apps SDK)
  if (window.openai) {
    render(window.openai.toolOutput);
    window.addEventListener('openai:set_globals', function () { render(window.openai.toolOutput); });
    return;
  }

  // MCP Apps (Claude and others): JSON-RPC over postMessage
  var bridge = window.parent && window.parent !== window, seq = 0;
  function rpc(method, params) { window.parent.postMessage({ jsonrpc: '2.0', id: ++seq, method: method, params: params }, '*'); }
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || m.jsonrpc !== '2.0') return;
    if (m.id === 1 && m.result) window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
    if (m.method === 'ui/notifications/tool-result') render((m.params && m.params.structuredContent) || {});
    if (m.method === 'ui/resource-teardown' && m.id != null) window.parent.postMessage({ jsonrpc: '2.0', id: m.id, result: {} }, '*');
  });
  if (bridge) rpc('ui/initialize', { protocolVersion: '2026-01-26', clientInfo: { name: 'ai-design-studio-results', version: '1.0.0' }, appCapabilities: {}, capabilities: {} });
  void ORIGIN;
})();
</script></body></html>`
}
