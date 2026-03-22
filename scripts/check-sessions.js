'use strict';
const fs = require('fs');
const ids = ['305e444c-a4d6-49fb-93e8-39bdd0e7e0da','30f6a40d-01ca-4100-bc8b-9af48e52770c','1b5bd2fe-4e10-4169-89db-aca813b9eff5'];
for (const id of ids) {
  const s = JSON.parse(fs.readFileSync('data/sessions/'+id+'.json','utf8'));
  const archives = s.statData && s.statData.Multiverse && s.statData.Multiverse.Archives || {};
  const keys = Object.keys(archives);
  const muv = keys.find(function(k){ return k.indexOf('Muv') >= 0 || k.indexOf('ALT') >= 0 || k.indexOf('muv') >= 0; });
  const npcCount = muv ? ((archives[muv].NPCs || []).length) : 'N/A';
  console.log(id.slice(0,8), '| worlds:', keys.join(', ') || 'none', '| MUV NPCs:', npcCount);
}
