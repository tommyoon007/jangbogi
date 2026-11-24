/* 장보기 (jangbogi) — 영수증·가격비교·장볼목록
   바닐라 자바스크립트. 빌드 없음. */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 기본 값
   * ------------------------------------------------------------------ */
  var LS_STATE = 'jangbogi.state.v1';
  var LS_BASE = 'jangbogi.base.v1';
  var LS_TAB = 'jangbogi.tab.v1';

  var CATS = ['채소/과일', '정육/수산', '유제품/음료', '식품', '생필품', '기타'];
  var WD = ['일', '월', '화', '수', '목', '금', '토'];

  /* ------------------------------------------------------------------ *
   * 작은 도구들
   * ------------------------------------------------------------------ */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) {
    var n = Number(String(v == null ? '' : v).replace(/[^0-9.-]/g, ''));
    return isFinite(n) ? n : 0;
  }
  function fmt(n) { return Math.round(n || 0).toLocaleString('ko-KR'); }
  function won(n) { return fmt(n) + '원'; }
  function wonBig(n) {
    if (n >= 100000000) return fmt(Math.round(n / 1000000) / 100) + '억원';
    return won(n);
  }
  function shortWon(n) {
    if (!n) return '0';
    if (n >= 10000) {
      var man = Math.round(n / 1000) / 10;
      return (man % 1 === 0 ? man.toFixed(0) : man.toFixed(1)) + '만';
    }
    return fmt(n);
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function parseDate(s) {
    var p = String(s || '').split('-');
    return new Date(Number(p[0]) || 1970, (Number(p[1]) || 1) - 1, Number(p[2]) || 1);
  }
  function fmtDate(s) {
    var d = parseDate(s);
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WD[d.getDay()] + ')';
  }
  function fmtDateFull(s) {
    var d = parseDate(s);
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WD[d.getDay()] + ')';
  }
  function fmtMonth(s) {
    var p = String(s || '').split('-');
    return p[0] + '년 ' + Number(p[1]) + '월';
  }
  function today() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }
  function startOfWeek(d) {
    var c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var back = (c.getDay() + 6) % 7; // 월요일 시작
    c.setDate(c.getDate() - back);
    return c;
  }
  function addDays(d, n) {
    var c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    c.setDate(c.getDate() + n);
    return c;
  }
  function daysInMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }

  function itemKey(name) {
    var s = String(name || '')
      .replace(/\([^)]*\)/g, '')
      .replace(/\s+/g, '')
      .replace(/[0-9]+(\.[0-9]+)?\s*(ml|l|kg|g|개입|개|입|매|봉|팩|롤|장|포|마리|송이|단|모|캡슐|구)/gi, '')
      .toLowerCase();
    return s || String(name || '').trim().toLowerCase();
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    requestAnimationFrame(function () { t.classList.add('show'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.hidden = true; }, 220);
    }, 2100);
  }

  /* ------------------------------------------------------------------ *
   * 상태 저장
   * ------------------------------------------------------------------ */
  function defaultState() {
    return {
      v: 1,
      showSample: true,
      receipts: [],   // 앱에서 직접 넣은 영수증
      hidden: [],     // 지운 기본 영수증 id
      overrides: {},  // 기본 영수증을 고친 내용
      shopping: [],   // 살 물품 목록
      staples: [],    // 직접 추가한 단골 품목
      tipOff: false
    };
  }

  var S = (function loadState() {
    var st = defaultState();
    try {
      var raw = localStorage.getItem(LS_STATE);
      if (raw) {
        var o = JSON.parse(raw);
        for (var k in st) if (Object.prototype.hasOwnProperty.call(o, k)) st[k] = o[k];
      }
    } catch (e) { /* 저장값이 깨졌으면 처음 상태로 */ }
    if (!Array.isArray(st.receipts)) st.receipts = [];
    if (!Array.isArray(st.hidden)) st.hidden = [];
    if (!Array.isArray(st.shopping)) st.shopping = [];
    if (!Array.isArray(st.staples)) st.staples = [];
    if (!st.overrides || typeof st.overrides !== 'object') st.overrides = {};
    return st;
  })();

  function save() {
    try { localStorage.setItem(LS_STATE, JSON.stringify(S)); } catch (e) { /* 저장 공간 없음 */ }
  }

  var BASE = { receipts: [], savedAt: 0 };

  function normalizeBase(j) {
    var out = { receipts: [], savedAt: Date.now() };
    if (!j || !Array.isArray(j.receipts)) return out;
    j.receipts.forEach(function (r) {
      if (!r || !r.date || !Array.isArray(r.items)) return;
      var items = r.items.map(function (it) {
        var qty = Number(it.qty) || 1;
        var price = Number(it.price) || 0;
        var amount = Number(it.amount);
        if (!isFinite(amount) || amount <= 0) amount = price * qty;
        return {
          name: String(it.name || '품목'),
          category: CATS.indexOf(it.category) >= 0 ? it.category : '기타',
          qty: qty,
          price: price,
          amount: amount
        };
      }).filter(function (it) { return it.name; });
      var subtotal = items.reduce(function (s, it) { return s + it.amount; }, 0);
      var discount = Math.max(0, Number(r.discount) || 0);
      var total = Number(r.total);
      if (!isFinite(total) || total <= 0) total = Math.max(0, subtotal - discount);
      out.receipts.push({
        id: String(r.id || ('b-' + r.date + '-' + out.receipts.length)),
        date: String(r.date).slice(0, 10),
        store: String(r.store || '가게 이름 없음'),
        items: items,
        subtotal: subtotal,
        discount: discount,
        total: total,
        memo: String(r.memo || ''),
        sample: !!r.sample
      });
    });
    return out;
  }

  function loadBase() {
    var got = null;
    fetch('data/receipts.json', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (j) {
        got = j;
        BASE = normalizeBase(j);
        try { localStorage.setItem(LS_BASE, JSON.stringify({ at: Date.now(), data: j })); } catch (e) {}
        render();
      })
      .catch(function () {
        try {
          var c = JSON.parse(localStorage.getItem(LS_BASE) || 'null');
          if (c && c.data) {
            BASE = normalizeBase(c.data);
            BASE.savedAt = c.at || 0;
          }
        } catch (e) {}
        render();
      });
  }

  /* ------------------------------------------------------------------ *
   * 영수증 합치기
   * ------------------------------------------------------------------ */
  function baseReceipts() {
    var out = [];
    BASE.receipts.forEach(function (r) {
      if (S.hidden.indexOf(r.id) >= 0) return;
      if (r.sample && !S.showSample) return;
      out.push(S.overrides[r.id] ? Object.assign({}, r, S.overrides[r.id]) : r);
    });
    return out;
  }

  function allReceipts() {
    var arr = baseReceipts().concat(S.receipts);
    return arr.sort(function (a, b) {
      if (a.date === b.date) return a.id < b.id ? 1 : -1;
      return a.date < b.date ? 1 : -1;
    });
  }

  function receiptById(id) {
    var list = allReceipts();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 품목 묶음 (가격 비교·단골 품목의 바탕)
   * ------------------------------------------------------------------ */
  function buildGroups() {
    var map = new Map();
    allReceipts().forEach(function (r) {
      (r.items || []).forEach(function (it) {
        var k = itemKey(it.name);
        var g = map.get(k);
        if (!g) {
          g = { key: k, names: new Map(), catCount: {}, purchases: [] };
          map.set(k, g);
        }
        g.names.set(it.name, (g.names.get(it.name) || 0) + 1);
        g.catCount[it.category] = (g.catCount[it.category] || 0) + 1;
        var qty = Number(it.qty) || 1;
        var price = Number(it.price) || 0;
        g.purchases.push({
          date: r.date,
          store: r.store,
          price: price,
          qty: qty,
          amount: Number(it.amount) || price * qty,
          receiptId: r.id
        });
      });
    });

    var arr = [];
    map.forEach(function (g) {
      g.purchases.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

      var best = '', bestN = -1;
      g.names.forEach(function (c, n) {
        if (c > bestN || (c === bestN && n.length < best.length)) { best = n; bestN = c; }
      });
      g.name = best;

      var bc = '기타', bn = -1;
      Object.keys(g.catCount).forEach(function (c) {
        if (g.catCount[c] > bn) { bn = g.catCount[c]; bc = c; }
      });
      g.category = CATS.indexOf(bc) >= 0 ? bc : '기타';

      g.count = g.purchases.length;
      var priced = g.purchases.filter(function (p) { return p.price > 0; });
      g.min = null;
      g.max = null;
      priced.forEach(function (p) {
        if (!g.min || p.price < g.min.price) g.min = p;
        if (!g.max || p.price > g.max.price) g.max = p;
      });
      g.avg = priced.length
        ? Math.round(priced.reduce(function (s, p) { return s + p.price; }, 0) / priced.length)
        : 0;
      g.last = g.purchases[g.purchases.length - 1];
      g.lastPriced = priced.length ? priced[priced.length - 1] : null;
      arr.push(g);
    });
    return arr;
  }

  var _groups = null;
  function groups() {
    if (!_groups) _groups = buildGroups();
    return _groups;
  }
  function groupByKey(key) {
    var gs = groups();
    for (var i = 0; i < gs.length; i++) if (gs[i].key === key) return gs[i];
    return null;
  }

  function stapleItems() {
    var gs = groups().slice();
    var rows = [];
    var seen = {};
    gs.filter(function (g) { return g.count >= 2; })
      .sort(function (a, b) {
        return (b.count - a.count) || (a.last.date < b.last.date ? 1 : -1);
      })
      .forEach(function (g) {
        rows.push({ key: g.key, name: g.name, group: g, custom: false });
        seen[g.key] = true;
      });
    var custom = [];
    S.staples.forEach(function (st) {
      var k = itemKey(st.name);
      if (seen[k]) return;
      seen[k] = true;
      custom.push({
        key: k,
        name: st.name,
        group: (function () { var g = groupByKey(k); return g; })(),
        custom: true
      });
    });
    return custom.concat(rows);
  }

  /* ------------------------------------------------------------------ *
   * 살 물품 목록
   * ------------------------------------------------------------------ */
  function shopIndexByKey(key) {
    for (var i = 0; i < S.shopping.length; i++) {
      var it = S.shopping[i];
      if ((it.key || itemKey(it.name)) === key) return i;
    }
    return -1;
  }

  function addShopItem(name, key) {
    var nm = String(name || '').replace(/\s+/g, ' ').trim();
    if (!nm) return false;
    var k = key || itemKey(nm);
    if (shopIndexByKey(k) >= 0) { toast('이미 살 목록에 있어요'); return false; }
    S.shopping.push({
      id: 'sh-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      key: k,
      name: nm,
      checked: false,
      addedAt: Date.now()
    });
    save();
    return true;
  }

  function ensureShoppingName(it) {
    if (it.key) return;
    it.key = itemKey(it.name);
  }

  /* ------------------------------------------------------------------ *
   * 화면 그리기
   * ------------------------------------------------------------------ */
  var tab = 'list';
  try { tab = localStorage.getItem(LS_TAB) || 'list'; } catch (e) {}
  if (['list', 'price', 'period', 'receipts'].indexOf(tab) < 0) tab = 'list';

  var ui = { q: '', cat: '전체', sort: 'freq', period: 'month', stapleAddOpen: false };
  var confirmAction = null;
  var deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
  });

  function invalidate() { _groups = null; }

  function render() {
    invalidate();
    ['list', 'price', 'period', 'receipts'].forEach(function (t) {
      var el = document.getElementById('view-' + t);
      if (el) el.hidden = (t !== tab);
    });
    if (tab === 'list') renderList();
    else if (tab === 'price') renderPrice();
    else if (tab === 'period') renderPeriod();
    else renderReceipts();

    renderBar();
    renderTabbar();
    updateBadge();
  }

  function renderBar() {
    var sub = $('#barSub');
    var recs = allReceipts();
    var mt = monthTotal(today());
    if (recs.length === 0) {
      sub.textContent = '영수증을 넣으면 자동으로 정리해 드려요';
    } else if (mt) {
      sub.textContent = '이번 달 ' + won(mt) + ' · 영수증 ' + monthCount(today()) + '장';
    } else {
      sub.textContent = '영수증 ' + recs.length + '장 정리됨';
    }
  }

  function renderTabbar() {
    $$('.tabbar .tab').forEach(function (b) {
      if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  function updateBadge() {
    var b = $('#tabBadge');
    var n = S.shopping.filter(function (x) { return !x.checked; }).length;
    if (n > 0) { b.textContent = n > 99 ? '99+' : String(n); b.hidden = false; }
    else { b.hidden = true; }
  }

  function setTab(t) {
    if (tab === t) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    tab = t;
    try { localStorage.setItem(LS_TAB, t); } catch (e) {}
    ui.stapleAddOpen = false;
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- 장볼목록 ---------- */
  function renderList() {
    var host = $('#view-list');
    var items = S.shopping.slice().sort(function (a, b) {
      return (a.checked ? 1 : 0) - (b.checked ? 1 : 0) || (a.addedAt || 0) - (b.addedAt || 0);
    });
    items.forEach(ensureShoppingName);
    var pending = items.filter(function (x) { return !x.checked; });
    var done = items.filter(function (x) { return x.checked; });

    var html = '';

    /* 살 물품 */
    html += '<div class="card">';
    html += '<div class="row-between"><h2 class="card-h">살 물품 <span class="count">' + pending.length + '</span></h2></div>';
    html += '<form class="addline" data-form="addshop" autocomplete="off">' +
      '<input class="field" name="name" type="text" placeholder="살 물품 적기 (예: 우유)" maxlength="40" enterkeyhint="done" aria-label="살 물품 적기">' +
      '<button class="btn sm" type="submit">추가</button></form>';

    if (!items.length) {
      html += '<div class="empty"><span class="emo">🧺</span><h3>살 물품을 적어 두세요</h3>' +
        '<p>아래 단골 품목에서 <b>다 떨어짐</b>을 누르면 이 목록에 담깁니다.<br>가게에서 하나씩 지우며 보세요.</p></div>';
    } else {
      html += '<ul class="shoplist">' + pending.map(shopRow).join('') + '</ul>';
      if (done.length) {
        html += '<div class="done-head"><span>산 물품 ' + done.length + '개</span>' +
          '<button type="button" data-act="clearDone">모두 지우기</button></div>';
        html += '<ul class="shoplist">' + done.map(shopRow).join('') + '</ul>';
      }
    }
    html += '</div>';

    /* 단골 품목 */
    var st = stapleItems();
    html += '<div class="card">';
    html += '<div class="row-between"><h2 class="card-h">단골 품목 <span class="sub">' +
      (st.length ? st.length + '가지' : '') + '</span></h2></div>';
    html += '<p class="hint">다 떨어지면 <b>다 떨어짐</b>을 누르세요. 살 목록에 담깁니다.</p>';

    if (!st.length) {
      html += '<div class="empty"><span class="emo">🛒</span><h3>아직 단골 품목이 없어요</h3>' +
        '<p>영수증이 두 장 넘게 쌓이면 자주 사는 품목이 여기에 자동으로 모입니다.</p>' +
        sampleButtonHtml('') + '</div>';
    } else {
      html += '<ul class="staplelist">' + st.map(stapleRow).join('') + '</ul>';
    }

    html += '<div class="staple-add">' +
      '<button class="linkbtn" type="button" data-act="toggleStapleAdd">' +
      (ui.stapleAddOpen ? '닫기' : '＋ 단골 품목 직접 추가') + '</button>';
    if (ui.stapleAddOpen) {
      html += '<form class="addline" data-form="addstaple" autocomplete="off">' +
        '<input class="field" name="name" type="text" placeholder="자주 사는 품목 (예: 계란)" maxlength="40" enterkeyhint="done" aria-label="단골 품목 이름">' +
        '<button class="btn sm" type="submit">추가</button></form>';
    }
    html += '</div></div>';

    host.innerHTML = html;
  }

  function sampleButtonHtml(extraClass) {
    if (!BASE.receipts.some(function (r) { return r.sample; })) return '';
    if (S.showSample) return '';
    return '<button class="btn ghost ' + extraClass + '" type="button" data-act="toggleSample">샘플 데이터로 미리 보기</button>';
  }

  function shopRow(x) {
    var g = groupByKey(x.key || itemKey(x.name));
    var meta;
    if (g && g.last) {
      var parts = ['지난 <b>' + won(g.last.price) + '</b>'];
      if (g.min) parts.push('최저 <span class="cheap">' + won(g.min.price) + '</span>');
      if (g.min && g.min.store) parts.push(esc(g.min.store));
      meta = parts.join(' · ');
    } else {
      meta = '가격 기록 없음';
    }
    return '<li class="shop-row' + (x.checked ? ' done' : '') + '">' +
      '<button class="tick" type="button" data-act="toggleshop" data-id="' + esc(x.id) + '" aria-label="' +
      (x.checked ? '안 산 것으로 되돌리기' : '샀어요 표시') + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12.5 9.5 17.5 20 7"/></svg>' +
      '</button>' +
      '<div class="shop-main">' +
      '<button class="shop-name" type="button" data-act="iteminfo" data-key="' + esc(x.key || itemKey(x.name)) + '" data-name="' + esc(x.name) + '">' + esc(x.name) + '</button>' +
      '<div class="shop-meta">' + meta + '</div>' +
      '</div>' +
      '<button class="xbtn" type="button" data-act="delshop" data-id="' + esc(x.id) + '" aria-label="목록에서 빼기">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>' +
      '</button></li>';
  }

  function stapleRow(row) {
    var inList = shopIndexByKey(row.key) >= 0;
    var sub;
    if (row.group && row.group.last) {
      var bits = [];
      if (row.group.last.price) bits.push('지난 ' + won(row.group.last.price));
      bits.push(row.group.count + '번 샀어요');
      if (row.group.min) bits.push('최저 ' + won(row.group.min.price));
      sub = bits.join(' · ');
    } else {
      sub = '직접 추가한 품목';
    }
    return '<li class="staple-row">' +
      '<div class="staple-main">' +
      '<button class="staple-name" type="button" data-act="iteminfo" data-key="' + esc(row.key) + '" data-name="' + esc(row.name) + '">' + esc(row.name) + '</button>' +
      '<div class="staple-sub">' + sub + '</div>' +
      '</div>' +
      '<button class="chipbtn' + (inList ? ' on' : '') + '" type="button" data-act="addstaple" data-key="' + esc(row.key) + '" data-name="' + esc(row.name) + '" aria-pressed="' + inList + '">' +
      (inList ? '담김 ✓' : '다 떨어짐') + '</button>' +
      (row.custom && !row.group
        ? '<button class="xbtn" type="button" data-act="delstaple" data-name="' + esc(row.name) + '" aria-label="단골 품목에서 빼기">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>'
        : '') +
      '</li>';
  }

  /* ---------- 가격비교 ---------- */
  function renderPrice() {
    var host = $('#view-price');
    var chips = '<button class="chip" type="button" data-act="setCat" data-v="전체" aria-pressed="' +
      (ui.cat === '전체') + '">전체</button>' +
      CATS.map(function (c) {
        return '<button class="chip" type="button" data-act="setCat" data-v="' + esc(c) + '" aria-pressed="' +
          (ui.cat === c) + '">' + esc(c) + '</button>';
      }).join('');

    host.innerHTML =
      '<div class="searchwrap">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>' +
      '<input id="priceQ" class="field" type="search" placeholder="품목 이름으로 찾기 (예: 우유)" value="' + esc(ui.q) + '" autocomplete="off" enterkeyhint="search" aria-label="품목 찾기">' +
      '</div>' +
      '<div class="chips">' + chips + '</div>' +
      '<div id="priceListWrap"></div>';

    renderPriceList();
  }

  var SORTS = {
    freq: { label: '자주 산 순', fn: function (a, b) { return (b.count - a.count) || (a.last.date < b.last.date ? 1 : -1); } },
    recent: { label: '최근 산 순', fn: function (a, b) { return a.last.date < b.last.date ? 1 : a.last.date > b.last.date ? -1 : 0; } },
    cheap: { label: '최저가 순', fn: function (a, b) { return (a.min ? a.min.price : Infinity) - (b.min ? b.min.price : Infinity); } },
    name: { label: '이름 순', fn: function (a, b) { return a.name.localeCompare(b.name, 'ko'); } }
  };

  function renderPriceList() {
    var wrap = $('#priceListWrap');
    if (!wrap) return;
    var gs = groups().slice();
    if (ui.cat !== '전체') gs = gs.filter(function (g) { return g.category === ui.cat; });
    var q = ui.q.trim().toLowerCase();
    if (q) {
      gs = gs.filter(function (g) {
        if (g.name.toLowerCase().indexOf(q) >= 0) return true;
        return g.purchases.some(function (p) { return String(p.store).toLowerCase().indexOf(q) >= 0; });
      });
    }
    gs.sort(SORTS[ui.sort].fn);

    var html = '<div class="card">';
    html += '<div class="row-between"><h2 class="card-h">품목 <span class="count">' + gs.length + '</span></h2>' +
      '<button class="linkbtn" type="button" data-act="cycleSort">' + SORTS[ui.sort].label + ' ⇅</button></div>';

    if (!gs.length) {
      if (!groups().length) {
        html += '<div class="empty"><span class="emo">📊</span><h3>아직 비교할 가격이 없어요</h3>' +
          '<p>영수증을 넣으면 품목마다 지난 가격과 최저가를 모아 보여 드립니다.</p>' + sampleButtonHtml('') + '</div>';
      } else {
        html += '<div class="empty"><h3>찾는 품목이 없어요</h3><p>다른 이름이나 분류로 찾아보세요.</p></div>';
      }
    } else {
      html += '<ul class="pricelist">' + gs.map(function (g) {
        return '<li><button class="price-row" type="button" data-act="iteminfo" data-key="' + esc(g.key) + '" data-name="' + esc(g.name) + '">' +
          '<div class="pr-main">' +
          '<div class="pr-name">' + esc(g.name) + '</div>' +
          '<div class="pr-sub">' + g.count + '번 샀어요 · 지난 ' + (g.lastPriced ? won(g.lastPriced.price) : '기록 없음') + '</div>' +
          '</div>' +
          '<div class="pr-right">' +
          '<div class="pr-min">' + (g.min ? won(g.min.price) : '-') + '</div>' +
          '<div class="pr-store">' + (g.min ? esc(g.min.store) : '') + '</div>' +
          '</div></button></li>';
      }).join('') + '</ul>';
    }
    html += '</div>';
    wrap.innerHTML = html;
  }

  /* ---------- 기간정리 ---------- */
  function receiptsIn(period) {
    var recs = allReceipts();
    if (period === 'all') return recs;
    var t = today();
    if (period === 'week') {
      var ws = startOfWeek(t), we = addDays(ws, 7);
      return recs.filter(function (r) { var d = parseDate(r.date); return d >= ws && d < we; });
    }
    if (period === 'month') {
      return recs.filter(function (r) {
        var d = parseDate(r.date);
        return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth();
      });
    }
    if (period === 'last') {
      var lm = new Date(t.getFullYear(), t.getMonth() - 1, 1);
      return recs.filter(function (r) {
        var d = parseDate(r.date);
        return d.getFullYear() === lm.getFullYear() && d.getMonth() === lm.getMonth();
      });
    }
    return recs;
  }

  function sumTotal(list) { return list.reduce(function (s, r) { return s + r.total; }, 0); }

  function prevPeriod(period) {
    if (period === 'all') return null;
    var recs = allReceipts();
    var t = today();
    if (period === 'week') {
      var ws = startOfWeek(t), pws = addDays(ws, -7);
      return sumTotal(recs.filter(function (r) {
        var d = parseDate(r.date);
        return d >= pws && d < ws;
      }));
    }
    var lmStart = new Date(t.getFullYear(), t.getMonth() - 1, 1);
    var endDay = Math.min(t.getDate(), daysInMonth(lmStart));
    var lmEnd = new Date(lmStart.getFullYear(), lmStart.getMonth(), endDay + 1);
    return sumTotal(recs.filter(function (r) {
      var d = parseDate(r.date);
      return d >= lmStart && d < lmEnd;
    }));
  }

  function monthTotal(d) {
    var recs = allReceipts();
    return sumTotal(recs.filter(function (r) {
      var x = parseDate(r.date);
      return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth();
    }));
  }
  function monthCount(d) {
    var recs = allReceipts();
    return recs.filter(function (r) {
      var x = parseDate(r.date);
      return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth();
    }).length;
  }

  function renderPeriod() {
    var host = $('#view-period');
    var periods = [['week', '이번 주'], ['month', '이번 달'], ['last', '지난 달'], ['all', '전체']];
    var recs = receiptsIn(ui.period);
    var total = sumTotal(recs);

    var html = '<div class="chips">' + periods.map(function (p) {
      return '<button class="chip" type="button" data-act="setPeriod" data-v="' + p[0] + '" aria-pressed="' +
        (ui.period === p[0]) + '">' + p[1] + '</button>';
    }).join('') + '</div>';

    /* 합계 */
    html += '<div class="card kpi">';
    html += '<div class="lab">' + (ui.period === 'week' ? '이번 주 장보기' : ui.period === 'month' ? '이번 달 장보기' : ui.period === 'last' ? '지난 달 장보기' : '전체 장보기') + '</div>';
    html += '<div class="big">' + fmt(total) + '<small>원</small></div>';
    if (recs.length) {
      html += '<div class="subline">영수증 ' + recs.length + '장 · 한 번에 평균 ' + won(Math.round(total / recs.length)) + '</div>';
      var prev = prevPeriod(ui.period);
      if (prev !== null && prev > 0) {
        var diff = total - prev;
        var pct = Math.round(Math.abs(diff) / prev * 100);
        var cls = pct <= 2 ? 'same' : (diff < 0 ? 'down' : 'up');
        var when = ui.period === 'week' ? '지난주' : '지난달 이맘때';
        var text = pct <= 2 ? when + '와 비슷하게 썼어요'
          : when + '보다 ' + pct + '% ' + (diff < 0 ? '적게 썼어요' : '더 썼어요');
        html += '<div class="deltaline ' + cls + '">' + text + (diff < 0 ? ' ↓' : pct > 2 ? ' ↑' : '') + '</div>';
      }
    } else {
      html += '<div class="subline">이 기간에 넣은 영수증이 없어요.</div>';
      html += sampleButtonHtml('');
    }
    html += '</div>';

    if (recs.length) {
      /* 가게별 */
      var storeMap = new Map();
      recs.forEach(function (r) { storeMap.set(r.store, (storeMap.get(r.store) || 0) + r.total); });
      var storeRows = Array.from(storeMap.entries()).sort(function (a, b) { return b[1] - a[1]; });
      html += '<div class="card"><h2 class="card-h">가게별</h2><div class="bars">' +
        barRows(storeRows.map(function (e) { return { label: e[0], value: e[1], color: '#2f7d4d' }; }), total) +
        '</div></div>';

      /* 분류별 (할인 반영) */
      var catMap = {};
      var subSum = 0;
      recs.forEach(function (r) {
        (r.items || []).forEach(function (it) {
          var c = CATS.indexOf(it.category) >= 0 ? it.category : '기타';
          catMap[c] = (catMap[c] || 0) + (Number(it.amount) || 0);
          subSum += Number(it.amount) || 0;
        });
      });
      var scale = subSum > 0 ? total / subSum : 1;
      var catColors = { '채소/과일': '#5aa96f', '정육/수산': '#d9705f', '유제품/음료': '#6f9ed8', '식품': '#d8a13f', '생필품': '#8d86c9', '기타': '#9aa39c' };
      var catRows = CATS.filter(function (c) { return catMap[c] > 0; })
        .map(function (c) { return { label: c, value: Math.round(catMap[c] * scale), color: catColors[c] }; })
        .sort(function (a, b) { return b.value - a.value; });
      html += '<div class="card"><h2 class="card-h">분류별</h2><div class="bars">' +
        barRows(catRows, total) + '</div></div>';
    }

    /* 월별 지출 */
    var months = monthlyTotals(6);
    if (months.some(function (m) { return m.total > 0; })) {
      var maxM = Math.max.apply(null, months.map(function (m) { return m.total; })) || 1;
      html += '<div class="card"><h2 class="card-h">월별 지출 <span class="sub">최근 6개월</span></h2>' +
        '<div class="monthbars">' + months.map(function (m, i) {
          var h = Math.max(6, Math.round((m.total / maxM) * 96));
          return '<div class="mb' + (i === months.length - 1 ? ' now' : '') + '">' +
            '<div class="mval">' + (m.total ? shortWon(m.total) : '') + '</div>' +
            '<div class="mbar" style="height:' + h + 'px"></div>' +
            '<div class="mlab">' + m.label + '</div></div>';
        }).join('') + '</div></div>';
    }

    /* 기간 영수증 */
    if (recs.length) {
      html += '<div class="month-h"><span>' + (ui.period === 'all' ? '모든 영수증' : '이 기간 영수증') + '</span><span>' + recs.length + '장</span></div>';
      html += '<div class="reclist">' + recs.map(receiptCard).join('') + '</div>';
    }

    host.innerHTML = html;
  }

  function barRows(rows, total) {
    if (!rows.length) return '<p class="hint">내용이 없어요.</p>';
    var max = rows[0].value || 1;
    return rows.map(function (r) {
      var pct = total > 0 ? Math.round(r.value / total * 100) : 0;
      return '<div class="barrow">' +
        '<div class="bl">' + esc(r.label) + '</div>' +
        '<div class="bv">' + won(r.value) + ' <span style="color:#99a29b;font-weight:700">' + pct + '%</span></div>' +
        '<div class="bartrack"><div class="barfill" style="width:' + Math.max(2, Math.round(r.value / max * 100)) + '%;background:' + (r.color || '#2f7d4d') + '"></div></div>' +
        '</div>';
    }).join('');
  }

  function monthlyTotals(n) {
    var t = today();
    var arr = [];
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(t.getFullYear(), t.getMonth() - i, 1);
      arr.push({ key: d.getFullYear() + '-' + pad2(d.getMonth() + 1), label: (d.getMonth() + 1) + '월', total: 0 });
    }
    allReceipts().forEach(function (r) {
      var k = String(r.date).slice(0, 7);
      for (var i = 0; i < arr.length; i++) if (arr[i].key === k) arr[i].total += r.total;
    });
    return arr;
  }

  /* ---------- 영수증 ---------- */
  function receiptCard(r) {
    var names = (r.items || []).map(function (it) { return it.name; });
    var summary = names.length === 0 ? '품목 없음'
      : names.length <= 2 ? names.join(', ')
        : names[0] + ' 외 ' + (names.length - 1) + '개';
    return '<button class="reccard" type="button" data-act="receiptinfo" data-id="' + esc(r.id) + '">' +
      '<div class="rec-top"><span class="rec-date">' + fmtDate(r.date) + '</span>' +
      '<span class="rec-total">' + won(r.total) + '</span></div>' +
      '<div class="rec-store">' + esc(r.store) +
      (r.discount > 0 ? '<span class="rec-save">' + fmt(r.discount) + '원 할인</span>' : '') +
      (r.sample ? '<span class="rec-sample">샘플</span>' : '') + '</div>' +
      '<div class="rec-items">' + esc(summary) + '</div>' +
      '</button>';
  }

  function renderReceipts() {
    var host = $('#view-receipts');
    var recs = allReceipts();
    var html = '';

    if (!S.tipOff) {
      html += '<div class="tipcard">' +
        '<span class="ti" aria-hidden="true">💡</span>' +
        '<div><h4>영수증 사진을 보내기만 하면 자동으로 정리돼요</h4>' +
        '<p>채팅으로 <b>모아</b>에게 영수증 사진을 보내면, 모아가 읽어서 이 앱에 바로 넣어 드립니다. 직접 넣어도 됩니다.</p></div>' +
        '<button class="tipx" type="button" data-act="tipOff" aria-label="안내 닫기">✕</button>' +
        '</div>';
    }

    html += '<div class="row-between" style="margin:14px 2px 0">' +
      '<h2 class="card-h">영수증 <span class="count">' + recs.length + '</span></h2>' +
      '<button class="btn sm" type="button" data-act="addreceipt">＋ 추가</button></div>';

    if (!recs.length) {
      html += '<div class="card"><div class="empty"><span class="emo">🧾</span><h3>아직 영수증이 없어요</h3>' +
        '<p>가게에서 받은 영수증을 하나씩 넣어 보세요. 넣은 만큼 가격 비교와 지출 정리가 쌓입니다.</p>' +
        '<button class="btn" type="button" data-act="addreceipt">첫 영수증 넣기</button>' +
        sampleButtonHtml('') + '</div></div>';
    } else {
      var byMonth = {};
      var order = [];
      recs.forEach(function (r) {
        var k = String(r.date).slice(0, 7);
        if (!byMonth[k]) { byMonth[k] = []; order.push(k); }
        byMonth[k].push(r);
      });
      order.sort().reverse();
      order.forEach(function (k) {
        var list = byMonth[k];
        html += '<div class="month-h"><span>' + fmtMonth(k + '-01') + '</span><span>' +
          list.length + '장 · ' + won(sumTotal(list)) + '</span></div>';
        html += '<div class="reclist">' + list.map(receiptCard).join('') + '</div>';
      });
    }

    html += '<p class="hint" style="text-align:center;margin:22px 0 4px">기록은 이 휴대폰에 저장됩니다.</p>';
    host.innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * 시트(아래에서 올라오는 창)
   * ------------------------------------------------------------------ */
  function openSheet(html) {
    $('#sheetBody').innerHTML = html;
    $('#sheetWrap').hidden = false;
    document.body.classList.add('sheet-open');
    var body = $('#sheetBody');
    body.scrollTop = 0;
  }
  function closeSheet() {
    $('#sheetWrap').hidden = true;
    document.body.classList.remove('sheet-open');
    confirmAction = null;
  }
  function closeBtnHtml() {
    return '<button class="iconbtn" type="button" data-act="closeSheet" aria-label="닫기">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
  }

  function openConfirm(title, desc, action, label) {
    confirmAction = action;
    openSheet('<div class="sheet-head"><div><h2 id="sheetTitle">' + esc(title) + '</h2></div>' + closeBtnHtml() + '</div>' +
      '<p class="hint" style="margin-top:6px">' + esc(desc) + '</p>' +
      '<div class="sheet-actions"><button class="btn line" type="button" data-act="closeSheet">취소</button>' +
      '<button class="btn" type="button" data-act="confirmYes" style="background:#b23b34">' + esc(label) + '</button></div>');
  }

  /* ---------- 품목 상세 ---------- */
  function openItemSheet(key, fallbackName) {
    var g = groupByKey(key);
    var inList = shopIndexByKey(key) >= 0;
    var name = g ? g.name : (fallbackName || '품목');

    if (!g) {
      openSheet('<div class="sheet-head"><div><h2 id="sheetTitle">' + esc(name) + '</h2>' +
        '<div class="cat">가격 기록이 아직 없어요</div></div>' + closeBtnHtml() + '</div>' +
        '<p class="hint" style="margin-top:8px">영수증을 넣으면 이 품목의 지난 가격과 가장 싼 곳을 여기에서 볼 수 있어요.</p>' +
        '<div class="sheet-actions">' +
        '<button class="btn ' + (inList ? 'line' : '') + '" type="button" data-act="itemadd" data-key="' + esc(key) + '" data-name="' + esc(name) + '">' +
        (inList ? '살 목록에서 빼기' : '살 목록에 담기') + '</button>' +
        '<button class="btn line" type="button" data-act="closeSheet">닫기</button></div>');
      return;
    }

    var byStore = new Map();
    g.purchases.forEach(function (p) {
      var s = byStore.get(p.store);
      if (!s) { s = { store: p.store, min: null, max: null, count: 0, last: p }; byStore.set(p.store, s); }
      if (p.price > 0) {
        if (!s.min || p.price < s.min) s.min = p.price;
        if (!s.max || p.price > s.max) s.max = p.price;
      }
      s.count++;
      if (p.date >= s.last.date) s.last = p;
    });
    var storeRows = Array.from(byStore.values()).sort(function (a, b) {
      return (a.min || Infinity) - (b.min || Infinity);
    });

    var prices = g.purchases.filter(function (p) { return p.price > 0; }).map(function (p) { return p.price; });
    var gap = g.min && g.lastPriced ? g.lastPriced.price - g.min.price : 0;
    var verdict = !g.min ? ''
      : gap <= 0 ? '지난번에는 가장 싸게 샀어요'
        : '지난번엔 최저가보다 ' + won(gap) + ' 더 주고 샀어요';

    var html = '';
    html += '<div class="sheet-head"><div><h2 id="sheetTitle">' + esc(g.name) + '</h2>' +
      '<div class="cat">' + esc(g.category) + ' · ' + g.count + '번 샀어요</div></div>' + closeBtnHtml() + '</div>';

    html += '<div class="statgrid">' +
      '<div class="stat"><div class="sl">가장 싼 값</div><div class="sv">' + (g.min ? won(g.min.price) : '-') + '</div>' +
      '<div class="ss">' + (g.min ? esc(g.min.store) + ' · ' + fmtDate(g.min.date) : '기록 없음') + '</div></div>' +
      '<div class="stat"><div class="sl">지난번 값</div><div class="sv">' + (g.lastPriced ? won(g.lastPriced.price) : '-') + '</div>' +
      '<div class="ss">' + (g.lastPriced ? esc(g.lastPriced.store) + ' · ' + fmtDate(g.lastPriced.date) : '기록 없음') + '</div></div>' +
      '<div class="stat"><div class="sl">평균 값</div><div class="sv">' + (g.avg ? won(g.avg) : '-') + '</div>' +
      '<div class="ss">' + (prices.length ? prices.length + '번 기록' : '') + '</div></div>' +
      '<div class="stat"><div class="sl">가장 비쌌을 때</div><div class="sv">' + (g.max ? won(g.max.price) : '-') + '</div>' +
      '<div class="ss">' + (g.max ? esc(g.max.store) : '') + '</div></div>' +
      '</div>';

    if (verdict) {
      html += '<p class="hint" style="margin-top:10px;font-weight:700;color:#3b443e">' + esc(verdict) + '</p>';
    }

    html += '<div class="chartcard"><h3>값이 어떻게 변했나</h3>' + priceChart(g.purchases, g.avg) + '</div>';

    html += '<div class="card" style="margin-top:10px"><h3 class="card-h" style="font-size:14px">가게별</h3><div class="dlist">' +
      storeRows.map(function (s) {
        return '<div class="drow"><div class="dl">' + esc(s.store) + '<span class="ds">' + s.count + '번</span></div>' +
          '<div class="dr">' + (s.min ? won(s.min) : '-') + '</div></div>';
      }).join('') + '</div></div>';

    var hist = g.purchases.slice().reverse();
    html += '<div class="card" style="margin-top:10px"><h3 class="card-h" style="font-size:14px">산 기록</h3><div class="dlist">' +
      hist.map(function (p) {
        return '<div class="drow"><div class="dl">' + fmtDate(p.date) + '<span class="ds">' + esc(p.store) + '</span></div>' +
          '<div class="dr">' + (p.price ? won(p.price) : '-') + (p.qty > 1 ? '<span class="ds">×' + p.qty + '</span>' : '') + '</div></div>';
      }).join('') + '</div></div>';

    html += '<div class="sheet-actions">' +
      '<button class="btn ' + (inList ? 'line' : '') + '" type="button" data-act="itemadd" data-key="' + esc(g.key) + '" data-name="' + esc(g.name) + '">' +
      (inList ? '살 목록에서 빼기' : '살 목록에 담기') + '</button>' +
      '<button class="btn line" type="button" data-act="closeSheet">닫기</button></div>';

    openSheet(html);
  }

  function priceChart(purchases, avg) {
    var pts = purchases.filter(function (p) { return p.price > 0; });
    if (!pts.length) return '<p class="hint">값 기록이 없어요.</p>';

    var W = 328, H = 148, L = 12, R = 12, T = 18, B = 30;
    var prices = pts.map(function (p) { return p.price; });
    var lo = Math.min.apply(null, prices.concat(avg || []));
    var hi = Math.max.apply(null, prices.concat(avg || []));
    if (hi === lo) { hi = lo * 1.06; lo = lo * 0.94; }
    if (hi - lo < 1) { hi += 1; }
    var span = hi - lo;

    function X(i) { return pts.length === 1 ? W / 2 : L + (W - L - R) * i / (pts.length - 1); }
    function Y(v) { return T + (H - T - B) * (1 - (v - lo) / span); }

    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.price).toFixed(1); }).join(' ');
    var area = line + ' L' + X(pts.length - 1).toFixed(1) + ' ' + (H - B) + ' L' + X(0).toFixed(1) + ' ' + (H - B) + ' Z';

    var minPrice = Math.min.apply(null, prices);
    var dots = pts.map(function (p, i) {
      var isMin = p.price === minPrice;
      return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(p.price).toFixed(1) + '" r="' + (isMin ? 4 : 3) + '" fill="' + (isMin ? '#2f7d4d' : '#ffffff') + '" stroke="#2f7d4d" stroke-width="1.7"/>';
    }).join('');

    var avgLine = avg ? '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(avg).toFixed(1) + '" y2="' + Y(avg).toFixed(1) + '" stroke="#c8cec8" stroke-width="1" stroke-dasharray="4 4"/>' +
      '<text x="' + (W - R) + '" y="' + (Y(avg) - 5).toFixed(1) + '" text-anchor="end" font-size="9.5" fill="#99a29b">평균 ' + fmt(avg) + '</text>' : '';

    var x1 = X(0), x2 = X(pts.length - 1);
    var labels = '<text x="' + x1.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="start" font-size="10" fill="#99a29b">' + fmtDate(pts[0].date) + '</text>' +
      (pts.length > 1 ? '<text x="' + x2.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="end" font-size="10" fill="#99a29b">' + fmtDate(pts[pts.length - 1].date) + '</text>' : '');

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="품목 가격 변화">' +
      '<defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#2f7d4d" stop-opacity="0.16"/>' +
      '<stop offset="100%" stop-color="#2f7d4d" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#g1)"/>' +
      avgLine +
      '<path d="' + line + '" fill="none" stroke="#2f7d4d" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' +
      dots + labels +
      '</svg>';
  }

  /* ---------- 영수증 상세 ---------- */
  function openReceiptSheet(id) {
    var r = receiptById(id);
    if (!r) { toast('영수증을 찾을 수 없어요'); return; }
    var html = '<div class="sheet-head"><div><h2 id="sheetTitle">' + esc(r.store) + '</h2>' +
      '<div class="cat">' + fmtDateFull(r.date) + '</div></div>' + closeBtnHtml() + '</div>';

    html += '<div class="card" style="margin-top:6px">';
    html += '<div class="trow head"><div>품목</div><div>수량</div><div style="text-align:right">금액</div></div>';
    r.items.forEach(function (it) {
      html += '<div class="trow"><div class="tn">' + esc(it.name) + '</div>' +
        '<div class="tq">' + (it.qty > 1 ? it.qty + '개 · ' + fmt(it.price) + '원' : '1개') + '</div>' +
        '<div class="tv">' + won(it.amount) + '</div></div>';
    });
    html += '<div class="sumline"><span>합계</span><b>' + won(r.subtotal) + '</b></div>';
    if (r.discount > 0) {
      html += '<div class="sumline"><span>할인</span><b class="dis">-' + won(r.discount) + '</b></div>';
    }
    html += '<div class="sumline total"><span>낸 금액</span><b>' + won(r.total) + '</b></div>';
    if (r.memo) html += '<p class="hint" style="margin-top:10px">메모: ' + esc(r.memo) + '</p>';
    html += '</div>';

    html += '<div class="sheet-actions">' +
      '<button class="btn line" type="button" data-act="editreceipt" data-id="' + esc(r.id) + '">수정</button>' +
      '<button class="btn line" type="button" data-act="delreceipt" data-id="' + esc(r.id) + '" style="color:#b23b34;border-color:#f0d4d1">지우기</button>' +
      '</div>';

    openSheet(html);
  }

  /* ---------- 영수증 넣기 / 고치기 ---------- */
  function receiptForm(r) {
    var editing = !!r;
    var data = r || {
      date: ymd(today()),
      store: '',
      items: [{ name: '', category: '기타', qty: 1, price: 0 }],
      discount: 0,
      memo: ''
    };
    var stores = Array.from(new Set(allReceipts().map(function (x) { return x.store; })));
    var storeOptions = stores.map(function (s) { return '<option value="' + esc(s) + '"></option>'; }).join('');

    var html = '<div class="sheet-head"><div><h2 id="sheetTitle">' + (editing ? '영수증 고치기' : '영수증 넣기') + '</h2>' +
      '<div class="cat">가게에서 받은 그대로 적으면 됩니다</div></div>' + closeBtnHtml() + '</div>';

    html += '<form id="recForm" data-form="recForm" data-id="' + (editing ? esc(r.id) : '') + '" autocomplete="off">';
    html += '<div class="formrow">' +
      '<div><label class="formlab" for="recDate">날짜</label>' +
      '<input class="field" id="recDate" name="date" type="date" value="' + esc(data.date) + '" required></div>' +
      '<div><label class="formlab" for="recStore">가게 이름</label>' +
      '<input class="field" id="recStore" name="store" type="text" list="storeList" placeholder="예: 이마트 강일점" value="' + esc(data.store) + '" maxlength="30"></div>' +
      '</div><datalist id="storeList">' + storeOptions + '</datalist>';

    html += '<label class="formlab">품목</label><div id="itemList">';
    data.items.forEach(function (it, i) { html += itemEditRow(it, i); });
    html += '</div>';
    html += '<button class="btn line block sm" type="button" data-act="addItemRow" style="margin-top:10px">＋ 품목 한 줄 더</button>';

    html += '<div class="formrow">' +
      '<div><label class="formlab" for="recDiscount">할인 금액</label>' +
      '<input class="field" id="recDiscount" name="discount" type="number" inputmode="numeric" min="0" step="10" value="' + (data.discount || 0) + '"></div>' +
      '<div><label class="formlab">낸 금액</label>' +
      '<div class="field" id="formTotal" style="display:flex;align-items:center;font-weight:800;background:#f9f9f6">' + won(calcFormTotal()) + '</div></div>' +
      '</div>';

    html += '<label class="formlab" for="recMemo">메모 (안 써도 됩니다)</label>' +
      '<input class="field" id="recMemo" name="memo" type="text" maxlength="60" placeholder="예: 주말 대량 장보기" value="' + esc(data.memo) + '">';

    html += '<div class="sheet-actions"><button class="btn" type="submit">' + (editing ? '고친 내용 저장' : '영수증 저장') + '</button></div>';
    html += '<p class="hint" style="text-align:center;margin-top:10px">저장하면 가격 비교와 기간 정리에 바로 반영됩니다.</p>';
    html += '</form>';

    openSheet(html);
  }

  function itemEditRow(it, i) {
    return '<div class="itemedit" data-row="' + i + '">' +
      '<div class="ie-top">' +
      '<input class="field" name="itemName" type="text" placeholder="품목 이름 (예: 서울우유 1L)" value="' + esc(it.name) + '" maxlength="30">' +
      '<button class="row-del" type="button" data-act="delItemRow" aria-label="이 줄 지우기">' +
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
      '</div>' +
      '<div class="ie-grid">' +
      '<div><label>분류</label><select class="field" name="itemCat">' +
      CATS.map(function (c) { return '<option value="' + esc(c) + '"' + (it.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
      '</select></div>' +
      '<div><label>수량</label><input class="field" name="itemQty" type="number" inputmode="numeric" min="1" step="1" value="' + (it.qty || 1) + '"></div>' +
      '<div><label>한 개 값</label><input class="field" name="itemPrice" type="number" inputmode="numeric" min="0" step="10" value="' + (it.price || 0) + '"></div>' +
      '</div></div>';
  }

  function calcFormTotal() {
    var f = $('#recForm');
    if (!f) return 0;
    var sub = 0;
    $$('.itemedit', f).forEach(function (box) {
      var q = Math.max(1, num(box.querySelector('[name=itemQty]').value) || 1);
      var p = Math.max(0, num(box.querySelector('[name=itemPrice]').value));
      sub += q * p;
    });
    var disc = Math.max(0, num((f.querySelector('[name=discount]') || {}).value));
    return Math.max(0, sub - disc);
  }

  function collectReceiptForm() {
    var f = $('#recForm');
    if (!f) return null;
    var items = [];
    $$('.itemedit', f).forEach(function (box) {
      var name = box.querySelector('[name=itemName]').value.trim();
      if (!name) return;
      var category = box.querySelector('[name=itemCat]').value;
      var qty = Math.max(1, Math.round(num(box.querySelector('[name=itemQty]').value)) || 1);
      var price = Math.max(0, Math.round(num(box.querySelector('[name=itemPrice]').value)));
      items.push({ name: name, category: CATS.indexOf(category) >= 0 ? category : '기타', qty: qty, price: price, amount: qty * price });
    });
    if (!items.length) { toast('품목을 하나 이상 적어 주세요'); return null; }
    var subtotal = items.reduce(function (s, it) { return s + it.amount; }, 0);
    var discount = Math.max(0, Math.round(num(f.querySelector('[name=discount]').value)));
    var date = f.querySelector('[name=date]').value || ymd(today());
    var store = f.querySelector('[name=store]').value.trim() || '가게 이름 없음';
    var memo = f.querySelector('[name=memo]').value.trim();
    return { date: date, store: store, items: items, subtotal: subtotal, discount: discount, total: Math.max(0, subtotal - discount), memo: memo };
  }

  function saveReceiptForm(formEl) {
    var data = collectReceiptForm();
    if (!data) return;
    var id = formEl.dataset.id || '';
    if (id) {
      if (id.indexOf('u-') === 0) {
        var idx = -1;
        S.receipts.forEach(function (r, i) { if (r.id === id) idx = i; });
        if (idx >= 0) S.receipts[idx] = Object.assign({}, data, { id: id });
      } else {
        S.overrides[id] = Object.assign({}, data, { id: id });
      }
      toast('영수증을 고쳤어요');
    } else {
      S.receipts.push(Object.assign({}, data, { id: 'u-' + Date.now() }));
      toast('영수증을 넣었어요');
    }
    save();
    closeSheet();
    render();
  }

  /* ---------- 설정 ---------- */
  function openSettings() {
    var sampleCount = BASE.receipts.filter(function (r) { return r.sample; }).length;
    var userCount = S.receipts.length;
    var html = '<div class="sheet-head"><div><h2 id="sheetTitle">더보기</h2>' +
      '<div class="cat">영수증 ' + allReceipts().length + '장 · 품목 ' + groups().length + '가지</div></div>' + closeBtnHtml() + '</div>';

    html += '<div class="card" style="margin-top:8px">';

    html += '<div class="settingrow"><div class="st"><b>샘플 데이터</b>' +
      '<span>앱을 미리 써 보도록 넣어 둔 영수증 ' + sampleCount + '장입니다. 실제 기록을 넣기 시작하면 비우세요. 비워도 앱에서 직접 넣은 영수증은 그대로 남습니다.</span></div>' +
      '<button class="btn sm ' + (S.showSample ? 'line' : 'ghost') + '" type="button" data-act="toggleSample">' +
      (S.showSample ? '샘플 비우기' : '샘플 불러오기') + '</button></div>';

    html += '<div class="settingrow"><div class="st"><b>홈 화면에 추가</b>' +
      '<span>휴대폰 홈 화면에 앱처럼 놓을 수 있습니다. 크롬에서 오른쪽 위 <b>⋮</b> → ‘홈 화면에 추가’를 누르세요.</span></div>' +
      (deferredPrompt ? '<button class="btn sm ghost" type="button" data-act="install">설치</button>' : '') + '</div>';

    html += '<div class="settingrow"><div class="st"><b>내가 넣은 영수증 지우기</b>' +
      '<span>앱에서 직접 넣거나 고친 기록을 모두 지웁니다.' + (userCount ? ' 지금 ' + userCount + '장.' : '') + '</span></div>' +
      '<button class="btn sm line" type="button" data-act="resetUser"' + (userCount ? '' : ' disabled') + '>지우기</button></div>';

    html += '</div>';
    html += '<p class="hint" style="text-align:center;margin-top:6px">장보기 · 기록은 이 휴대폰 저장 공간에만 보관됩니다.<br>영수증 사진을 모아에게 보내면 자동으로 정리해 드려요.</p>';
    openSheet(html);
  }

  /* ------------------------------------------------------------------ *
   * 동작 처리
   * ------------------------------------------------------------------ */
  function handleAct(act, el) {
    var d = el.dataset || {};
    switch (act) {
      case 'closeSheet': closeSheet(); break;

      case 'iteminfo':
        openItemSheet(d.key, d.name);
        break;

      case 'itemadd': {
        var idx = shopIndexByKey(d.key);
        if (idx >= 0) { S.shopping.splice(idx, 1); save(); toast('살 목록에서 뺐어요'); }
        else if (addShopItem(d.name, d.key)) { save(); toast('살 목록에 담았어요'); }
        closeSheet();
        render();
        break;
      }

      case 'receiptinfo': openReceiptSheet(d.id); break;

      case 'toggleshop': {
        S.shopping.forEach(function (x) { if (x.id === d.id) x.checked = !x.checked; });
        save();
        render();
        break;
      }

      case 'delshop': {
        S.shopping = S.shopping.filter(function (x) { return x.id !== d.id; });
        save();
        toast('목록에서 뺐어요');
        render();
        break;
      }

      case 'clearDone': {
        var n = S.shopping.filter(function (x) { return x.checked; }).length;
        S.shopping = S.shopping.filter(function (x) { return !x.checked; });
        save();
        toast(n + '개를 지웠어요');
        render();
        break;
      }

      case 'addstaple': {
        var key = d.key || itemKey(d.name);
        var at = shopIndexByKey(key);
        if (at >= 0) { S.shopping.splice(at, 1); save(); toast('살 목록에서 뺐어요'); }
        else if (addShopItem(d.name, key)) { save(); toast('살 목록에 담았어요'); }
        render();
        break;
      }

      case 'delstaple':
        S.staples = S.staples.filter(function (s) { return itemKey(s.name) !== itemKey(d.name); });
        save();
        toast('단골 품목에서 뺐어요');
        render();
        break;

      case 'toggleStapleAdd':
        ui.stapleAddOpen = !ui.stapleAddOpen;
        renderList();
        if (ui.stapleAddOpen) {
          var inp = $('#view-list [data-form="addstaple"] input');
          if (inp) inp.focus();
        }
        break;

      case 'cycleSort': {
        var keys = Object.keys(SORTS);
        ui.sort = keys[(keys.indexOf(ui.sort) + 1) % keys.length];
        renderPriceList();
        break;
      }

      case 'setCat':
        ui.cat = d.v;
        $$('#view-price .chip').forEach(function (c) {
          c.setAttribute('aria-pressed', String(c.dataset.v === ui.cat));
        });
        renderPriceList();
        break;

      case 'setPeriod':
        ui.period = d.v;
        renderPeriod();
        break;

      case 'addreceipt': receiptForm(null); break;

      case 'editreceipt': {
        var r = receiptById(d.id);
        if (r) receiptForm(r);
        break;
      }

      case 'delreceipt':
        openConfirm('이 영수증을 지울까요?', '지우면 이 기록의 가격과 지출도 함께 빠집니다.', 'del:' + d.id, '지우기');
        break;

      case 'confirmYes': {
        var act2 = confirmAction;
        closeSheet();
        if (!act2) break;
        if (act2.indexOf('del:') === 0) {
          var rid = act2.slice(4);
          if (rid.indexOf('u-') === 0) {
            S.receipts = S.receipts.filter(function (x) { return x.id !== rid; });
          } else {
            if (S.hidden.indexOf(rid) < 0) S.hidden.push(rid);
            delete S.overrides[rid];
          }
          save();
          toast('영수증을 지웠어요');
          render();
        } else if (act2 === 'resetUser') {
          S.receipts = [];
          S.hidden = [];
          S.overrides = {};
          save();
          toast('내가 넣은 영수증을 지웠어요');
          render();
        }
        break;
      }

      case 'toggleSample': {
        S.showSample = !S.showSample;
        save();
        toast(S.showSample ? '샘플 데이터를 불러왔어요' : '샘플 데이터를 비웠어요');
        render();
        if (!$('#sheetWrap').hidden) openSettings();
        break;
      }

      case 'resetUser':
        openConfirm('내가 넣은 영수증을 모두 지울까요?', '앱에서 직접 넣거나 고친 기록이 모두 사라집니다. 되돌릴 수 없습니다.', 'resetUser', '모두 지우기');
        break;

      case 'install':
        if (deferredPrompt) {
          deferredPrompt.prompt();
          deferredPrompt = null;
        }
        break;

      case 'tipOff':
        S.tipOff = true;
        save();
        renderReceipts();
        break;

      case 'addItemRow': {
        var list = $('#itemList');
        if (list) {
          var div = document.createElement('div');
          div.innerHTML = itemEditRow({ name: '', category: '기타', qty: 1, price: 0 }, list.children.length);
          list.appendChild(div.firstChild);
          var inputs = list.querySelectorAll('.itemedit');
          var last = inputs[inputs.length - 1];
          if (last) last.querySelector('[name=itemName]').focus();
        }
        break;
      }

      case 'delItemRow': {
        var box = el.closest('.itemedit');
        var list2 = $('#itemList');
        if (box && list2) {
          if (list2.querySelectorAll('.itemedit').length <= 1) {
            var nmEl = box.querySelector('[name=itemName]');
            if (nmEl) { nmEl.value = ''; box.querySelector('[name=itemQty]').value = 1; box.querySelector('[name=itemPrice]').value = 0; }
          } else {
            box.remove();
          }
          updateFormTotal();
        }
        break;
      }

      default: break;
    }
  }

  function updateFormTotal() {
    var ft = $('#formTotal');
    if (ft) ft.textContent = won(calcFormTotal());
  }

  /* ------------------------------------------------------------------ *
   * 이벤트
   * ------------------------------------------------------------------ */
  document.addEventListener('click', function (e) {
    var tabBtn = e.target.closest('.tabbar [data-tab]');
    if (tabBtn) { setTab(tabBtn.dataset.tab); return; }
    var actEl = e.target.closest('[data-act]');
    if (actEl) {
      e.preventDefault();
      handleAct(actEl.dataset.act, actEl);
    }
  });

  document.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    var kind = form.dataset.form;

    if (kind === 'addshop') {
      var inp = form.querySelector('[name=name]');
      var v = inp.value.trim();
      if (!v) { inp.focus(); return; }
      if (addShopItem(v)) {
        save();
        toast('살 목록에 담았어요');
        render();
        var again = $('#view-list [data-form="addshop"] input');
        if (again) again.focus();
      }
      return;
    }

    if (kind === 'addstaple') {
      var inp2 = form.querySelector('[name=name]');
      var v2 = inp2.value.trim();
      if (!v2) { inp2.focus(); return; }
      var k = itemKey(v2);
      if (S.staples.some(function (s) { return itemKey(s.name) === k; })) {
        toast('이미 단골 품목에 있어요');
        return;
      }
      if (groupByKey(k)) { toast('이미 영수증에 있는 품목이에요'); ui.stapleAddOpen = false; renderList(); return; }
      S.staples.push({ name: v2, custom: true });
      save();
      toast('단골 품목에 넣었어요');
      ui.stapleAddOpen = false;
      renderList();
      return;
    }

    if (kind === 'recForm') {
      saveReceiptForm(form);
      return;
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'priceQ') {
      ui.q = e.target.value;
      renderPriceList();
      return;
    }
    if (e.target.closest('#recForm')) {
      updateFormTotal();
    }
  });

  document.getElementById('btnMore').addEventListener('click', function () { openSettings(); });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('#sheetWrap').hidden) closeSheet();
  });

  window.addEventListener('scroll', function () {
    var bar = document.getElementById('appbar');
    if (window.scrollY > 4) bar.classList.add('scrolled');
    else bar.classList.remove('scrolled');
  }, { passive: true });

  /* ------------------------------------------------------------------ *
   * 시작
   * ------------------------------------------------------------------ */
  render();
  loadBase();

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 오프라인 준비 실패는 무시 */ });
    });
  }
})();
