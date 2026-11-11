const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('  function scheduleFrequency(');
const end = html.indexOf('  function renderSchedules()', start);
assert(start > 0 && end > start);
const code = html.slice(start, end);
const NativeDate = Date;
class FixedDate extends NativeDate {
  constructor(...args) { super(...(args.length ? args : ['2026-11-10T12:00:00'])); }
}
const nextPill = {innerHTML:''};
const ctx = {
  Date:FixedDate,
  schedules:[
    {id:'dla',label:'DLA',start_date:'2026-11-17',interval_days:28,amount:0},
    {id:'child',label:'Child Benefit',start_date:'2026-11-10',interval_days:28,amount:0}
  ],
  receivedPayments:[{id:'receipt1',schedule_id:'child',payment_date:'2026-11-10',received_on:'2026-11-10',amount:0}],
  document:{getElementById:()=>nextPill},
  dayFmt:d=>d.toLocaleDateString('en-GB',{day:'numeric',month:'long'}),
  localDateISO:d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
  escapeHtml:s=>s,
  fmt:n=>`£${n.toFixed(2)}`
};
const {occurrenceListHTML,updateNextPill,nextOccurrenceOnOrAfter} = vm.runInNewContext(code + '\n({occurrenceListHTML,updateNextPill,nextOccurrenceOnOrAfter})',ctx);
const dla = occurrenceListHTML(ctx.schedules[0]);
const child = occurrenceListHTML(ctx.schedules[1]);
assert.equal((dla.match(/class="sched-item"/g)||[]).length,2);
assert.equal((child.match(/class="sched-item"/g)||[]).length,2);
assert.match(dla,/17 November[^]*Mark paid/);
assert.match(child,/10 November[^]*Paid/);
assert.match(child,/8 December[^]*Mark paid/);
assert.match(occurrenceListHTML({start_date:null}),/Choose a payment date/);
const once = {start_date:'2026-11-17',frequency:'once',amount:100};
assert.equal(occurrenceListHTML(once).match(/class="sched-item"/g).length,1);
assert.match(occurrenceListHTML({id:'once',start_date:'2026-11-09',frequency:'once'}),/Mark paid/);
assert.equal(paymentDate(once,'2026-11-18'),null);
assert.equal(paymentDate({start_date:'2026-01-31',frequency:'monthly'},'2026-02-01'),'2026-02-28');
assert.equal(paymentDate({start_date:'2026-11-10',frequency:'weekly'},'2026-11-11'),'2026-11-17');
assert.equal(paymentDate({start_date:'2026-11-10',frequency:'fortnightly'},'2026-11-11'),'2026-11-24');
function paymentDate(sched,from){ const result = nextOccurrenceOnOrAfter(sched,new FixedDate(from+'T00:00:00')); return result && ctx.localDateISO(result); }
updateNextPill();
assert.match(nextPill.innerHTML,/Next payment · DLA/);
console.log('Payment schedule regression checks passed');




