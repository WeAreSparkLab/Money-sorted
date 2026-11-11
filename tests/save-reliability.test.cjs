const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'),'utf8');
const start = html.indexOf('  const pendingSaves = new Map();');
const end = html.indexOf('  // ---------- helpers ----------',start);
assert(start > 0 && end > start);
const handlers = {};
const status = {textContent:'',classList:{toggle:()=>{}}};
const retry = {classList:{toggle:()=>{}},addEventListener:(name,fn)=>{handlers[name]=fn}};
const errors=[];
const ctx = {Map,Promise,setTimeout,clearTimeout,
  document:{getElementById:id=>id==='saveStatus'?status:retry,addEventListener:()=>{}},
  showDataError:error=>errors.push(error)
};
const api=vm.runInNewContext(html.slice(start,end)+'\n({queueSave,flushPendingSaves,failedSaves})',ctx);
(async()=>{
  let writes=0;
  api.queueSave('one',async()=>{writes++},600);
  api.queueSave('one',async()=>{writes+=10},600);
  assert.equal(await api.flushPendingSaves(),true);
  assert.equal(writes,10,'latest edit wins before save');
  assert.equal(status.textContent,'All changes saved');
  let shouldFail=true;
  api.queueSave('two',async()=>{if(shouldFail) throw Error('offline'); writes++},600);
  assert.equal(await api.flushPendingSaves(),false);
  assert.equal(errors.length,1);
  shouldFail=false;
  await handlers.click();
  assert.equal(api.failedSaves.size,0);
  assert.equal(writes,11);
  console.log('Save flush and retry checks passed');
})().catch(error=>{console.error(error);process.exitCode=1});


