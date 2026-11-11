const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'),'utf8');
const start = html.indexOf('  async function loadAllData(){');
const end = html.indexOf('  // ---------- boot ----------',start);
assert(start > 0 && end > start);
const ids = ['accountEmail','outgoingsBody','cardsContainer','schedBlocks','nextPill','outgoingNextPill','historyBody','historyTotalLine'];
const nodes = Object.fromEntries(ids.map(id=>[id,{innerHTML:'old account data',textContent:'old account data'}]));
let hidden=false;
const ctx = {
  firstRender:false,
  app:{classList:{add:()=>{hidden=true}}},loadingScreen:{classList:{remove:()=>{}}},
  outgoings:[{id:'old'}],creditCards:[{id:'old'}],cardItems:[{id:'old'}],schedules:[{id:'old'}],receivedPayments:[{id:'old'}],income:500,
  pendingSaves:new Map(),failedSaves:new Map(),updateSaveStatus:()=>{},
  historyRows:[{name:'old'}],historyPanel:{classList:{add:()=>{}}},historyBtn:{textContent:''},historySelect:{innerHTML:''},
  document:{getElementById:id=>nodes[id]},uid:()=> 'new-account',session:{user:{email:'new@example.test'}},
  sb:{schema:()=>({from:()=>({select:()=>({eq:async()=>({error:new Error('offline')})})})})},
  requireData:()=>{throw Error('offline')},clearTimeout
};
const api = vm.runInNewContext(html.slice(start,end)+'\n({loadAllData,read:()=>({outgoings,creditCards,cardItems,schedules,receivedPayments,income,historyRows})})',ctx);
(async()=>{
  await assert.rejects(api.loadAllData(),/offline/);
  assert.equal(hidden,true);
  for(const id of ['outgoingsBody','cardsContainer','schedBlocks','nextPill','outgoingNextPill','historyBody']) assert.equal(nodes[id].innerHTML,'');
  const state=api.read();
  for(const key of ['outgoings','creditCards','cardItems','schedules','receivedPayments']) assert.equal(state[key].length,0);
  assert.equal(state.income,0);
  assert.equal(state.historyRows,null);
  console.log('Account-switch error isolation check passed');
})().catch(error=>{console.error(error);process.exitCode=1});

