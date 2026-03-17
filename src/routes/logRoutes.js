'use strict';
/**
 * Log Routes — log viewer and API.
 * GET /api/logs
 * GET /api/logs/files
 * GET /logs (HTML log viewer page)
 */

const log = require('../core/logger');

function registerRoutes(app, deps) {

  app.get('/api/logs', (req, res) => {
    try {
      const lines = parseInt(req.query.lines) || 200;
      res.json({ lines: log.tail(lines) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/logs/files', (req, res) => {
    try {
      res.json({ files: log.listFiles() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/logs', (req, res) => {
    const all     = req.query.all === '1';
    const lines   = all ? Infinity : (parseInt(req.query.lines) || 500);
    const entries = log.tail(lines);
    const html = `<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="UTF-8"><title>运行日志</title>
<style>
  body{background:#0d0d1a;color:#b8bfca;font-family:monospace;font-size:12px;margin:0;padding:16px}
  h2{color:#e8c87a;margin:0 0 12px}
  .toolbar{display:flex;gap:10px;margin-bottom:12px;align-items:center;flex-wrap:wrap}
  .toolbar a,.toolbar button{background:#1e1e2e;color:#b8bfca;border:1px solid #3a3a4e;padding:4px 12px;
    border-radius:4px;text-decoration:none;cursor:pointer;font-size:11px}
  .toolbar a.active{border-color:#7ab8e8;color:#7ab8e8}
  .log{background:#0a0a14;border:1px solid #2a2a3a;border-radius:6px;padding:12px;
    white-space:pre;overflow:auto;max-height:80vh;line-height:1.5}
  .INFO{color:#b8bfca}.WARN{color:#e8c050}.ERROR{color:#e07070}
  .CHAT{color:#c890e8}.API{color:#7ab8e8}.HTTP{color:#6a8a6a}.SHOP{color:#8ab870}
  .SESS{color:#a870b8}.DEBUG{color:#555}
</style></head><body>
<h2>运行日志</h2>
<div class="toolbar">
  <a href="/logs?lines=200"${!all && lines===200?' class="active"':''}>最近 200 行</a>
  <a href="/logs?lines=500"${!all && lines===500?' class="active"':''}>最近 500 行</a>
  <a href="/logs?lines=2000"${!all && lines===2000?' class="active"':''}>最近 2000 行</a>
  <a href="/logs?all=1"${all?' class="active"':''}>全部日志</a>
  <button onclick="location.reload()">↺ 刷新</button>
  <button onclick="scrollTo(0,document.body.scrollHeight)">↓ 到底部</button>
  <span style="color:#556;font-size:11px">共 ${entries.length} 行</span>
</div>
<div class="log">${entries.map((l) => {
  const m   = l.match(/\] \[(\w+)\s*\]/);
  const cls = m ? m[1] : '';
  return `<span class="${cls}">${l.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>`;
}).join('\n')}</div>
<script>scrollTo(0,document.body.scrollHeight);</script>
</body></html>`;
    res.type('html').send(html);
  });
}

module.exports = { registerRoutes };
