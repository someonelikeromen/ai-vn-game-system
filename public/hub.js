'use strict';

const $ = (id) => document.getElementById(id);
let currentCfg = null;

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function setStatus(text, isError = false) {
  const el = $('cfgStatus');
  el.textContent = text;
  el.style.color = isError ? 'var(--danger)' : 'var(--text2)';
}

function setHealthStatus(text, isError = false) {
  const el = $('healthStatus');
  el.textContent = text;
  el.style.color = isError ? 'var(--danger)' : 'var(--text2)';
}

function healthItem(label, status, note) {
  const cls = status === 'ok' ? 'ok' : status === 'warn' ? 'warn' : 'err';
  const txt = status === 'ok' ? '通过' : status === 'warn' ? '需关注' : '未配置';
  return `<div class="hub-health-item">
    <div>
      <div>${label}</div>
      <div style="font-size:12px;color:var(--text2)">${note || ''}</div>
    </div>
    <span class="hub-health-badge ${cls}">${txt}</span>
  </div>`;
}

function renderHealth(cfg) {
  const mainBase = !!cfg.baseUrl;
  const mainKey = !!cfg.apiKey;
  const mainModel = !!cfg.model;
  const shopOverride = !!(cfg.shopBaseUrl || cfg.shopApiKey || cfg.shopModel);
  const shopValid = shopOverride ? !!((cfg.shopBaseUrl || cfg.baseUrl) && (cfg.shopApiKey || cfg.apiKey) && (cfg.shopModel || cfg.model)) : true;

  $('healthList').innerHTML = [
    healthItem('主接口 BaseURL', mainBase ? 'ok' : 'err', mainBase ? cfg.baseUrl : '未填写'),
    healthItem('主接口 API Key', mainKey ? 'ok' : 'err', mainKey ? '已填写' : '未填写'),
    healthItem('主接口模型', mainModel ? 'ok' : 'err', mainModel ? cfg.model : '未填写'),
    healthItem('商城接口策略', shopOverride ? (shopValid ? 'ok' : 'warn') : 'ok', shopOverride ? '已启用覆盖' : '继承主接口'),
    healthItem('商城兑换快照', cfg.shopCharStateOnRedeem === 'off' ? 'warn' : 'ok', cfg.shopCharStateOnRedeem || 'off'),
  ].join('');
}

function readFormToCfg() {
  return {
    baseUrl: $('baseUrl').value.trim(),
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim(),
    temperature: parseFloat($('temperature').value) || 1,
    shopBaseUrl: $('shopBaseUrl').value.trim(),
    shopApiKey: $('shopApiKey').value.trim(),
    shopModel: $('shopModel').value.trim(),
    shopCharStateOnRedeem: $('shopCharStateOnRedeem').value,
  };
}

function fillForm(cfg) {
  $('baseUrl').value = cfg.baseUrl || '';
  $('apiKey').value = cfg.apiKey || '';
  $('model').value = cfg.model || '';
  $('temperature').value = cfg.temperature ?? 1;
  $('shopBaseUrl').value = cfg.shopBaseUrl || '';
  $('shopApiKey').value = cfg.shopApiKey || '';
  $('shopModel').value = cfg.shopModel || '';
  $('shopCharStateOnRedeem').value = cfg.shopCharStateOnRedeem || 'off';
}

async function loadConfig() {
  currentCfg = await api('GET', '/config');
  fillForm(currentCfg);
  renderHealth(currentCfg);
}

async function saveConfig() {
  const payload = readFormToCfg();
  await api('POST', '/config', payload);
  currentCfg = payload;
  renderHealth(currentCfg);
}

async function testConfig() {
  const res = await api('POST', '/config/test', {});
  if (!res.ok) throw new Error(res.error || '测试失败');
}

async function runHealthConnectivity() {
  setHealthStatus('连通性测试中...');
  try {
    await saveConfig();
    await testConfig();
    setHealthStatus('主接口连通性通过');
    window.UIFeedback?.toast('主接口测试通过', { type: 'success' });
  } catch (e) {
    setHealthStatus('连通性失败: ' + e.message, true);
    window.UIFeedback?.toast('连通性失败: ' + e.message, { type: 'error' });
  }
}

$('btnSaveCfg').addEventListener('click', async () => {
  try {
    await saveConfig();
    setStatus('已保存配置');
    window.UIFeedback?.toast('配置已保存', { type: 'success' });
  } catch (e) {
    setStatus('保存失败: ' + e.message, true);
    window.UIFeedback?.toast('保存失败: ' + e.message, { type: 'error' });
  }
});

$('btnTestCfg').addEventListener('click', async () => {
  try {
    await saveConfig();
    setStatus('测试中...');
    await testConfig();
    setStatus('主接口连接成功');
    window.UIFeedback?.toast('主接口连接成功', { type: 'success' });
  } catch (e) {
    setStatus('测试失败: ' + e.message, true);
    window.UIFeedback?.toast('测试失败: ' + e.message, { type: 'error' });
  }
});

$('btnRunHealth').addEventListener('click', () => {
  const cfg = readFormToCfg();
  renderHealth(cfg);
  setHealthStatus('体检已刷新');
});

$('btnRunConn').addEventListener('click', runHealthConnectivity);

document.querySelectorAll('input,select').forEach((el) => {
  el.addEventListener('input', () => renderHealth(readFormToCfg()));
  el.addEventListener('change', () => renderHealth(readFormToCfg()));
});

loadConfig().catch((e) => {
  setStatus('加载失败: ' + e.message, true);
  setHealthStatus('加载失败，无法体检', true);
});
