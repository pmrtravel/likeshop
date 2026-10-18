(function () {
  const $ = id => document.getElementById(id);
  let DATA = null, current = null, platform = null;

  async function api(method, params) {
    if (method === 'GET') {
      const q = new URLSearchParams(params).toString();
      const r = await fetch(API_URL + '?' + q);
      return r.json();
    }
    const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(params) });
    return r.json();
  }

  const fmt = n => 'NT$ ' + Number(n).toLocaleString('zh-TW');
  const STATUS_LABEL = { '待付款': '待付款', '已回報匯款': '確認款項中', '處理中': '🔋 充電中', '已完成': '⚡ 已充滿' };
  const statusText = s => STATUS_LABEL[s] || s;

  function renderTabs() {
    const plats = [...new Set(DATA.products.map(p => p.platform))];
    platform = platform || plats[0];
    $('tabs').innerHTML = plats.map(p => `<button class="tab ${p === platform ? 'on' : ''}" data-p="${p}">${p}</button>`).join('');
    $('tabs').querySelectorAll('.tab').forEach(b => b.onclick = () => { platform = b.dataset.p; renderTabs(); renderGrid(); });
  }

  function renderGrid() {
    const list = DATA.products.filter(p => p.platform === platform);
    if (!list.length) { $('grid').innerHTML = '<div class="card hint">目前沒有可下單的項目</div>'; return; }
    $('grid').innerHTML = list.map(p => `
      <div class="card product ${current && current.id === p.id ? 'on' : ''}" data-id="${p.id}">
        <h3>${p.name}</h3>
        <div class="price">${fmt(p.pricePer1000)} <small>/ 每 1000</small></div>
        <div class="hint">${p.min.toLocaleString()} ~ ${p.max.toLocaleString()}</div>
        <span class="tag ${p.refill ? 'ok' : ''}">${p.refill ? '含補單' : '無補單'}</span>
      </div>`).join('');
    $('grid').querySelectorAll('.product').forEach(c => c.onclick = () => select(c.dataset.id));
  }

  function select(id) {
    current = DATA.products.find(p => p.id === id);
    renderGrid();
    $('orderBox').classList.remove('hidden');
    $('payBox').classList.add('hidden');
    $('formTitle').textContent = current.name;
    $('formDesc').textContent = current.desc || '';
    $('link').placeholder = current.platform === 'Facebook' ? 'https://www.facebook.com/...' : 'https://www.instagram.com/...';
    $('qty').min = current.min; $('qty').max = current.max;
    $('qtyRange').textContent = `（${current.min.toLocaleString()} ~ ${current.max.toLocaleString()}）`;
    const suggested = Math.max(current.min, Math.ceil(DATA.minOrder / current.pricePer1000 * 1000 / 50) * 50);
    $('qty').value = Math.min(suggested, current.max);
    $('orderMsg').textContent = '';
    calc();
    $('orderBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function calc() {
    if (!current) return;
    const q = Math.floor(Number($('qty').value));
    const amount = Math.ceil(current.pricePer1000 * q / 1000);
    const okQty = q >= current.min && q <= current.max;
    $('total').textContent = okQty ? fmt(amount) : 'NT$ —';
    const underMin = okQty && amount < DATA.minOrder;
    $('minHint').textContent = underMin ? `最低訂單金額 NT$${DATA.minOrder}，請增加數量` : '';
    $('submitBtn').disabled = !(okQty && !underMin && $('agree').checked);
  }

  ['qty', 'agree'].forEach(id => $(id).addEventListener('input', calc));
  $('agree').addEventListener('change', calc);

  $('submitBtn').onclick = async () => {
    const btn = $('submitBtn'); btn.disabled = true; $('orderMsg').className = 'msg'; $('orderMsg').textContent = '送出中…';
    try {
      const r = await api('POST', {
        action: 'createOrder', productId: current.id, link: $('link').value.trim(),
        quantity: $('qty').value, name: $('name').value.trim(), contact: $('contact').value.trim(),
      });
      if (!r.ok) throw new Error(r.error);
      showPay(r.data);
    } catch (e) { $('orderMsg').className = 'msg err'; $('orderMsg').textContent = e.message; btn.disabled = false; }
  };

  function showPay(d) {
    $('orderBox').classList.add('hidden');
    $('payBox').classList.remove('hidden');
    $('payOid').textContent = d.orderId;
    $('paySummary').innerHTML = `${d.productName} × ${Number(d.quantity).toLocaleString()}，請匯款 <b>${fmt(d.amount)}</b>`;
    $('bankInfo').textContent = d.bankInfo;
    $('payBox').dataset.oid = d.orderId;
    try { localStorage.setItem('lastOrder', d.orderId); } catch (e) { }
    $('payBox').scrollIntoView({ behavior: 'smooth' });
  }

  $('reportBtn').onclick = async () => {
    const btn = $('reportBtn'); btn.disabled = true; $('payMsg').className = 'msg'; $('payMsg').textContent = '送出中…';
    try {
      const r = await api('POST', { action: 'reportPayment', orderId: $('payBox').dataset.oid, last5: $('last5').value });
      if (!r.ok) throw new Error(r.error);
      $('payMsg').className = 'msg ok';
      $('payMsg').textContent = '已收到！確認款項後就開始充電 🔋，可用訂單編號隨時查詢進度。';
    } catch (e) { $('payMsg').className = 'msg err'; $('payMsg').textContent = e.message; btn.disabled = false; }
  };

  $('queryBtn').onclick = async () => {
    const id = $('qid').value.trim().toUpperCase();
    if (!id) return;
    $('queryMsg').className = 'msg'; $('queryMsg').textContent = '查詢中…'; $('queryResult').innerHTML = '';
    try {
      const r = await api('GET', { action: 'order', id });
      if (!r.ok) throw new Error(r.error);
      const o = r.data; $('queryMsg').textContent = '';
      $('queryResult').innerHTML = `
        <p>狀態：<span class="status">${statusText(o.status)}</span>${o.remains !== '' && o.remains !== undefined && o.status !== '已完成' ? `（剩餘 ${o.remains}）` : ''}</p>
        <p class="hint">${o.productName} × ${o.quantity}・${fmt(o.amount)}・${o.created}</p>
        ${o.status === '待付款' ? `<button class="btn ghost" id="toPay">回報匯款</button>` : ''}`;
      const tp = $('toPay');
      if (tp) tp.onclick = () => { $('payBox').dataset.oid = o.orderId; $('payOid').textContent = o.orderId; $('paySummary').innerHTML = `請匯款 <b>${fmt(o.amount)}</b>`; $('bankInfo').textContent = o.bankInfo; $('payBox').classList.remove('hidden'); $('payBox').scrollIntoView({ behavior: 'smooth' }); };
    } catch (e) { $('queryMsg').className = 'msg err'; $('queryMsg').textContent = e.message; }
  };

  (async function init() {
    try { const last = localStorage.getItem('lastOrder'); if (last) $('qid').value = last; } catch (e) { }
    if (!window.API_URL || API_URL.indexOf('請換成') >= 0) { $('grid').innerHTML = '<div class="card hint">🔋 網站準備中，即將開放下單</div>'; return; }
    try {
      const r = await api('GET', { action: 'products' });
      if (!r.ok) throw new Error(r.error);
      DATA = r.data;
      if (DATA.siteName) { $('siteName').textContent = DATA.siteName; document.title = DATA.siteName; }
      if (DATA.lineUrl) $('lineBtn').href = DATA.lineUrl;
      if (!DATA.products.length) { $('grid').innerHTML = '<div class="card hint">服務準備中，請稍後再來</div>'; return; }
      renderTabs(); renderGrid();
    } catch (e) { $('grid').innerHTML = `<div class="card msg err">載入失敗：${e.message}</div>`; }
  })();
})();
