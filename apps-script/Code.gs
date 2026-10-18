/**
 * 社群服務比價下單系統 — Google Apps Script 後端
 * 第一次使用：在 Apps Script 編輯器執行 setup()，再依 README 步驟部署。
 */

// ============ 工作表名稱與欄位 ============
const SH = {
  SETTINGS: '設定',
  PROVIDERS: '上游',
  PRODUCTS: '商品',
  MAPPING: '對應',
  SERVICES: '上游服務',
  ORDERS: '訂單',
};

const HEADERS = {
  [SH.SETTINGS]: ['項目', '值', '說明'],
  [SH.PROVIDERS]: ['名稱', 'API網址', 'API金鑰', '幣別', '啟用', '備註'],
  [SH.PRODUCTS]: ['商品ID', '平台', '名稱', '說明', '最少', '最多', '啟用', '排序', '售價每千'],
  [SH.MAPPING]: ['商品ID', '上游', '服務ID', '加權', '單價每千', '幣別', '最少', '最多', '補單', '台幣成本每千', '更新時間', '服務名稱'],
  [SH.SERVICES]: ['上游', '服務ID', '名稱', '分類', '類型', '單價每千', '最少', '最多', '補單', '可取消'],
  [SH.ORDERS]: ['訂單編號', '建立時間', '姓名', '聯絡方式', '商品ID', '商品名稱', '連結', '數量', '應付金額',
    '狀態', '匯款末五碼', '回報時間', '上游', '上游訂單號', '成本TWD', '利潤', '上游狀態', '剩餘', '備註', '更新時間'],
};

const DEFAULT_SETTINGS = [
  ['SITE_NAME', '人氣充電站', '網站名稱'],
  ['MARKUP', 2, '「商品」表沒填售價時，用 成本×(1+MARKUP) 定價（2 = 成本 3 倍）'],
  ['MIN_MARGIN', 0.30, '利潤保底：利潤至少要佔售價 30%，上游漲價時自動調高售價'],
  ['USD_TWD', 32.5, '美金匯率（上游用 USD 計價時換算）'],
  ['MIN_ORDER_TWD', 100, '最低訂單金額（台幣），太小的單不划算'],
  ['NO_REFILL_PENALTY', 0.20, '沒有補單保固的服務，比價時視為貴 20%'],
  ['ADMIN_KEY', 'change-me-' + Math.random().toString(36).slice(2, 10), '後台密碼，請改成自己的'],
  ['ADMIN_EMAIL', '', '有新訂單／客人回報匯款時寄信通知（可留空）'],
  ['BANK_INFO', '銀行：○○銀行(000)\n帳號：0000-0000-0000\n戶名：○○○', '匯款資訊，會顯示給客人'],
  ['LINE_OA_URL', 'https://line.me/R/ti/p/@your-id', 'LINE 官方帳號連結'],
];

const DEFAULT_PRODUCTS = [
  // 售價參考 KsD 同等級約 75 折（2026/10）
  ['IG_LIKE', 'Instagram', 'IG 貼文按讚（30 天補單）', '貼上公開貼文網址', 50, 20000, true, 1, 120],
  ['IG_FOLLOW', 'Instagram', 'IG 粉絲（30 天補單）', '貼上個人頁網址，帳號需公開。30 天內掉量可補回', 100, 10000, true, 2, 220],
  ['IG_FOLLOW_ECO', 'Instagram', 'IG 粉絲・經濟款（不補單）', '價格最低，但掉量較多且不補單。帳號需公開', 100, 20000, true, 3, 90],
  ['FB_LIKE', 'Facebook', 'FB 貼文按讚（30 天補單）', '貼上公開貼文網址', 100, 20000, true, 4, 28],
  ['FB_FOLLOW', 'Facebook', 'FB 粉專追蹤（90 天補單）', '貼上粉絲專頁網址', 100, 20000, true, 5, 38],
];

// JAP 服務對應（2026/10 從 JAP 後台挑選）
const DEFAULT_MAPPING = [
  ['IG_LIKE', 'JAP', 10065, 0], ['IG_LIKE', 'JAP', 10126, 0],
  ['IG_FOLLOW', 'JAP', 10242, 0], ['IG_FOLLOW', 'JAP', 10216, 0],
  ['IG_FOLLOW_ECO', 'JAP', 10350, 0],
  ['FB_LIKE', 'JAP', 9541, 0], ['FB_LIKE', 'JAP', 4351, 0],
  ['FB_FOLLOW', 'JAP', 7566, 0], ['FB_FOLLOW', 'JAP', 9548, 0],
];

const PLATFORM_DOMAINS = {
  Instagram: ['instagram.com', 'instagr.am'],
  Facebook: ['facebook.com', 'fb.com', 'fb.watch', 'm.facebook.com'],
  Threads: ['threads.net', 'threads.com'],
  TikTok: ['tiktok.com'],
  YouTube: ['youtube.com', 'youtu.be'],
};

// ============ 初始化 ============
function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(HEADERS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(HEADERS[name]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, HEADERS[name].length).setFontWeight('bold').setBackground('#eef2f7');
    }
  });
  const st = ss.getSheetByName(SH.SETTINGS);
  if (st.getLastRow() === 1) st.getRange(2, 1, DEFAULT_SETTINGS.length, 3).setValues(DEFAULT_SETTINGS);
  const pr = ss.getSheetByName(SH.PRODUCTS);
  if (pr.getLastRow() === 1) pr.getRange(2, 1, DEFAULT_PRODUCTS.length, 9).setValues(DEFAULT_PRODUCTS);
  const mp = ss.getSheetByName(SH.MAPPING);
  if (mp.getLastRow() === 1) mp.getRange(2, 1, DEFAULT_MAPPING.length, 4).setValues(DEFAULT_MAPPING);
  const pv = ss.getSheetByName(SH.PROVIDERS);
  if (pv.getLastRow() === 1) {
    pv.appendRow(['JAP', 'https://justanotherpanel.com/api/v2', '', 'USD', false, '填入 API 金鑰後把啟用改成 TRUE']);
  }
  ss.getSheetByName(SH.ORDERS).getRange('K:K').setNumberFormat('@'); // 末五碼保留前導 0
  const def = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
  installTriggers();
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('refreshPrices').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('syncStatuses').timeBased().everyMinutes(15).create();
}

// ============ 工具 ============
function sheet_(name) { return SpreadsheetApp.getActive().getSheetByName(name); }

function rows_(name) {
  const sh = sheet_(name);
  const data = sh.getDataRange().getValues();
  const head = data.shift();
  return data.map((r, i) => {
    const o = { _row: i + 2 };
    head.forEach((h, j) => o[h] = r[j]);
    return o;
  });
}

function setCells_(name, rowNum, obj) {
  const sh = sheet_(name);
  const head = HEADERS[name];
  Object.keys(obj).forEach(k => {
    const c = head.indexOf(k);
    if (c >= 0) sh.getRange(rowNum, c + 1).setValue(obj[k]);
  });
}

let SETTINGS_CACHE = null;
function settings_() {
  if (SETTINGS_CACHE) return SETTINGS_CACHE;
  const s = {};
  rows_(SH.SETTINGS).forEach(r => s[r['項目']] = r['值']);
  s.MARKUP = Number(s.MARKUP) || 0;
  s.MIN_MARGIN = Math.min(Number(s.MIN_MARGIN) || 0, 0.9);
  s.USD_TWD = Number(s.USD_TWD) || 32;
  s.MIN_ORDER_TWD = Number(s.MIN_ORDER_TWD) || 0;
  s.NO_REFILL_PENALTY = Number(s.NO_REFILL_PENALTY) || 0;
  SETTINGS_CACHE = s;
  return s;
}

function truthy_(v) { return v === true || String(v).toUpperCase() === 'TRUE' || v === 1 || v === '是'; }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function now_() { return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss'); }

function toTwd_(amount, currency) {
  const cur = String(currency || 'USD').toUpperCase();
  return cur === 'TWD' || cur === 'NTD' ? Number(amount) : Number(amount) * settings_().USD_TWD;
}

function providers_() {
  const m = {};
  rows_(SH.PROVIDERS).forEach(p => { if (p['名稱']) m[p['名稱']] = p; });
  return m;
}

// ============ 上游 API（標準 SMM Panel API v2） ============
function callProvider_(provider, params) {
  const payload = Object.assign({ key: provider['API金鑰'] }, params);
  const res = UrlFetchApp.fetch(provider['API網址'], {
    method: 'post', payload: payload, muteHttpExceptions: true,
  });
  const text = res.getContentText();
  try { return JSON.parse(text); }
  catch (e) { throw new Error(provider['名稱'] + ' 回應不是 JSON：' + text.slice(0, 200)); }
}

// ============ 比價 ============
/** 抓所有上游服務清單，更新「上游服務」與「對應」的價格。每小時自動執行。 */
function refreshPrices() {
  const provs = providers_();
  const all = [];
  const index = {}; // provider|serviceId -> service
  const errors = [];
  Object.values(provs).forEach(p => {
    if (!truthy_(p['啟用']) || !p['API金鑰']) return;
    try {
      const list = callProvider_(p, { action: 'services' });
      if (!Array.isArray(list)) throw new Error(JSON.stringify(list).slice(0, 200));
      list.forEach(s => {
        index[p['名稱'] + '|' + s.service] = s;
        all.push([p['名稱'], s.service, s.name, s.category, s.type, Number(s.rate), Number(s.min), Number(s.max),
          truthy_(s.refill), truthy_(s.cancel)]);
      });
    } catch (e) { errors.push(p['名稱'] + ': ' + e.message); }
  });

  const sv = sheet_(SH.SERVICES);
  if (all.length) {
    if (sv.getLastRow() > 1) sv.getRange(2, 1, sv.getLastRow() - 1, HEADERS[SH.SERVICES].length).clearContent();
    sv.getRange(2, 1, all.length, HEADERS[SH.SERVICES].length).setValues(all);
  }

  const ts = now_();
  rows_(SH.MAPPING).forEach(m => {
    const p = provs[m['上游']];
    const s = index[m['上游'] + '|' + m['服務ID']];
    if (!p || !s) return;
    setCells_(SH.MAPPING, m._row, {
      '單價每千': Number(s.rate), '幣別': p['幣別'] || 'USD', '最少': Number(s.min), '最多': Number(s.max),
      '補單': truthy_(s.refill), '台幣成本每千': Math.round(toTwd_(s.rate, p['幣別']) * 100) / 100,
      '更新時間': ts, '服務名稱': s.name,
    });
  });
  CacheService.getScriptCache().remove('products');
  return { services: all.length, errors: errors };
}

/** 某商品所有可用的上游，依「有效成本」排序（含加權、無補單懲罰）。qty 給定時只留數量範圍內的。 */
function rankedMappings_(productId, qty) {
  const s = settings_();
  const provs = providers_();
  return rows_(SH.MAPPING)
    .filter(m => m['商品ID'] === productId && m['台幣成本每千'] !== '' && Number(m['台幣成本每千']) > 0)
    .filter(m => provs[m['上游']] && truthy_(provs[m['上游']]['啟用']))
    .filter(m => !qty || (qty >= Number(m['最少'] || 0) && qty <= Number(m['最多'] || 1e12)))
    .map(m => {
      const cost = Number(m['台幣成本每千']);
      const penalty = (Number(m['加權']) || 0) + (truthy_(m['補單']) ? 0 : s.NO_REFILL_PENALTY);
      return { m: m, cost: cost, score: cost * (1 + penalty) };
    })
    .sort((a, b) => a.score - b.score);
}

/** 公開商品清單＋售價（每千）。 */
function productList_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('products');
  if (hit) return JSON.parse(hit);
  const s = settings_();
  const list = rows_(SH.PRODUCTS)
    .filter(p => truthy_(p['啟用']))
    .map(p => {
      const best = rankedMappings_(p['商品ID'])[0];
      if (!best) return null;
      return {
        id: p['商品ID'], platform: p['平台'], name: p['名稱'], desc: p['說明'],
        min: Number(p['最少']), max: Number(p['最多']), order: Number(p['排序']) || 99,
        refill: truthy_(best.m['補單']),
        pricePer1000: sellPrice_(p, best.cost),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);
  const out = {
    siteName: s.SITE_NAME, minOrder: s.MIN_ORDER_TWD, lineUrl: s.LINE_OA_URL, products: list,
  };
  cache.put('products', JSON.stringify(out), 300);
  return out;
}

/** 售價：有填「售價每千」就用它，但不得低於利潤保底；沒填就用 成本×(1+MARKUP)。 */
function sellPrice_(p, cost) {
  const s = settings_();
  const floor = cost / (1 - s.MIN_MARGIN);
  const set = Number(p['售價每千']) || 0;
  const price = set > 0 ? Math.max(set, floor) : cost * (1 + s.MARKUP);
  return Math.ceil(price * 100) / 100;
}

function priceFor_(product, qty) { return Math.ceil(product.pricePer1000 * qty / 1000); }

// ============ 訂單 ============
function newOrderId_() {
  const d = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyMMdd');
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = '';
  for (let i = 0; i < 5; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return 'L' + d + r;
}

function createOrder_(b) {
  const data = productList_();
  const p = data.products.find(x => x.id === b.productId);
  if (!p) throw new Error('此服務目前無法下單');
  const qty = Math.floor(Number(b.quantity));
  if (!(qty >= p.min && qty <= p.max)) throw new Error('數量需介於 ' + p.min + ' ~ ' + p.max);
  const link = String(b.link || '').trim();
  if (!/^https?:\/\//i.test(link)) throw new Error('請貼上完整網址（https:// 開頭）');
  const domains = PLATFORM_DOMAINS[p.platform] || [];
  if (domains.length && !domains.some(d => link.toLowerCase().indexOf(d) >= 0)) {
    throw new Error('網址看起來不是 ' + p.platform + ' 的連結');
  }
  const name = String(b.name || '').trim().slice(0, 50);
  const contact = String(b.contact || '').trim().slice(0, 80);
  if (!name || !contact) throw new Error('請填寫姓名與聯絡方式（LINE ID 或手機）');
  const amount = priceFor_(p, qty);
  if (amount < data.minOrder) throw new Error('最低訂單金額為 NT$' + data.minOrder + '，請增加數量');

  const id = newOrderId_();
  const vals = {
    '訂單編號': id, '建立時間': now_(), '姓名': name, '聯絡方式': contact, '商品ID': p.id, '商品名稱': p.name,
    '連結': link, '數量': qty, '應付金額': amount, '狀態': '待付款', '更新時間': now_(),
  };
  const row = HEADERS[SH.ORDERS].map(h => (h in vals ? vals[h] : ''));
  sheet_(SH.ORDERS).appendRow(row);
  notify_('新訂單 ' + id, name + ' / ' + contact + '\n' + p.name + ' x ' + qty + '\nNT$' + amount + '\n' + link);
  return { orderId: id, amount: amount, bankInfo: settings_().BANK_INFO, productName: p.name, quantity: qty };
}

function findOrder_(id) { return rows_(SH.ORDERS).find(o => o['訂單編號'] === id); }

function reportPayment_(b) {
  const o = findOrder_(String(b.orderId || '').trim().toUpperCase());
  if (!o) throw new Error('查無此訂單');
  const last5 = String(b.last5 || '').replace(/\D/g, '');
  if (last5.length !== 5) throw new Error('請輸入匯款帳號末五碼');
  if (o['狀態'] !== '待付款' && o['狀態'] !== '已回報匯款') throw new Error('此訂單狀態為「' + o['狀態'] + '」，無需回報');
  setCells_(SH.ORDERS, o._row, { '狀態': '已回報匯款', '匯款末五碼': last5, '回報時間': now_(), '更新時間': now_() });
  notify_('客人回報匯款 ' + o['訂單編號'], '末五碼 ' + last5 + '，金額 NT$' + o['應付金額'] + '\n請核對後到後台按「已繳費請下單」');
  return { ok: true };
}

function publicOrder_(o) {
  return {
    orderId: o['訂單編號'], created: o['建立時間'], productName: o['商品名稱'], quantity: o['數量'],
    amount: o['應付金額'], status: o['狀態'], remains: o['剩餘'],
    bankInfo: o['狀態'] === '待付款' ? settings_().BANK_INFO : '',
  };
}

// ============ 後台：已繳費請下單 ============
function placeOrder_(orderId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const o = findOrder_(orderId);
    if (!o) throw new Error('查無此訂單');
    if (['待付款', '已回報匯款', '下單失敗'].indexOf(o['狀態']) < 0) throw new Error('此訂單狀態為「' + o['狀態'] + '」，不能重複下單');
    const qty = Number(o['數量']);
    const ranked = rankedMappings_(o['商品ID'], qty);
    if (!ranked.length) throw new Error('沒有上游支援此商品與數量，請檢查「對應」表');
    const provs = providers_();
    const errs = [];
    for (const r of ranked) {
      const p = provs[r.m['上游']];
      try {
        const res = callProvider_(p, { action: 'add', service: r.m['服務ID'], link: o['連結'], quantity: qty });
        if (!res.order) throw new Error(res.error || JSON.stringify(res));
        const cost = Math.round(r.cost * qty / 1000 * 100) / 100;
        setCells_(SH.ORDERS, o._row, {
          '狀態': '處理中', '上游': p['名稱'], '上游訂單號': String(res.order), '成本TWD': cost,
          '利潤': Math.round((Number(o['應付金額']) - cost) * 100) / 100,
          '備註': errs.length ? '改用備援：' + errs.join('；') : '', '更新時間': now_(),
        });
        return { ok: true, provider: p['名稱'], providerOrder: res.order, cost: cost };
      } catch (e) { errs.push(p['名稱'] + ' ' + e.message); }
    }
    setCells_(SH.ORDERS, o._row, { '狀態': '下單失敗', '備註': errs.join('；'), '更新時間': now_() });
    throw new Error('所有上游都下單失敗：' + errs.join('；'));
  } finally { lock.releaseLock(); }
}

const STATUS_MAP = {
  'completed': '已完成', 'partial': '部分完成(需退差額)', 'canceled': '已取消(需退款)', 'cancelled': '已取消(需退款)',
  'pending': '處理中', 'in progress': '處理中', 'processing': '處理中',
};

/** 同步上游訂單狀態。每 15 分鐘自動執行。 */
function syncStatuses() {
  const provs = providers_();
  const active = rows_(SH.ORDERS).filter(o => o['狀態'] === '處理中' && o['上游訂單號']);
  const byProv = {};
  active.forEach(o => (byProv[o['上游']] = byProv[o['上游']] || []).push(o));
  let updated = 0;
  Object.keys(byProv).forEach(name => {
    const p = provs[name];
    if (!p) return;
    const list = byProv[name];
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      let res;
      try { res = callProvider_(p, { action: 'status', orders: chunk.map(o => o['上游訂單號']).join(',') }); }
      catch (e) { continue; }
      chunk.forEach(o => {
        const st = res[o['上游訂單號']] || (chunk.length === 1 ? res : null);
        if (!st || st.error) return;
        const raw = String(st.status || '');
        const patch = { '上游狀態': raw, '剩餘': (st.remains === undefined || st.remains === null) ? '' : st.remains, '更新時間': now_() };
        patch['狀態'] = STATUS_MAP[raw.toLowerCase()] || '處理中';
        if (st.charge !== undefined && st.charge !== '') {
          const cost = Math.round(toTwd_(st.charge, st.currency || p['幣別']) * 100) / 100;
          patch['成本TWD'] = cost;
          patch['利潤'] = Math.round((Number(o['應付金額']) - cost) * 100) / 100;
        }
        setCells_(SH.ORDERS, o._row, patch);
        updated++;
      });
    }
  });
  return { checked: active.length, updated: updated };
}

function balances_() {
  return Object.values(providers_()).filter(p => truthy_(p['啟用']) && p['API金鑰']).map(p => {
    try { const r = callProvider_(p, { action: 'balance' }); return { provider: p['名稱'], balance: r.balance, currency: r.currency }; }
    catch (e) { return { provider: p['名稱'], error: e.message }; }
  });
}

function notify_(subject, body) {
  const to = settings_().ADMIN_EMAIL;
  if (!to) return;
  try { MailApp.sendEmail(to, '[' + settings_().SITE_NAME + '] ' + subject, body); } catch (e) { }
}

// ============ Web App 入口 ============
function doGet(e) {
  const a = (e.parameter.action || 'products');
  try {
    if (a === 'products') return json_({ ok: true, data: productList_() });
    if (a === 'order') {
      const o = findOrder_(String(e.parameter.id || '').trim().toUpperCase());
      if (!o) throw new Error('查無此訂單');
      return json_({ ok: true, data: publicOrder_(o) });
    }
    throw new Error('unknown action');
  } catch (err) { return json_({ ok: false, error: err.message }); }
}

function doPost(e) {
  let b = {};
  try { b = JSON.parse(e.postData.contents || '{}'); } catch (x) { }
  try {
    switch (b.action) {
      case 'createOrder': return json_({ ok: true, data: createOrder_(b) });
      case 'reportPayment': return json_({ ok: true, data: reportPayment_(b) });
    }
    // ---- 以下需要後台密碼 ----
    if (!b.key || String(b.key) !== String(settings_().ADMIN_KEY)) throw new Error('後台密碼錯誤');
    switch (b.action) {
      case 'adminLogin': return json_({ ok: true, data: { siteName: settings_().SITE_NAME } });
      case 'adminOrders': {
        const list = rows_(SH.ORDERS).reverse().slice(0, 300).map(o => { const c = Object.assign({}, o); delete c._row; return c; });
        return json_({ ok: true, data: list });
      }
      case 'placeOrder': return json_({ ok: true, data: placeOrder_(String(b.orderId)) });
      case 'setStatus': {
        const o = findOrder_(String(b.orderId));
        if (!o) throw new Error('查無此訂單');
        setCells_(SH.ORDERS, o._row, { '狀態': String(b.status), '更新時間': now_() });
        return json_({ ok: true, data: {} });
      }
      case 'refreshPrices': return json_({ ok: true, data: refreshPrices() });
      case 'syncStatuses': return json_({ ok: true, data: syncStatuses() });
      case 'compare': {
        const out = rows_(SH.PRODUCTS).map(p => ({
          id: p['商品ID'], name: p['名稱'], setPrice: p['售價每千'],
          price: rankedMappings_(p['商品ID'])[0] ? sellPrice_(p, rankedMappings_(p['商品ID'])[0].cost) : '',
          options: rankedMappings_(p['商品ID']).map(r => ({
            provider: r.m['上游'], service: r.m['服務ID'], name: r.m['服務名稱'], costPer1000: r.cost,
            score: Math.round(r.score * 100) / 100, refill: truthy_(r.m['補單']), min: r.m['最少'], max: r.m['最多'],
          })),
        }));
        return json_({ ok: true, data: { products: out, balances: balances_(), markup: settings_().MARKUP } });
      }
    }
    throw new Error('unknown action');
  } catch (err) { return json_({ ok: false, error: err.message }); }
}
