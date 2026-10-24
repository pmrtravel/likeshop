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
  const STATUS_LABEL = { '待付款': '待付款', '已回報匯款': '確認款項中', '已付款': '✅ 已收款，準備充電', '處理中': '🔋 充電中', '已完成': '⚡ 已充滿', '已逾期': '已逾期（未收到款項）',
    '已取消(需退款)': '未能完成，將全額退款', '部分完成(需退差額)': '部分完成，將退還差額' };
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
    $('link').placeholder = { Facebook: 'https://www.facebook.com/...', Threads: 'https://www.threads.com/@...' }[current.platform] || 'https://www.instagram.com/...';
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
    $('discountHint').textContent = '';
    const underMin = okQty && amount < DATA.minOrder;
    $('minHint').textContent = underMin ? `最低訂單金額 NT$${DATA.minOrder}，請增加數量` : '';
    $('submitBtn').disabled = !(okQty && !underMin && $('agree').checked);
    if (okQty && !underMin) scheduleQuote();
  }

  // 有填手機或優惠碼時，向後台查折扣後金額
  let quoteTimer = null, quoteSeq = 0;
  function scheduleQuote() { clearTimeout(quoteTimer); quoteTimer = setTimeout(quote, 400); }
  async function quote() {
    const phone = $('phone').value.trim(), coupon = $('coupon').value.trim();
    if (!current || (!phone && !coupon)) return;
    if (phone && !/^(09\d{8}|\+?8869\d{8})$/.test(phone.replace(/[\s-]/g, ''))) return;
    const seq = ++quoteSeq;
    try {
      const r = await api('POST', { action: 'quote', productId: current.id, quantity: $('qty').value, phone, coupon });
      if (seq !== quoteSeq) return;
      if (!r.ok) { $('discountHint').className = 'hint msg err'; $('discountHint').textContent = r.error; return; }
      const d = r.data;
      $('discountHint').className = 'hint';
      if (d.amount < d.base) {
        $('total').innerHTML = `<s style="opacity:.5;font-weight:400;font-size:.8em">${fmt(d.base)}</s> ${fmt(d.amount)}`;
        $('discountHint').textContent = `🎁 ${d.label}，省 ${d.base - d.amount} 元`;
      } else if (phone && !coupon) {
        $('discountHint').textContent = '💎 已記錄為會員，下次下單起享老客折扣';
      }
    } catch (e) { }
  }

  ['qty', 'agree'].forEach(id => $(id).addEventListener('input', calc));
  $('agree').addEventListener('change', calc);
  $('phone').addEventListener('change', calc);
  $('couponBtn').onclick = calc;
  $('coupon').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); calc(); } });

  $('submitBtn').onclick = async () => {
    const btn = $('submitBtn'); btn.disabled = true; $('orderMsg').className = 'msg'; $('orderMsg').textContent = '送出中…';
    try {
      const r = await api('POST', {
        action: 'createOrder', productId: current.id, link: $('link').value.trim(),
        quantity: $('qty').value, name: $('name').value.trim(), contact: $('contact').value.trim(),
        phone: $('phone').value.trim(), coupon: $('coupon').value.trim(),
      });
      if (!r.ok) throw new Error(r.error);
      showPay(r.data);
    } catch (e) { $('orderMsg').className = 'msg err'; $('orderMsg').textContent = e.message; btn.disabled = false; }
  };

  function showPay(d) {
    $('orderBox').classList.add('hidden');
    $('payBox').classList.remove('hidden');
    $('payOid').textContent = d.orderId;
    $('paySummary').innerHTML = `${d.productName} × ${Number(d.quantity).toLocaleString()}<br>請匯款 <b style="font-size:24px">${fmt(d.amount)}</b>${d.base && d.amount !== d.base ? `<br><span class="hint">🎁 ${d.discountLabel ? d.discountLabel + '，' : ''}已折抵 ${d.base - d.amount} 元（原價 ${fmt(d.base)}）</span>` : ''}`;
    $('bankInfo').textContent = d.bankInfo;
    $('payBox').dataset.oid = d.orderId;
    startCountdown(d.payWindowMin || 5);
    try {
      localStorage.setItem('lastOrder', d.orderId);
      if ($('phone').value.trim()) localStorage.setItem('phone', $('phone').value.trim());
      if ($('name').value.trim()) localStorage.setItem('name', $('name').value.trim());
    } catch (e) { }
    $('payBox').scrollIntoView({ behavior: 'smooth' });
  }

  let cdTimer = null;
  function startCountdown(min) {
    clearInterval(cdTimer);
    const end = Date.now() + min * 60000;
    const tick = () => {
      const left = Math.max(0, end - Date.now());
      const m = Math.floor(left / 60000), sec = Math.floor(left % 60000 / 1000);
      $('countdown').innerHTML = left > 0 ? `⏱ 請在 <b>${m}:${String(sec).padStart(2, '0')}</b> 內完成匯款`
        : '⏱ 已超過付款時間。已經匯款的話不用擔心，我們會人工確認；還沒匯的話請重新下單。';
      if (!left) clearInterval(cdTimer);
    };
    tick(); cdTimer = setInterval(tick, 1000);
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
        ${o.status === '待付款' ? `<button class="btn ghost" id="toPay">回報匯款</button>` : ''}
        ${refundBlock(o)}`;
      bindRefund(o);
      const tp = $('toPay');
      if (tp) tp.onclick = () => { $('payBox').dataset.oid = o.orderId; $('payOid').textContent = o.orderId; $('paySummary').innerHTML = `請匯款 <b>${fmt(o.amount)}</b>`; $('bankInfo').textContent = o.bankInfo; $('payBox').classList.remove('hidden'); $('payBox').scrollIntoView({ behavior: 'smooth' }); };
    } catch (e) { $('queryMsg').className = 'msg err'; $('queryMsg').textContent = e.message; }
  };

  function refundBlock(o) {
    if (!(o.refund > 0)) return '';
    if (o.refundStatus === '已退款') return `<p class="msg ok">✅ 已退款 ${fmt(o.refund)}，請查看你的帳戶。</p>`;
    if (o.refundStatus === '待退款') return `<p class="msg ok">已收到退款帳戶，我們會盡快退還 ${fmt(o.refund)}（通常 1–2 個工作天）。</p>`;
    return `<div class="card" style="margin-top:10px">
      <b>💸 應退金額 ${fmt(o.refund)}</b>
      <p class="hint">請填寫退款帳戶，我們會轉帳退還。</p>
      <label for="rfVerify">驗證身分：下單時填的手機或姓名</label><input id="rfVerify">
      <div class="row2">
        <div><label for="rfBank">銀行代碼（3 碼）</label><input id="rfBank" inputmode="numeric" maxlength="3" placeholder="822"></div>
        <div><label for="rfAcct">帳號</label><input id="rfAcct" inputmode="numeric"></div>
      </div>
      <label for="rfHolder">戶名</label><input id="rfHolder">
      <button class="btn" id="rfBtn">送出退款帳戶</button>
      <div class="msg" id="rfMsg"></div></div>`;
  }
  function bindRefund(o) {
    const b = $('rfBtn'); if (!b) return;
    b.onclick = async () => {
      b.disabled = true; $('rfMsg').className = 'msg'; $('rfMsg').textContent = '送出中…';
      try {
        const r = await api('POST', { action: 'refundInfo', orderId: o.orderId, verify: $('rfVerify').value, bank: $('rfBank').value, account: $('rfAcct').value, holder: $('rfHolder').value });
        if (!r.ok) throw new Error(r.error);
        $('rfMsg').className = 'msg ok'; $('rfMsg').textContent = `已收到！我們會盡快退還 ${fmt(r.data.refund)}。`;
      } catch (e) { $('rfMsg').className = 'msg err'; $('rfMsg').textContent = e.message; b.disabled = false; }
    };
  }

  (async function init() {
    try {
      const last = localStorage.getItem('lastOrder'); if (last) $('qid').value = last;
      const ph = localStorage.getItem('phone'); if (ph) $('phone').value = ph;
      const nm = localStorage.getItem('name'); if (nm) $('name').value = nm;
    } catch (e) { }
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
