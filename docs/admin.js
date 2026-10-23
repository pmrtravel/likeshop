(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => n === '' || n === undefined ? '' : 'NT$' + Number(n).toLocaleString('zh-TW');
  let KEY = '', ORDERS = [];
  try { KEY = localStorage.getItem('adminKey') || ''; } catch (e) { }

  async function post(action, extra) {
    const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action, key: KEY }, extra || {})) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    return j.data;
  }
  function msg(t, cls) { $('msg').className = 'msg ' + (cls || ''); $('msg').textContent = t; }

  async function login() {
    KEY = $('key').value || KEY;
    try {
      const d = await post('adminLogin');
      try { localStorage.setItem('adminKey', KEY); } catch (e) { }
      $('title').textContent = (d.siteName || '') + ' 後台';
      $('loginBox').classList.add('hidden'); $('main').classList.remove('hidden'); $('logout').classList.remove('hidden');
      load();
    } catch (e) { $('loginMsg').className = 'msg err'; $('loginMsg').textContent = e.message; }
  }

  async function load() {
    msg('載入中…');
    try { ORDERS = await post('adminOrders'); msg(''); render(); }
    catch (e) { msg(e.message, 'err'); }
  }

  function pill(s) {
    let c = '';
    if (s === '已回報匯款') c = 'pay'; else if (s === '待付款') c = 'wait';
    else if (s === '處理中') c = 'run'; else if (s === '已完成') c = 'done';
    else if (/失敗|退|取消|部分/.test(s)) c = 'bad';
    return `<span class="pill ${c}">${esc(s)}</span>`;
  }

  function render() {
    const f = $('filter').value, q = $('search').value.trim().toLowerCase();
    const list = ORDERS.filter(o => {
      const s = o['狀態'];
      if (f === 'todo' && !['已回報匯款', '待付款', '下單失敗'].includes(s)) return false;
      if (f === 'run' && s !== '處理中') return false;
      if (f === 'refund' && !/退|取消/.test(s)) return false;
      if (q && ![o['訂單編號'], o['姓名'], o['聯絡方式'], o['手機'], o['優惠碼'], o['匯款末五碼']].join(' ').toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => (a['狀態'] === '已回報匯款' ? -1 : 0) - (b['狀態'] === '已回報匯款' ? -1 : 0));

    const done = ORDERS.filter(o => o['利潤'] !== '' && !/取消|失敗/.test(o['狀態']));
    const profit = done.reduce((s, o) => s + Number(o['利潤'] || 0), 0);
    const pay = ORDERS.filter(o => o['狀態'] === '已回報匯款').length;
    $('stats').textContent = `待確認匯款 ${pay} 筆・已下單 ${done.length} 筆・累計利潤 ${fmt(Math.round(profit))}`;

    $('tbody').innerHTML = list.map(o => {
      const s = o['狀態'];
      const canPlace = ['已回報匯款', '待付款', '下單失敗'].includes(s);
      return `<tr>
        <td><b>${esc(o['訂單編號'])}</b><br><span class="hint">${esc(o['建立時間'])}</span></td>
        <td>${esc(o['姓名'])}<br><span class="hint">${esc([o['手機'], o['聯絡方式']].filter(Boolean).join(' / '))}</span></td>
        <td>${esc(o['商品名稱'])} × ${esc(o['數量'])}<br><a class="hint" href="${esc(o['連結'])}" target="_blank" rel="noopener noreferrer">${esc(String(o['連結']).slice(0, 40))}</a></td>
        <td><b>${fmt(o['應付金額'])}</b>${o['折扣說明'] ? `<br><span class="hint">${esc(o['折扣說明'])}</span>` : ''}</td>
        <td>${esc(o['匯款末五碼'])}<br><span class="hint">${esc(o['回報時間'])}</span></td>
        <td>${pill(s)}${o['剩餘'] !== '' ? `<br><span class="hint">剩餘 ${esc(o['剩餘'])}</span>` : ''}${o['備註'] ? `<br><span class="hint">${esc(o['備註'])}</span>` : ''}</td>
        <td>${esc(o['上游'])} ${esc(o['上游訂單號'])}<br>${o['利潤'] !== '' ? `<span class="hint">成本 ${fmt(o['成本TWD'])}・利潤 <b>${fmt(o['利潤'])}</b></span>` : ''}</td>
        <td>
          ${canPlace ? `<button class="sbtn go" data-place="${esc(o['訂單編號'])}">已繳費請下單</button><br>` : ''}
          ${s === '待付款' || s === '已回報匯款' ? `<button class="sbtn" data-st="${esc(o['訂單編號'])}" data-v="已取消">取消</button>` : ''}
          ${/需退/.test(s) ? `<button class="sbtn" data-st="${esc(o['訂單編號'])}" data-v="已退款">標記已退款</button>` : ''}
        </td></tr>`;
    }).join('') || '<tr><td colspan="8" class="hint">沒有訂單</td></tr>';

    $('tbody').querySelectorAll('[data-place]').forEach(b => b.onclick = () => place(b.dataset.place, b));
    $('tbody').querySelectorAll('[data-st]').forEach(b => b.onclick = () => setStatus(b.dataset.st, b.dataset.v));
  }

  async function place(id, btn) {
    const o = ORDERS.find(x => x['訂單編號'] === id);
    if (!confirm(`確認已收到 ${fmt(o['應付金額'])}（末五碼 ${o['匯款末五碼'] || '未回報'}），要送出 ${o['商品名稱']} × ${o['數量']}？`)) return;
    btn.disabled = true; btn.textContent = '下單中…';
    try {
      const d = await post('placeOrder', { orderId: id });
      msg(`✅ ${id} 已送到 ${d.provider}（上游單號 ${d.providerOrder}，成本 ${fmt(d.cost)}）`, 'ok');
      load();
    } catch (e) { msg(e.message, 'err'); load(); }
  }

  async function setStatus(id, v) {
    if (!confirm(`把 ${id} 改成「${v}」？`)) return;
    try { await post('setStatus', { orderId: id, status: v }); load(); } catch (e) { msg(e.message, 'err'); }
  }

  async function compare() {
    const box = $('compareBox'); box.classList.remove('hidden'); box.innerHTML = '<span class="hint">查詢中…</span>';
    try {
      const d = await post('compare');
      box.innerHTML = `<h2>上游餘額</h2><p>${d.balances.map(b => `${esc(b.provider)}：${b.error ? '<span class="msg err">' + esc(b.error) + '</span>' : esc(b.balance) + ' ' + esc(b.currency)}`).join('　') || '<span class="hint">尚未啟用任何上游</span>'}</p>
        <h2>比價（由便宜到貴，第一名會被優先使用）</h2>` +
        d.products.map(p => `<p><b>${esc(p.name)}</b>　售價 ${fmt(p.price)}/千${p.options[0] ? `・利潤率 ${Math.round((1 - p.options[0].costPer1000 / p.price) * 100)}%` : ''}${p.setPrice && p.price > p.setPrice ? ' <span class="pill bad">已自動調高</span>' : ''}</p>` + (p.options.length ? `<table><tr><th>上游</th><th>服務</th><th>成本/千</th><th>比價分數</th><th>補單</th><th>範圍</th></tr>` +
          p.options.map((x, i) => `<tr><td>${i === 0 ? '⭐ ' : ''}${esc(x.provider)} #${esc(x.service)}</td><td class="hint">${esc(x.name)}</td><td>${fmt(x.costPer1000)}</td><td>${esc(x.score)}</td><td>${x.refill ? '✅' : '—'}</td><td>${esc(x.min)}~${esc(x.max)}</td></tr>`).join('') + '</table>'
          : '<p class="hint">尚未設定對應</p>')).join('');
    } catch (e) { box.innerHTML = `<span class="msg err">${esc(e.message)}</span>`; }
  }

  async function run(action, label) {
    msg(label + '中…');
    try { const d = await post(action); msg(label + '完成：' + JSON.stringify(d), 'ok'); load(); } catch (e) { msg(e.message, 'err'); }
  }

  $('loginBtn').onclick = login;
  $('key').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  $('logout').onclick = () => { try { localStorage.removeItem('adminKey'); } catch (e) { } location.reload(); };
  $('filter').onchange = render; $('search').oninput = render;
  $('reload').onclick = load;
  $('sync').onclick = () => run('syncStatuses', '同步');
  $('prices').onclick = () => run('refreshPrices', '更新價格');
  $('compareBtn').onclick = compare;
  if (KEY) login();
})();
