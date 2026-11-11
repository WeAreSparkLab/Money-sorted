const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'),'utf8');
assert.match(html,/class="badge paid-action \$\{paid \? 'paid' : 'due'/);
assert.match(html,/Include received payments/);
const start=html.indexOf('  function paymentIncomeForMonth(');
const end=html.indexOf('  // ---------- credit cards ----------',start);
assert(start>0 && end>start);
const elements=Object.fromEntries(['scheduleIncomeAmount','incomeUsedLine','scheduleIncomeHint','totalOutLine','remainingLine','weeklyLine'].map(id=>[id,{textContent:'',classList:{toggle:()=>{}}}]));
const NativeDate=Date;
class FixedDate extends NativeDate { constructor(...args){ super(...(args.length ? args : ['2026-11-10T12:00:00'])); } }
const ctx={
  Date:FixedDate,Number,Math,
  document:{getElementById:id=>elements[id]},
  outgoings:[{amount:'90'}],
  schedules:[{id:'schedule1',start_date:'2026-11-01',interval_days:28,amount:'100'}],
  receivedPayments:[{id:'receipt1',schedule_id:'schedule1',payment_date:'2026-11-01',received_on:'2026-11-10',amount:100}],
  income:50,includeScheduleIncome:true,
  currentMonthKey:()=> '2026-11-01',
  fmt:n=>(n<0?'-':'')+'£'+Math.abs(Number(n)).toFixed(2),
  flash:()=>{},updateOutgoingNextPill:()=>{}
};
const {paymentIncomeForMonth,recalcOutgoings}=vm.runInNewContext(html.slice(start,end)+'\n({paymentIncomeForMonth,recalcOutgoings})',ctx);
assert.equal(paymentIncomeForMonth(ctx.schedules,'2026-11-01'),100);
assert.equal(paymentIncomeForMonth(ctx.schedules,'2026-12-01'),0);
assert.equal(paymentIncomeForMonth([{id:'dla',start_date:'2026-11-17',frequency:'four_weekly',amount:428}],'2026-11-01'),0);
assert.equal(paymentIncomeForMonth([{id:'child',start_date:'2026-11-10',frequency:'four_weekly',amount:100}],'2026-11-01'),0);
ctx.receivedPayments.push({id:'receipt2',schedule_id:'child',payment_date:'2026-11-10',received_on:'2026-11-10',amount:100});
assert.equal(paymentIncomeForMonth([{id:'child',start_date:'2026-11-10',frequency:'four_weekly',amount:100}],'2026-11-01'),100);
ctx.receivedPayments.pop();
recalcOutgoings();
assert.equal(elements.incomeUsedLine.textContent,'Income used — £150.00');
assert.equal(elements.remainingLine.textContent,'Left over — £60.00');
ctx.includeScheduleIncome=false;
recalcOutgoings();
assert.equal(elements.incomeUsedLine.textContent,'Income used — £50.00');
assert.equal(elements.remainingLine.textContent,'Left over — -£40.00');
ctx.includeScheduleIncome=true;
ctx.schedules=[{id:'zero',start_date:'2026-11-10',interval_days:28,amount:0}];
recalcOutgoings();
assert.match(elements.scheduleIncomeHint.textContent,/No payments marked paid/);
console.log('Payment income and toggle regression checks passed');



