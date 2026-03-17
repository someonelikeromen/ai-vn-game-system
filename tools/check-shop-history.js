'use strict';
const sp = require('../src/features/shop/shopPrompt.js');
const fs = require('fs');
const path = require('path');

const SESS_DIR = path.join(__dirname, '../data/sessions');
const files = fs.readdirSync(SESS_DIR).filter(f => f.endsWith('.json'));
const sess  = JSON.parse(fs.readFileSync(path.join(SESS_DIR, files[1]), 'utf-8'));

const snapFull = {
  CharacterSheet: sess.statData.CharacterSheet,
  Arsenal:        sess.statData.Arsenal,
  Multiverse:     { CurrentWorldName: sess.statData.Multiverse.CurrentWorldName },
};

const inv   = snapFull.CharacterSheet.ShopInventory || [];
const nonWT = inv.filter(i => i && i.name && i.type !== 'WorldTraverse');
console.log('Total ShopInventory:', inv.length, '| non-WorldTraverse:', nonWT.length);
nonWT.forEach(i => {
  const pts = i.pricePoints != null ? i.pricePoints + '积分' : '价格未记录（需简化估算）';
  console.log(`  - ${i.name} | ${i.tier ?? '?'}★ | ${pts} | ${i.type}`);
});

const msgs = sp.buildMessages('波纹气功升级测试', [], snapFull, 'JOJO');
const sys = msgs[0].content;
const usr = msgs[1].content;

// Search for history section
const HIST_KEY = '\u5386\u53f2\u5151\u6362\u8bb0\u5f55'; // 历史兑换记录
const hi     = usr.indexOf(HIST_KEY);
const hiSys  = sys.indexOf(HIST_KEY);
console.log('\nUser msg length:', usr.length, '| System msg length:', sys.length);
console.log('History section in USER msg  at:', hi);
console.log('History section in SYSTEM msg at:', hiSys);

if (hiSys >= 0) {
  console.log('\n--- System msg history section ---');
  console.log(sys.slice(hiSys, hiSys + 800));
} else {
  console.log('\n--- System msg tail (500 chars) ---');
  console.log(sys.slice(-500));
}
