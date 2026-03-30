'use strict';
/**
 * 更新前拉取：检测本地未提交修改，可按类别（脚本 / JSON / 代码 / 其他）
 * 分别选择「远端覆盖」或「保留本地」，也可一键 stash 或 reset。
 * 由 update.bat 调用；仓库根目录：node scripts/update-pull.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');

/** 视为「脚本/工具链」的路径（优先于下面的 json/code 规则） */
const SCRIPT_PATH_RES = [
  /^update\.bat$/i,
  /^start\.bat$/i,
  /^update_ui\.js$/i,
  /^scripts\/.*\.(js|mjs|cjs|bat|cmd)$/i,
  /^tools\/.*\.(js|bat|cmd)$/i,
];

const BUCKET_ORDER = ['script', 'json', 'code', 'other'];

const BUCKET_LABEL = {
  script: '脚本 / 批处理 / 工具链（update.bat、scripts、tools 等）',
  json: 'JSON（配置、数据等）',
  code: '代码与前端（js/ts/vue/css/html 等）',
  other: '其他文件（md、yaml、图片等）',
};

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** @returns {'script'|'json'|'code'|'other'} */
function classifyPath(rel) {
  const n = toPosix(rel);
  if (SCRIPT_PATH_RES.some((re) => re.test(n))) return 'script';
  if (/\.json$/i.test(n)) return 'json';
  if (/\.(js|mjs|cjs|jsx|tsx|ts|vue|css|scss|less|sass|html|htm|svelte)$/i.test(n)) return 'code';
  return 'other';
}

function gitSpawn(argv, opts = {}) {
  return spawnSync('git', argv, {
    encoding: 'utf-8',
    cwd: ROOT,
    ...opts,
  });
}

function gitOk(argv) {
  const r = gitSpawn(argv);
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

function getModifiedFiles() {
  const r = gitSpawn(['diff', 'HEAD', '--name-only']);
  if (r.status !== 0) {
    console.error((r.stderr || r.stdout || '').trim() || 'git diff 失败');
    process.exit(1);
  }
  const out = (r.stdout || '').trim();
  if (!out) return [];
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function getUpstreamBranch() {
  const u = gitOk(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (u) return u;
  const b = gitOk(['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
  return `origin/${b}`;
}

function readBackups(relPaths) {
  const backups = new Map();
  for (const rel of relPaths) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) {
      try {
        backups.set(rel, fs.readFileSync(abs));
      } catch (_) {
        backups.set(rel, null);
      }
    }
  }
  return backups;
}

function writeBackups(backups) {
  for (const [rel, content] of backups) {
    if (content == null) continue;
    const abs = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

function stashPullPop() {
  const st = gitSpawn(['stash', 'push', '-m', 'ai-vn-update-pull']);
  const msg = `${st.stderr || ''}\n${st.stdout || ''}`;
  const noLocal = /no local changes to save/i.test(msg);
  if (st.status !== 0 && !noLocal) {
    console.error(msg.trim() || 'git stash 失败');
    process.exit(1);
  }
  const hadStash = st.status === 0 && !noLocal;

  const pull = spawnSync('git', ['pull'], { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' });
  if (pull.status !== 0) {
    console.error('\n[错误] git pull 失败。');
    if (hadStash) {
      spawnSync('git', ['stash', 'pop'], { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' });
    }
    process.exit(1);
  }

  if (hadStash) {
    const pop = spawnSync('git', ['stash', 'pop'], { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' });
    if (pop.status !== 0) {
      console.error('\n[提示] git stash pop 出现冲突，请手动解决后继续使用仓库。');
      process.exit(1);
    }
  }
}

function checkoutRemotePaths(upstream, relPaths) {
  if (!relPaths.length) return;
  const args = ['checkout', upstream, '--', ...relPaths];
  const r = spawnSync('git', args, { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`\n[错误] 无法从 ${upstream} 检出指定文件。`);
    process.exit(1);
  }
}

function askLine(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      resolve((ans || '').trim());
    });
  });
}

function requireTty() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('[错误] 需要交互式终端。请在 CMD / PowerShell 中运行 update.bat，或先自行 git stash / commit。');
    process.exit(1);
  }
}

function splitIntoBuckets(modified) {
  /** @type {Record<string, string[]>} */
  const buckets = { script: [], json: [], code: [], other: [] };
  for (const f of modified) {
    buckets[classifyPath(f)].push(f);
  }
  return buckets;
}

function printBucketSummary(buckets) {
  console.log('\n检测到以下未提交修改（相对当前提交）：\n');
  for (const key of BUCKET_ORDER) {
    const files = buckets[key];
    if (!files.length) continue;
    console.log(`【${BUCKET_LABEL[key]}】`);
    files.forEach((f) => console.log(`  · ${f}`));
    console.log('');
  }
}

/**
 * @returns {Promise<'per-bucket'|'stash-all'|'hard-reset'|'cancel'>}
 */
async function promptGlobalMenu() {
  requireTty();
  console.log('请选择总体策略：');
  console.log('  [0] 按类别分别选择：每一类可选「远端覆盖」或「保留本地」');
  console.log('  [8] 不分类：暂存全部 → 拉取 → 再恢复（可能与远端冲突）');
  console.log('  [9] 丢弃全部本地修改，与远端完全一致（危险）');
  console.log('  [q] 取消\n');
  const a = await askLine('请输入 0 / 8 / 9 / q：');
  const low = a.toLowerCase();
  if (low === 'q') return 'cancel';
  if (a === '0') return 'per-bucket';
  if (a === '8') return 'stash-all';
  if (a === '9') return 'hard-reset';
  console.error('无效输入，已取消。');
  return 'cancel';
}

/**
 * @param {Record<string, string[]>} buckets
 * @returns {Promise<Record<string, 'keep'|'overwrite'>>}
 */
async function promptPerBucketDecisions(buckets) {
  requireTty();
  /** @type {Record<string, 'keep'|'overwrite'>} */
  const decisions = {};
  for (const key of BUCKET_ORDER) {
    const files = buckets[key];
    if (!files.length) continue;

    console.log(`\n── ${BUCKET_LABEL[key]}（${files.length} 个文件）──`);
    console.log('  [1] 此类文件：使用远端版本覆盖（放弃本地改动）');
    console.log('  [2] 此类文件：保留你的本地版本');
    console.log('  [q] 取消整个更新\n');

    const a = await askLine('请选择 1 / 2 / q：');
    const low = a.toLowerCase();
    if (low === 'q') {
      console.log('已取消。');
      process.exit(1);
    }
    if (a === '1') decisions[key] = 'overwrite';
    else if (a === '2') decisions[key] = 'keep';
    else {
      console.error('无效输入，已取消。');
      process.exit(1);
    }
  }
  return decisions;
}

/**
 * @param {Record<string, string[]>} buckets
 * @param {Record<string, 'keep'|'overwrite'>} decisions
 */
function collectByDecision(buckets, decisions) {
  const keepFiles = [];
  const overwriteFiles = [];
  for (const key of BUCKET_ORDER) {
    const files = buckets[key];
    if (!files.length) continue;
    const d = decisions[key];
    if (d === 'keep') keepFiles.push(...files);
    else if (d === 'overwrite') overwriteFiles.push(...files);
  }
  return { keepFiles, overwriteFiles };
}

async function main() {
  process.chdir(ROOT);

  const fetchR = spawnSync('git', ['fetch'], { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' });
  if (fetchR.status !== 0) {
    console.error('\n[错误] git fetch 失败，请检查网络与远程配置。');
    process.exit(1);
  }

  const modified = getModifiedFiles();
  const upstream = getUpstreamBranch();

  if (modified.length === 0) {
    const pull = spawnSync('git', ['pull'], { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' });
    process.exit(pull.status === 0 ? 0 : 1);
  }

  const buckets = splitIntoBuckets(modified);
  printBucketSummary(buckets);

  const mode = await promptGlobalMenu();
  if (mode === 'cancel') {
    console.log('已取消。');
    process.exit(1);
  }

  if (mode === 'hard-reset') {
    const r = spawnSync('git', ['reset', '--hard', upstream], { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' });
    process.exit(r.status === 0 ? 0 : 1);
  }

  if (mode === 'stash-all') {
    stashPullPop();
    console.log('\n已按「暂存全部 → 拉取 → 恢复」完成。若有冲突请手动处理。');
    process.exit(0);
  }

  const decisions = await promptPerBucketDecisions(buckets);
  const { keepFiles, overwriteFiles } = collectByDecision(buckets, decisions);

  const backups = readBackups(keepFiles);
  stashPullPop();

  if (overwriteFiles.length) {
    checkoutRemotePaths(upstream, overwriteFiles);
  }
  if (keepFiles.length) {
    writeBackups(backups);
  }

  console.log('\n更新流程结束。');
  if (overwriteFiles.length) console.log(`  · 已用远端覆盖：${overwriteFiles.length} 个文件`);
  if (keepFiles.length) console.log(`  · 已保留本地：${keepFiles.length} 个文件`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
