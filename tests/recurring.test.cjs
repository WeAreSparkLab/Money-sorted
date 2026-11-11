const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'),'utf8');
const start = html.indexOf('  function planRecurringCarryForward(');
const end = html.indexOf("  document.getElementById('addOutgoing')",start);
assert(start > 0 && end > start);
const plan = vm.runInNewContext(html.slice(start,end)+'\nplanRecurringCarryForward');
const earlier = [
  {id:'rent-a',month:'2026-10-01',name:'Rent',amount:500,due_day:1,is_recurring:true},
  {id:'rent-b',month:'2026-10-01',name:'Rent',amount:600,due_day:1,is_recurring:true},
  {id:'old',month:'2026-09-01',name:'Old bill',amount:50,due_day:5,is_recurring:true}
];
const current = [{id:'current-a',month:'2026-11-01',name:'Rent',amount:500,due_day:1,is_recurring:true}];
const result = plan(current,earlier,'2026-11-01');
assert.equal(result.adoptions.length,1);
assert.equal(result.adoptions[0].seriesId,'rent-a');
assert.equal(result.inserts.length,1);
assert.equal(result.inserts[0].recurring_id,'rent-b');
assert.equal(result.inserts[0].amount,600);
assert.equal(plan([{id:'c',name:'Rent',amount:500,due_day:1,is_recurring:false}],earlier.slice(0,1),'2026-11-01').inserts.length,0);
assert.equal(plan([], [{id:'x',month:'2026-10-01',is_recurring:false},...earlier.filter(r=>r.month==='2026-09-01')], '2026-11-01').inserts.length,0);
assert.equal(plan([], [], '2026-11-01').inserts.length,0);
console.log('Recurring series and partial-month checks passed');


