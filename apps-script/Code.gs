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
  BANKLOG: '入帳紀錄',
  COUPONS: '優惠碼',
};

const HEADERS = {
  [SH.SETTINGS]: ['項目', '值', '說明'],
  [SH.PROVIDERS]: ['名稱', 'API網址', 'API金鑰', '幣別', '啟用', '備註'],
  [SH.PRODUCTS]: ['商品ID', '平台', '名稱', '說明', '最少', '最多', '啟用', '排序', '售價每千'],
  [SH.MAPPING]: ['商品ID', '上游', '服務ID', '加權', '單價每千', '幣別', '最少', '最多', '補單', '台幣成本每千', '更新時間', '服務名稱'],
  [SH.SERVICES]: ['上游', '服務ID', '名稱', '分類', '類型', '單價每千', '最少', '最多', '補單', '可取消'],
  [SH.ORDERS]: ['訂單編號', '建立時間', '姓名', '聯絡方式', '商品ID', '商品名稱', '連結', '數量', '應付金額',
    '狀態', '匯款末五碼', '回報時間', '上游', '上游訂單號', '成本TWD', '利潤', '上游狀態', '剩餘', '備註', '更新時間',
    '手機', '優惠碼', '原價', '折扣說明', '已試服務', '上游下單時間', '應退金額', '退款資訊', '退款狀態'],
  [SH.BANKLOG]: ['收到時間', '通知內容', '金額', '對應訂單', '結果'],
  [SH.COUPONS]: ['代碼', '折扣', '啟用', '到期日', '可用次數', '說明'],
};

const DEFAULT_COUPONS = [
  ['WELCOME10', 0.10, true, '', '', '範例：新客 9 折（折扣 0.1 = 打 9 折；到期日、可用次數留空 = 不限）'],
];

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
  ['NOTIFY_SECRET', Utilities.getUuid().slice(0, 12), '手機轉發入帳通知用的暗號（MacroDroid 要填一樣的）'],
  ['PAY_WINDOW_MIN', 5, '付款期限（分鐘），超過就標成已逾期'],
  ['MEMBER_DISCOUNT', 0.05, '老客折扣：同一支手機之前有成功下單過，自動打折（0.05 = 95 折，0 = 關閉）'],
  ['STUCK_HOURS', 6, '上游下單後超過幾小時還沒開始，就自動取消並改用備援服務（0 = 不自動處理）'],
  ['AUTO_PLACE', true, '入帳金額對上唯一一筆訂單時，自動向上游下單（FALSE = 只標記已付款）'],
];

const DEFAULT_PRODUCTS = [
  // 售價參考 KsD 同等級約 75 折（2026/10）
  ['IG_LIKE', 'Instagram', 'IG 貼文按讚（30 天補單）', '貼上公開貼文網址', 50, 20000, true, 1, 120],
  ['IG_FOLLOW', 'Instagram', 'IG 粉絲（30 天補單）', '貼上個人頁網址，帳號需公開。30 天內掉量可補回', 100, 10000, true, 2, 220],
  ['IG_FOLLOW_ECO', 'Instagram', 'IG 粉絲・經濟款（不補單）', '價格最低，但掉量較多且不補單。帳號需公開', 100, 20000, true, 3, 90],
  ['THREADS_FOLLOW', 'Threads', 'Threads 粉絲（30 天補單）', '貼上個人頁網址（threads.com/@帳號），帳號需公開', 50, 20000, true, 3.1, 390],
  ['THREADS_LIKE', 'Threads', 'Threads 貼文按讚（30 天補單）', '貼上公開貼文網址', 50, 20000, true, 3.2, 190],
  ['FB_LIKE', 'Facebook', 'FB 貼文按讚（30 天補單）', '貼上公開貼文網址', 100, 20000, true, 4, 28],
  ['FB_FOLLOW', 'Facebook', 'FB 粉專追蹤（90 天補單）', '貼上粉絲專頁網址', 100, 20000, true, 5, 38],
];

// JAP 服務對應（2026/10 從 JAP 後台挑選）
const DEFAULT_MAPPING = [
  ['IG_LIKE', 'JAP', 10065, 0], ['IG_LIKE', 'JAP', 10126, 0],
  ['IG_FOLLOW', 'JAP', 10242, 0], ['IG_FOLLOW', 'JAP', 10216, 0],
  ['IG_FOLLOW_ECO', 'JAP', 5563, 0], ['IG_FOLLOW_ECO', 'JAP', 2012, 0], ['IG_FOLLOW_ECO', 'JAP', 7236, 0], // 10350 於 2026/10 卡單，已停用
  ['THREADS_FOLLOW', 'JAP', 2119, 0], ['THREADS_FOLLOW', 'JAP', 322, 0.3],
  ['THREADS_LIKE', 'JAP', 5026, 0],
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
    // 舊版工作表：補上新增的欄位
    const have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
    HEADERS[name].forEach(h => {
      if (have.indexOf(h) < 0) { const c = sh.getLastColumn() + 1; sh.getRange(1, c).setValue(h).setFontWeight('bold').setBackground('#eef2f7'); }
    });
  });
  // 舊版設定表：補上新增的設定項目
  const stHave = rows_(SH.SETTINGS).map(r => r['項目']);
  DEFAULT_SETTINGS.filter(d => stHave.indexOf(d[0]) < 0).forEach(d => ss.getSheetByName(SH.SETTINGS).appendRow(d));
  const cp = ss.getSheetByName(SH.COUPONS);
  if (cp.getLastRow() === 1) cp.getRange(2, 1, DEFAULT_COUPONS.length, 6).setValues(DEFAULT_COUPONS);
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
  s.MEMBER_DISCOUNT = Math.min(Math.max(Number(s.MEMBER_DISCOUNT) || 0, 0), 0.5);
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
/** 有沒有補單保固：API 的 refill 只代表「有補單按鈕」，所以也看服務名稱裡的 [Refill: 30D] / Lifetime */
function hasRefill_(s) {
  const name = String(s.name || '');
  if (/refill\s*:?\s*(no|none|0)\b/i.test(name) || /no\s*refill/i.test(name)) return false;
  return truthy_(s.refill) || /refill\s*:?\s*(\d+\s*d|\d+\s*days?|lifetime|\d+)/i.test(name) || /\bR\d+\b/.test(name);
}

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
          hasRefill_(s), truthy_(s.cancel)]);
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
      '補單': hasRefill_(s), '台幣成本每千': Math.round(toTwd_(s.rate, p['幣別']) * 100) / 100,
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
  const phone = normPhone_(b.phone);
  if (!name || !(contact || phone)) throw new Error('請填寫姓名，以及手機或 LINE ID');
  const q = quote_(p, qty, phone, b.coupon, data.minOrder);
  const base = q.amount;

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
  const amount = uniqueAmount_(base);
  const id = newOrderId_();
  const vals = {
    '訂單編號': id, '建立時間': now_(), '姓名': name, '聯絡方式': contact, '商品ID': p.id, '商品名稱': p.name,
    '連結': link, '數量': qty, '應付金額': amount, '狀態': '待付款', '更新時間': now_(),
    '手機': phone ? "'" + phone : '', '優惠碼': q.code, '原價': q.base, '折扣說明': q.label,
  };
  const row = HEADERS[SH.ORDERS].map(h => (h in vals ? vals[h] : ''));
  sheet_(SH.ORDERS).appendRow(row);
  notify_('新訂單 ' + id, name + ' / ' + contact + '\n' + p.name + ' x ' + qty + '\nNT$' + amount + '\n' + link);
  return { orderId: id, amount: amount, base: q.base, discountLabel: q.label, payWindowMin: payWindowMin_(), bankInfo: settings_().BANK_INFO, productName: p.name, quantity: qty };
  } finally { lock.releaseLock(); }
}

// ============ 會員與優惠碼 ============
const PAID_STATES = ['已付款', '處理中', '已完成', '部分完成'];
const DEAD_STATES = ['已逾期', '已取消', '已退款'];
const inStates_ = (st, list) => list.some(x => String(st).indexOf(x) === 0); // 「已取消(需退款)」也算已取消
const phoneKey_ = v => String(v).replace(/\D/g, '').slice(-9); // 不管有沒有被試算表吃掉開頭的 0

/** 手機號碼統一成 09xxxxxxxx；空白回傳 ''，格式不對就報錯。 */
function normPhone_(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.indexOf('886') === 0) d = '0' + d.slice(3);
  if (!/^09\d{8}$/.test(d)) throw new Error('手機號碼格式不對，請填 09 開頭的 10 碼');
  return d;
}

function isMember_(phone) {
  if (!phone) return false;
  return rows_(SH.ORDERS).some(o => phoneKey_(o['手機']) === phoneKey_(phone) && inStates_(o['狀態'], PAID_STATES));
}

/** 查優惠碼，不能用就報錯（說明原因）。 */
function findCoupon_(code) {
  const sh = sheet_(SH.COUPONS);
  if (!sh) throw new Error('優惠碼無效');
  const c = rows_(SH.COUPONS).find(r => String(r['代碼']).trim().toUpperCase() === code);
  if (!c || !truthy_(c['啟用'])) throw new Error('優惠碼無效');
  const pct = Number(c['折扣']) || 0;
  if (!(pct > 0 && pct < 1)) throw new Error('優惠碼無效');
  if (c['到期日']) {
    const end = new Date(c['到期日']); end.setHours(23, 59, 59);
    if (Date.now() > end.getTime()) throw new Error('優惠碼已過期');
  }
  const limit = Number(c['可用次數']) || 0;
  if (limit > 0) {
    const used = rows_(SH.ORDERS).filter(o => String(o['優惠碼']).toUpperCase() === code && !inStates_(o['狀態'], DEAD_STATES)).length;
    if (used >= limit) throw new Error('優惠碼已被用完');
  }
  return { code: code, pct: pct };
}

/**
 * 計算折扣後金額。老客折扣與優惠碼取比較划算的一個（不疊加）。
 * 折完不會低於上游成本 ×1.1，避免賠錢。
 */
function quote_(p, qty, phone, couponRaw, minOrder) {
  const base = priceFor_(p, qty);
  if (base < minOrder) throw new Error('最低訂單金額為 NT$' + minOrder + '，請增加數量');
  const opts = [];
  const md = settings_().MEMBER_DISCOUNT;
  if (md > 0 && isMember_(phone)) opts.push({ pct: md, label: '老客 ' + pctLabel_(md), code: '' });
  const code = String(couponRaw || '').trim().toUpperCase();
  if (code) { const c = findCoupon_(code); opts.push({ pct: c.pct, label: '優惠碼 ' + code + ' ' + pctLabel_(c.pct), code: code }); }
  const best = opts.sort((a, b) => b.pct - a.pct)[0];
  if (!best) return { base: base, amount: base, label: '', code: '', member: false };
  const r = rankedMappings_(p.id, qty)[0];
  const floor = r ? Math.ceil(r.cost * qty / 1000 * 1.1) : base;
  const amount = Math.max(Math.round(base * (1 - best.pct)), floor, 1);
  return { base: base, amount: Math.min(amount, base), label: best.label, code: best.code, member: best.code === '' };
}

/** 0.1 → 「9 折」、0.05 → 「95 折」 */
function pctLabel_(pct) {
  const n = Math.round((1 - pct) * 100);
  return (n % 10 === 0 ? n / 10 : n) + ' 折';
}

function publicQuote_(b) {
  const data = productList_();
  const p = data.products.find(x => x.id === b.productId);
  if (!p) throw new Error('此服務目前無法下單');
  const qty = Math.floor(Number(b.quantity));
  if (!(qty >= p.min && qty <= p.max)) throw new Error('數量需介於 ' + p.min + ' ~ ' + p.max);
  return quote_(p, qty, normPhone_(b.phone), b.coupon, data.minOrder);
}

// ============ 自動對帳 ============
const PENDING = ['待付款', '已回報匯款'];
const LATE_HOURS = 24; // 逾期後 24 小時內才入帳，仍嘗試對帳

function payWindowMin_() { return Number(settings_().PAY_WINDOW_MIN) || 5; }

function toDate_(v) {
  if (v instanceof Date) return v;
  const m = String(v).match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  return m ? new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + '+08:00') : new Date(0);
}

/** 付款期限內、還沒付款的訂單（佔用金額） */
function pendingOrders_() {
  const since = Date.now() - payWindowMin_() * 60 * 1000;
  return rows_(SH.ORDERS).filter(o => PENDING.indexOf(o['狀態']) >= 0 && toDate_(o['建立時間']).getTime() >= since);
}

/** 超過付款期限的訂單（含已標記逾期），給晚到的入帳備援對帳 */
function lateOrders_() {
  const now = Date.now(), win = payWindowMin_() * 60 * 1000;
  return rows_(SH.ORDERS).filter(o => {
    const t = toDate_(o['建立時間']).getTime();
    return (o['狀態'] === '已逾期' || PENDING.indexOf(o['狀態']) >= 0) && t < now - win && t >= now - LATE_HOURS * 3600 * 1000;
  });
}

/** 把超過付款期限的待付款訂單標成「已逾期」（每 15 分鐘的排程也會跑） */
function expireOrders_() {
  const win = payWindowMin_() * 60 * 1000;
  let n = 0;
  rows_(SH.ORDERS).forEach(o => {
    if (o['狀態'] === '待付款' && toDate_(o['建立時間']).getTime() < Date.now() - win) {
      setCells_(SH.ORDERS, o._row, { '狀態': '已逾期', '更新時間': now_() }); n++;
    }
  });
  return n;
}

/** 讓每筆待付款訂單金額都不同：撞到同金額時往下折 1、2…元（識別折扣），入帳金額就能對到唯一訂單。 */
function uniqueAmount_(base) {
  const used = {};
  pendingOrders_().forEach(o => used[Number(o['應付金額'])] = true);
  let a = base;
  while (used[a] && a > base - 30 && a > 1) a--;
  if (used[a]) throw new Error('目前同金額訂單太多，請稍後再試或調整數量');
  return a;
}

function bankLogSheet_() {
  let sh = sheet_(SH.BANKLOG);
  if (!sh) {
    sh = SpreadsheetApp.getActive().insertSheet(SH.BANKLOG);
    sh.appendRow(HEADERS[SH.BANKLOG]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** 解析銀行推播，例如「你的帳戶在2026/10/19 00:54有 NT$1存入」 */
function parseDeposit_(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  if (!/存入|入帳|轉入/.test(t)) return null;
  const m = t.match(/NT\$ ?([\d,]+)/i) || t.match(/([\d,]+) ?元/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

function bankNotify_(b) {
  if (!b.secret || String(b.secret) !== String(settings_().NOTIFY_SECRET)) throw new Error('暗號錯誤');
  const text = String(b.text || '').slice(0, 300);
  const log = bankLogSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // 同一則通知重複送來（MacroDroid 偶爾會觸發兩次）就略過
    const recent = log.getLastRow() > 1 ? log.getRange(Math.max(2, log.getLastRow() - 30), 2, Math.min(31, log.getLastRow() - 1), 1).getValues().map(r => r[0]) : [];
    if (recent.indexOf(text) >= 0) return { result: '重複通知，已略過' };

    const amount = parseDeposit_(text);
    if (!amount) { log.appendRow([now_(), text, '', '', '看不懂的通知']); return { result: '不是入帳通知' }; }
    let hits = pendingOrders_().filter(o => Number(o['應付金額']) === amount);
    if (!hits.length) hits = lateOrders_().filter(o => Number(o['應付金額']) === amount);
    if (hits.length !== 1) {
      const why = hits.length ? '有 ' + hits.length + ' 筆同金額訂單' : '沒有對應的待付款訂單';
      log.appendRow([now_(), text, amount, hits.map(o => o['訂單編號']).join(','), '需人工：' + why]);
      notify_('入帳 NT$' + amount + ' 需要人工確認', why + '\n通知內容：' + text);
      return { result: '需人工', amount: amount };
    }
    const o = hits[0];
    setCells_(SH.ORDERS, o._row, { '狀態': '已付款', '備註': '自動對帳 ' + now_(), '更新時間': now_() });
    log.appendRow([now_(), text, amount, o['訂單編號'], '已對上']);
    lock.releaseLock();
    if (!truthy_(settings_().AUTO_PLACE)) return { result: '已付款', orderId: o['訂單編號'] };
    try {
      const r = placeOrder_(o['訂單編號']);
      notify_('自動下單成功 ' + o['訂單編號'], o['商品名稱'] + ' x ' + o['數量'] + '\nNT$' + amount + '，成本 NT$' + r.cost);
      return { result: '已自動下單', orderId: o['訂單編號'] };
    } catch (e) {
      notify_('已收款但自動下單失敗 ' + o['訂單編號'], e.message + '\n請到後台處理');
      return { result: '已付款，下單失敗', orderId: o['訂單編號'], error: e.message };
    }
  } finally { try { lock.releaseLock(); } catch (e) { } }
}

function findOrder_(id) { return rows_(SH.ORDERS).find(o => o['訂單編號'] === id); }

function reportPayment_(b) {
  const o = findOrder_(String(b.orderId || '').trim().toUpperCase());
  if (!o) throw new Error('查無此訂單');
  const last5 = String(b.last5 || '').replace(/\D/g, '');
  if (last5.length !== 5) throw new Error('請輸入匯款帳號末五碼');
  if (['待付款', '已回報匯款', '已逾期'].indexOf(o['狀態']) < 0) throw new Error('此訂單狀態為「' + o['狀態'] + '」，無需回報');
  setCells_(SH.ORDERS, o._row, { '狀態': '已回報匯款', '匯款末五碼': last5, '回報時間': now_(), '更新時間': now_() });
  notify_('客人回報匯款 ' + o['訂單編號'], '末五碼 ' + last5 + '，金額 NT$' + o['應付金額'] + '\n請核對後到後台按「已繳費請下單」');
  return { ok: true };
}

function publicOrder_(o) {
  return {
    orderId: o['訂單編號'], created: o['建立時間'], productName: o['商品名稱'], quantity: o['數量'],
    amount: o['應付金額'], status: o['狀態'], remains: o['剩餘'],
    refund: Number(o['應退金額']) || 0, refundStatus: o['退款狀態'] || '',
    bankInfo: o['狀態'] === '待付款' ? settings_().BANK_INFO : '',
  };
}

// ============ 後台：已繳費請下單 ============
function svcKey_(m) { return m['上游'] + ':' + m['服務ID']; }
function triedList_(o) { return String(o['已試服務'] || '').split(',').map(x => x.trim()).filter(Boolean); }

function placeOrder_(orderId, opt) {
  opt = opt || {};
  const lock = opt.noLock ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(20000);
  try {
    const o = findOrder_(orderId);
    if (!o) throw new Error('查無此訂單');
    if (!opt.reorder && ['待付款', '已回報匯款', '已付款', '已逾期', '下單失敗'].indexOf(o['狀態']) < 0) throw new Error('此訂單狀態為「' + o['狀態'] + '」，不能重複下單');
    const qty = Number(o['數量']);
    const tried = triedList_(o);
    const ranked = rankedMappings_(o['商品ID'], qty).filter(r => tried.indexOf(svcKey_(r.m)) < 0);
    if (!ranked.length) throw new Error(tried.length ? '備援服務都試過了' : '沒有上游支援此商品與數量，請檢查「對應」表');
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
          '上游狀態': '', '剩餘': '', '上游下單時間': now_(),
          '已試服務': tried.concat([svcKey_(r.m)]).join(','),
          '備註': [o['備註'], opt.note || '', errs.length ? '改用備援：' + errs.join('；') : ''].filter(Boolean).join('；'), '更新時間': now_(),
        });
        return { ok: true, provider: p['名稱'], providerOrder: res.order, cost: cost };
      } catch (e) { errs.push(p['名稱'] + ' ' + e.message); }
    }
    if (opt.reorder) throw new Error('備援下單失敗：' + errs.join('；'));
    setCells_(SH.ORDERS, o._row, { '狀態': '下單失敗', '備註': errs.join('；'), '更新時間': now_() });
    throw new Error('所有上游都下單失敗：' + errs.join('；'));
  } finally { if (lock) lock.releaseLock(); }
}

const STATUS_MAP = {
  'completed': '已完成', 'partial': '部分完成(需退差額)', 'canceled': '已取消(需退款)', 'cancelled': '已取消(需退款)',
  'pending': '處理中', 'in progress': '處理中', 'processing': '處理中',
};

/** 同步上游訂單狀態。每 15 分鐘自動執行。 */
function syncStatuses() {
  try { expireOrders_(); } catch (e) { }
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
        const remains = (st.remains === undefined || st.remains === null) ? '' : Number(st.remains);
        const patch = { '上游狀態': raw, '剩餘': remains, '更新時間': now_() };
        patch['狀態'] = STATUS_MAP[raw.toLowerCase()] || '處理中';
        if (st.charge !== undefined && st.charge !== '') {
          const cost = Math.round(toTwd_(st.charge, st.currency || p['幣別']) * 100) / 100;
          patch['成本TWD'] = cost;
          patch['利潤'] = Math.round((Number(o['應付金額']) - cost) * 100) / 100;
        }
        setCells_(SH.ORDERS, o._row, patch);
        updated++;
        try { afterStatus_(Object.assign({}, o, patch), p); } catch (e) { }
      });
    }
  });
  return { checked: active.length, updated: updated };
}

/**
 * 狀態更新後的自動處理：
 * - 上游取消 → 還有備援服務就自動改下，沒有就標成需退款
 * - 部分完成 → 算出要退的差額
 * - 卡單（超過 STUCK_HOURS 小時一個都沒送）→ 向上游申請取消，取消後會自動改用備援
 */
function afterStatus_(o, p) {
  const qty = Number(o['數量']), paid = Number(o['應付金額']);
  if (String(o['狀態']).indexOf('已取消') === 0) {
    try {
      const r = placeOrder_(o['訂單編號'], { reorder: true, noLock: true, note: '上游訂單 ' + o['上游訂單號'] + ' 被取消，自動改用備援' });
      notify_('訂單 ' + o['訂單編號'] + ' 已自動改用備援', '原上游訂單 ' + o['上游訂單號'] + ' 被取消，已改下 ' + r.provider + ' #' + r.providerOrder);
      return;
    } catch (e) {
      setCells_(SH.ORDERS, o._row, { '應退金額': paid, '退款狀態': '待客人提供帳戶' });
      notify_('訂單 ' + o['訂單編號'] + ' 需要退款 NT$' + paid, '上游取消且沒有可用的備援（' + e.message + '）。客人可在網站查詢訂單時填寫退款帳戶。');
      return;
    }
  }
  if (String(o['狀態']).indexOf('部分完成') === 0) {
    const rem = Number(o['剩餘']) || 0;
    const refund = qty > 0 ? Math.floor(paid * rem / qty) : 0;
    if (refund > 0 && !o['退款狀態']) {
      setCells_(SH.ORDERS, o._row, { '應退金額': refund, '退款狀態': '待客人提供帳戶' });
      notify_('訂單 ' + o['訂單編號'] + ' 部分完成，需退 NT$' + refund, '少送 ' + rem + ' / ' + qty + '。客人可在網站查詢訂單時填寫退款帳戶。');
    } else if (refund <= 0) {
      setCells_(SH.ORDERS, o._row, { '狀態': '已完成' });
    }
    return;
  }
  // 卡單偵測
  const hours = Number(settings_().STUCK_HOURS) || 0;
  if (!hours || o['狀態'] !== '處理中' || String(o['備註']).indexOf('卡單#' + o['上游訂單號']) >= 0) return;
  const since = o['上游下單時間'] ? toDate_(o['上游下單時間']) : toDate_(o['建立時間']);
  const noProgress = o['剩餘'] === '' || Number(o['剩餘']) >= qty;
  if (!noProgress || Date.now() - since.getTime() < hours * 3600 * 1000) return;
  let res = {};
  try { res = callProvider_(p, { action: 'cancel', orders: String(o['上游訂單號']) }); } catch (e) { res = { error: e.message }; }
  const r0 = Array.isArray(res) ? res[0] || {} : res;
  const ok = !(r0.error || (r0.cancel && r0.cancel.error));
  setCells_(SH.ORDERS, o._row, { '備註': [o['備註'], '卡單#' + o['上游訂單號'] + ' 超過 ' + hours + ' 小時：' + (ok ? '已向上游申請取消，取消後自動改用備援' : '申請取消失敗，請人工處理')].filter(Boolean).join('；') });
  notify_('訂單 ' + o['訂單編號'] + ' 卡單', '上游 ' + o['上游訂單號'] + ' 超過 ' + hours + ' 小時沒有進度。' + (ok ? '已自動申請取消。' : '自動取消失敗，請到上游後台處理。'));
}

// ============ 退款 ============
/** 客人在查詢頁填退款帳戶：要對上訂單上的手機或姓名，避免別人亂填。 */
function refundInfo_(b) {
  const o = findOrder_(String(b.orderId || '').trim().toUpperCase());
  if (!o) throw new Error('查無此訂單');
  if (!(Number(o['應退金額']) > 0) || o['退款狀態'] === '已退款') throw new Error('這筆訂單目前沒有需要退款的金額');
  const who = String(b.verify || '').trim();
  const phoneOk = o['手機'] && who.replace(/\D/g, '').length >= 9 && phoneKey_(who) === phoneKey_(o['手機']);
  const nameOk = who && who === String(o['姓名']).trim();
  if (!phoneOk && !nameOk) throw new Error('驗證失敗：請輸入下單時填的手機或姓名');
  const bank = String(b.bank || '').replace(/\D/g, '');
  const acct = String(b.account || '').replace(/[\s-]/g, '');
  const name = String(b.holder || '').trim().slice(0, 30);
  if (!/^\d{3}$/.test(bank)) throw new Error('銀行代碼是 3 碼數字，例如 822');
  if (!/^\d{6,16}$/.test(acct)) throw new Error('帳號格式不對');
  if (!name) throw new Error('請填戶名');
  setCells_(SH.ORDERS, o._row, { '退款資訊': "'" + bank + ' / ' + acct + ' / ' + name, '退款狀態': '待退款', '更新時間': now_() });
  notify_('客人已填退款帳戶 ' + o['訂單編號'], '應退 NT$' + o['應退金額'] + '\n' + bank + ' / ' + acct + ' / ' + name);
  return { refund: Number(o['應退金額']) };
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
  const raw = (e.postData && e.postData.contents) || '';
  const qp = e.parameter || {};
  if (qp.action === 'bankNotify') {
    // 手機轉發用的簡單格式：網址帶 ?action=bankNotify&secret=…，內文直接放通知文字（不用組 JSON，避免引號、換行出錯）
    b = { action: 'bankNotify', secret: qp.secret, text: raw.replace(/\s+/g, ' ').trim() };
  } else {
    try { b = JSON.parse(raw || '{}'); } catch (x) { }
  }
  try {
    switch (b.action) {
      case 'createOrder': return json_({ ok: true, data: createOrder_(b) });
      case 'quote': return json_({ ok: true, data: publicQuote_(b) });
      case 'refundInfo': return json_({ ok: true, data: refundInfo_(b) });
      case 'reportPayment': return json_({ ok: true, data: reportPayment_(b) });
      case 'bankNotify': return json_({ ok: true, data: bankNotify_(b) });
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
      case 'markRefunded': {
        const o = findOrder_(String(b.orderId));
        if (!o) throw new Error('查無此訂單');
        setCells_(SH.ORDERS, o._row, { '退款狀態': '已退款', '更新時間': now_() });
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
