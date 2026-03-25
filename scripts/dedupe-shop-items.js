'use strict';
/**
 * 清理 data/shop-items.json 中名称重复的商品（保留每组第一条，即文件中较新的记录）。
 * 不删除 system / baseAnchor 项。
 *
 * 签名规则与商店匹配接近：
 * - 整段商品名规范化后比对（含 — 后副标题，避免误合并不同兑换项）
 * - 「中文 / 英文」与「英文 / 中文」视为同一签名
 *
 * 用法: node scripts/dedupe-shop-items.js [--dry-run]
 */

const fs   = require('fs');
const path = require('path');

const SHOP_FILE = path.join(__dirname, '..', 'data', 'shop-items.json');

function normalize(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function splitBilingualParts(name) {
  const n = normalize(name);
  if (!n) return [];
  return n.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean);
}

/** 同一签名视为重复，只保留先出现的条目（文件顺序靠前 = 较新） */
function dedupeSignature(item) {
  if (item.system || item.baseAnchor) return null;
  const name = String(item.name || '').trim();
  const parts = splitBilingualParts(name);
  if (parts.length >= 2) {
    return [...parts].sort().join('\x01');
  }
  const n = normalize(name);
  return n || `__noname_${item.id}`;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!fs.existsSync(SHOP_FILE)) {
    console.error('找不到', SHOP_FILE);
    process.exit(1);
  }
  const items = JSON.parse(fs.readFileSync(SHOP_FILE, 'utf8'));
  if (!Array.isArray(items)) {
    console.error('shop-items.json 应为数组');
    process.exit(1);
  }

  const seen = new Set();
  const out = [];
  const removed = [];

  for (const item of items) {
    if (item.system || item.baseAnchor) {
      out.push(item);
      continue;
    }
    const sig = dedupeSignature(item);
    if (seen.has(sig)) {
      removed.push({ id: item.id, name: item.name, sig });
      continue;
    }
    seen.add(sig);
    out.push(item);
  }

  console.log(`总计 ${items.length} 条 → 保留 ${out.length} 条，移除重复 ${removed.length} 条`);
  removed.slice(0, 50).forEach((r) => {
    console.log(`  - ${r.name} [${r.id}]`);
  });
  if (removed.length > 50) {
    console.log(`  … 另有 ${removed.length - 50} 条`);
  }

  if (dryRun) {
    console.log('(--dry-run 未写入文件)');
    return;
  }

  if (removed.length > 0) {
    fs.writeFileSync(SHOP_FILE, JSON.stringify(out, null, 2), 'utf8');
    console.log('已写回', SHOP_FILE);
  } else {
    console.log('无重复，未修改文件');
  }
}

main();
