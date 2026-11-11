const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('  function cardItemsFor(');
const end = html.indexOf('  function renderCardItemsBody(', start);
assert(start > 0 && end > start);
const balanceEl = {textContent:''};
const availableEl = {textContent:'', classList:{toggle:()=>{}}};
const ctx = {
  cardItems:[
    {card_id:'a',amount:'1400',entry_type:'opening_balance'},
    {card_id:'a',amount:'200',entry_type:'purchase'},
    {card_id:'a',amount:'100',entry_type:'payment'}
  ],
  creditCards:[{id:'a',credit_limit:2000}],
  document:{querySelector:selector => selector.includes('card-balance') ? balanceEl : availableEl},
  fmt:value => `£${Number(value).toFixed(2)}`,
  flash:()=>{}
};
const {cardBalance,recalcCardTotal} = vm.runInNewContext(html.slice(start,end) + '\n({cardBalance,recalcCardTotal})',ctx);
assert.equal(cardBalance('a'),1500);
recalcCardTotal('a');
assert.equal(balanceEl.textContent,'£1500.00');
assert.equal(availableEl.textContent,'£500.00');
ctx.cardItems.push({card_id:'a',amount:'500',entry_type:'payment'});
recalcCardTotal('a');
assert.equal(balanceEl.textContent,'£1000.00');
assert.equal(availableEl.textContent,'£1000.00');
ctx.creditCards[0].credit_limit = null;
recalcCardTotal('a');
assert.equal(availableEl.textContent,'Set a credit limit');
assert.match(html,/Record a payment/);
assert.match(html,/Next payment due/);
console.log('Credit card balance, payment, and limit checks passed');


