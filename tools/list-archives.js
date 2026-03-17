'use strict';
const store = require('../src/features/world/worldArchiveStore');
const archives = store.loadArchives();
console.log('Total archives:', archives.length);
archives.forEach(a => {
  const tl = a.timeline;
  const tlInfo = Array.isArray(tl) && tl.length > 0 ? tl.length + ' entries' : 'MISSING';
  console.log(`  [${a.id}] ${a.displayName} | timeline: ${tlInfo}`);
});
