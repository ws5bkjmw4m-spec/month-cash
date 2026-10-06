// Balances are derived from immutable opening balances and a shared journal.
// A transfer is one entry so its debit and credit can never be imported separately.
const ASSET_MAX=1e12;
function emptyWallet(){return {accounts:[{id:'cash',name:'現金',kind:'cash',openingBalance:0}],entries:[]}}
function walletBalances(wallet){
  const balances=new Map(wallet.accounts.map(a=>[a.id,a.openingBalance]));
  for(const entry of wallet.entries){
    if(entry.kind==='transfer'){
      balances.set(entry.from,balances.get(entry.from)-entry.amount);
      balances.set(entry.to,balances.get(entry.to)+entry.amount);
    }else balances.set(entry.accountId,balances.get(entry.accountId)+entry.amount);
  }
  return balances;
}
function validWalletBackup(wallet){
  if(!wallet||!Array.isArray(wallet.accounts)||!Array.isArray(wallet.entries)||wallet.accounts.length<1||wallet.accounts.length>100||wallet.entries.length>10000)return false;
  const id=x=>typeof x==='string'&&x.length>0&&x.length<=150;
  const ids=new Set();let cashCount=0;
  for(const a of wallet.accounts){
    if(!a||!id(a.id)||ids.has(a.id)||typeof a.name!=='string'||!a.name.trim()||a.name.length>40||!['cash','bank'].includes(a.kind)||!Number.isSafeInteger(a.openingBalance)||a.openingBalance<0||a.openingBalance>ASSET_MAX)return false;
    if(a.kind==='cash'){cashCount++;if(a.id!=='cash'||a.name!=='現金'||a.openingBalance!==0)return false}
    if(a.kind==='bank'&&a.id==='cash')return false;
    ids.add(a.id);
  }
  if(cashCount!==1)return false;
  const journalIds=new Set();
  for(const e of wallet.entries){
    if(!e||!id(e.id)||journalIds.has(e.id)||!Number.isSafeInteger(e.amount)||e.amount===0||Math.abs(e.amount)>ASSET_MAX||typeof e.note!=='string'||e.note.length>80||!validAssetDate(e.date)||!Number.isSafeInteger(e.recordedAt)||e.recordedAt<0)return false;
    if(e.kind==='transfer'){if(e.amount<0||e.from===e.to||!ids.has(e.from)||!ids.has(e.to))return false}
    else if(e.kind==='adjustment'){if(!ids.has(e.accountId))return false}
    else return false;
    journalIds.add(e.id);
  }
  return [...walletBalances(wallet).values()].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=ASSET_MAX);
}
function validAssetDate(value){
  if(typeof value!=='string'||!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value))return false;
  const d=new Date(value+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
}
function accountSignature(a){return JSON.stringify([a.id,a.name,a.kind,a.openingBalance])}
function entrySignature(e){return JSON.stringify([e.id,e.kind,e.amount,e.date,e.note,e.recordedAt,e.from,e.to,e.accountId])}
function mergeWallet(local,incoming){
  if(incoming===undefined)return local;
  if(!validWalletBackup(incoming))throw new Error('現金與帳戶的資料格式不符');
  const accounts=new Map(local.accounts.map(a=>[a.id,a]));
  for(const a of incoming.accounts){
    if(accounts.has(a.id)&&accountSignature(accounts.get(a.id))!==accountSignature(a))throw new Error('同一帳戶的起始資料不同，未匯入任何資料。請使用來源裝置的完整備份。');
    accounts.set(a.id,a);
  }
  const localEntries=new Map(local.entries.map(e=>[e.id,e]));
  const incomingEntries=new Map(incoming.entries.map(e=>[e.id,e]));
  for(const [id,e] of incomingEntries)if(localEntries.has(id)&&entrySignature(localEntries.get(id))!==entrySignature(e))throw new Error('同一筆資產紀錄內容不同，未匯入任何資料。');
  // Two separately edited devices have no reliable shared current balance.
  const localOnly=local.entries.some(e=>!incomingEntries.has(e.id));
  const incomingOnly=incoming.entries.some(e=>!localEntries.has(e.id));
  if(localOnly&&incomingOnly)throw new Error('兩份備份各有不同的資產異動，無法安全合併餘額；未匯入任何資料。請先各自下載備份，再確認要保留哪個裝置的餘額。');
  const merged={accounts:[...accounts.values()],entries:incomingOnly?incoming.entries:local.entries};
  if(!validWalletBackup(merged))throw new Error('合併後的帳戶餘額不符，未匯入任何資料');
  return merged;
}
state.wallet=state.wallet||emptyWallet();
let assetHistoryLimit=20;
function assetDate(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function assetStatus(id,message,error=false){const node=$(id);node.textContent=message;node.classList.toggle('error',error)}
function saveWallet(wallet,statusId,message){
  if(!validWalletBackup(wallet)){assetStatus(statusId,'資料無法儲存，請檢查金額與紀錄數量。',true);return false}
  const next={...state,wallet};
  try{localStorage.setItem(KEY,JSON.stringify(next))}
  catch(error){assetStatus(statusId,'儲存失敗，餘額尚未變更。請確認瀏覽器儲存空間，再重試。',true);return false}
  state=next;renderAssets();assetStatus(statusId,message);toast(message);return true;
}
function populateAccounts(select,excluded=''){
  const selected=select.value;
  select.replaceChildren();
  for(const a of state.wallet.accounts)if(a.id!==excluded){const option=el('option','',a.name);option.value=a.id;select.append(option)}
  if([...select.options].some(o=>o.value===selected))select.value=selected;
}
function updateTransferChoices(){populateAccounts($('transfer-to'),$('transfer-from').value);updateTransferBalance()}
function updateTransferBalance(){const b=walletBalances(state.wallet);$('transfer-balance').textContent=state.wallet.accounts.length<2?'新增一個帳戶後，就可以記錄存款、提款或轉帳。':'可轉出餘額：'+money(b.get($('transfer-from').value)||0);$('transfer-submit').disabled=state.wallet.accounts.length<2}
function updateBalanceInput(){$('balance-amount').value=walletBalances(state.wallet).get($('balance-account').value)??0}
function renderAssets(){
  const wallet=state.wallet,balances=walletBalances(wallet);
  const cash=balances.get('cash'),bank=wallet.accounts.filter(a=>a.kind==='bank').reduce((sum,a)=>sum+balances.get(a.id),0);
  $('assets-total').textContent=money(cash+bank);$('cash-total').textContent=money(cash);$('bank-total').textContent=money(bank);
  $('bank-count').textContent=wallet.accounts.length-1+' 個帳戶';
  $('accounts-list').replaceChildren();
  for(const a of wallet.accounts){
    const item=el('div','row account-row'),content=el('div','row-main');
    content.append(el('div','row-title',a.name),el('div','row-meta',a.kind==='cash'?'隨身現金':'銀行／其他帳戶'));
    const button=el('button','secondary-action','調整餘額');button.type='button';button.setAttribute('aria-label','調整 '+a.name+' 餘額');
    button.addEventListener('click',()=>{$('balance-account').value=a.id;updateBalanceInput();$('balance-amount').focus();$('balance-form').scrollIntoView({behavior:'smooth',block:'center'})});
    item.append(el('div','icon',a.kind==='cash'?'◈':'▤'),content,el('div','account-balance',money(balances.get(a.id))),button);$('accounts-list').append(item);
  }
  populateAccounts($('balance-account'));updateBalanceInput();populateAccounts($('transfer-from'));updateTransferChoices();
  const names=new Map(wallet.accounts.map(a=>[a.id,a.name]));
  const history=wallet.entries.map((entry,index)=>({entry,index})).sort((a,b)=>b.entry.recordedAt-a.entry.recordedAt||b.index-a.index);
  $('asset-history-list').replaceChildren();
  if(!history.length)$('asset-history-list').append(empty('設定餘額或轉移金額後，紀錄會顯示在這裡。'));
  for(const {entry:e} of history.slice(0,assetHistoryLimit)){
    const item=el('div','row'),content=el('div','row-main');
    const title=e.kind==='transfer'?names.get(e.from)+' → '+names.get(e.to):names.get(e.accountId)+' · 餘額調整';
    content.append(el('div','row-title',title),el('div','row-meta',e.date+(e.note?' · '+e.note:'')));
    const amount=e.kind==='transfer'?money(e.amount):(e.amount>0?'+':'−')+money(Math.abs(e.amount));
    item.append(el('div','icon',e.kind==='transfer'?'⇄':'≈'),content,el('div','row-amount',amount));$('asset-history-list').append(item);
  }
  $('history-count').textContent=history.length+' 筆異動';$('history-more').hidden=history.length<=assetHistoryLimit;
}
function setPage(page){
  for(const name of ['ledger','assets']){
    $('page-'+name).hidden=name!==page;
    $('tab-'+name).setAttribute('aria-selected',String(name===page));
    $('tab-'+name).tabIndex=name===page?0:-1;
  }
}
for(const name of ['ledger','assets']){
  $('tab-'+name).addEventListener('click',()=>setPage(name));
  $('tab-'+name).addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const target=e.key==='Home'?'ledger':e.key==='End'?'assets':name==='ledger'?'assets':'ledger';setPage(target);$('tab-'+target).focus()}});
}
$('account-form').addEventListener('submit',e=>{
  e.preventDefault();const name=$('account-name').value.trim(),amount=Number($('account-opening').value);
  if(!name||!Number.isSafeInteger(amount)||amount<0||amount>ASSET_MAX){assetStatus('account-status','請填寫帳戶名稱及有效的整數金額。',true);return}
  if(state.wallet.accounts.some(a=>a.name===name)){assetStatus('account-status','已經有相同名稱的帳戶，請使用不同名稱。',true);return}
  const wallet={...state.wallet,accounts:[...state.wallet.accounts,{id:uid(),name,kind:'bank',openingBalance:amount}]};
  if(saveWallet(wallet,'account-status','已新增 '+name)){$('account-form').reset();$('account-opening').value=0}
});
$('balance-account').addEventListener('change',updateBalanceInput);
$('balance-form').addEventListener('submit',e=>{
  e.preventDefault();const accountId=$('balance-account').value,amount=Number($('balance-amount').value),balance=walletBalances(state.wallet).get(accountId);
  if(balance===undefined||!Number.isSafeInteger(amount)||amount<0||amount>ASSET_MAX){assetStatus('balance-status','請輸入有效的非負整數餘額。',true);return}
  const delta=amount-balance;
  if(delta===0){assetStatus('balance-status','餘額相同，沒有新增異動紀錄。');return}
  const entry={id:uid(),kind:'adjustment',accountId,amount:delta,date:assetDate(),recordedAt:Date.now(),note:$('balance-note').value.trim()||'餘額校正'};
  if(saveWallet({...state.wallet,entries:[...state.wallet.entries,entry]},'balance-status','已更新餘額'))$('balance-note').value='';
});
$('transfer-from').addEventListener('change',updateTransferChoices);
$('transfer-form').addEventListener('submit',e=>{
  e.preventDefault();const from=$('transfer-from').value,to=$('transfer-to').value,amount=Number($('transfer-amount').value),date=$('transfer-date').value;
  const balances=walletBalances(state.wallet);
  if(!balances.has(from)||!balances.has(to)||from===to){assetStatus('transfer-status','請選擇兩個不同的來源與目的帳戶。',true);return}
  if(!Number.isSafeInteger(amount)||amount<=0||amount>ASSET_MAX||!validAssetDate(date)){assetStatus('transfer-status','請填寫有效日期及大於零的整數金額。',true);return}
  if(amount>balances.get(from)){assetStatus('transfer-status','來源餘額不足，目前可轉出 '+money(balances.get(from))+'。',true);return}
  if(balances.get(to)+amount>ASSET_MAX){assetStatus('transfer-status','轉入後的餘額超過可記錄上限。',true);return}
  const entry={id:uid(),kind:'transfer',from,to,amount,date,recordedAt:Date.now(),note:$('transfer-note').value.trim()};
  if(saveWallet({...state.wallet,entries:[...state.wallet.entries,entry]},'transfer-status','已轉移 '+money(amount))){$('transfer-amount').value='';$('transfer-note').value=''}
});
$('history-more').addEventListener('click',()=>{assetHistoryLimit+=20;renderAssets()});
$('transfer-date').value=assetDate();renderAssets();
