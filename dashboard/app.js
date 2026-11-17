/* Launch Radar — the board, a detail view per protocol, the already-trading set and the model.
   Everything renders from window.RADAR, the data.js the entry's program writes beside this page
   from the same board it hands in as board.json. No fetch, no network, no framework. */

(function () {
  'use strict';
  var DATA = window.RADAR;
  var app = document.getElementById('app');
  var meta = document.getElementById('snapshot-meta');

  /* ---------- formatting ---------- */

  function fmtUsd(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function fmtFull(n) { return '$' + n.toLocaleString('en-US'); }
  function fmtPct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 730) return (days / 365.25).toFixed(1) + ' yrs';
    if (days >= 60) return Math.round(days / 30.4) + ' mo';
    return days + ' d';
  }
  function fmtFactor(n) { return '×' + n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0'); }

  /* ---------- tiny DOM helper ---------- */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined) return;
      if (k === 'text') node.textContent = v;
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  /* ---------- the model, recomputed in the page ---------- */

  /* The same arithmetic lib/model.ts runs, from the row's own stored inputs, so the detail view
     can show that the number on the board is the number the formula gives. */
  function recompute(row) {
    var m = DATA.model;
    var pct = row.momentum_pct === null ? 0 : row.momentum_pct;
    var momentum = 1 + (pct / 100) * m.momentum_weight;
    var endurance = row.age_days === null
      ? m.unknown_endurance
      : m.endurance_floor + (Math.min(row.age_days, m.endurance_days) / m.endurance_days) * m.endurance_range;
    return Math.max(1, Math.round(row.tvl_usd * row.multiple * momentum * endurance));
  }

  /* ---------- state & routing ---------- */

  var state = { q: '', cat: 'all', chain: 'all', wl: false, sort: 'rank', dir: 1 };
  var searchHadFocus = false;

  function parseBoardHash(h) {
    var q = h.indexOf('?');
    if (q < 0) return;
    new URLSearchParams(h.slice(q + 1)).forEach(function (v, k) {
      if (k === 'q') state.q = v;
      else if (k === 'cat') state.cat = v;
      else if (k === 'chain') state.chain = v;
      else if (k === 'wl') state.wl = v === '1';
      else if (k === 'sort') state.sort = v;
      else if (k === 'dir') state.dir = v === '-1' ? -1 : 1;
    });
  }

  function writeBoardHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat !== 'all') p.set('cat', state.cat);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.wl) p.set('wl', '1');
    if (state.sort !== 'rank') p.set('sort', state.sort);
    if (state.dir !== 1) p.set('dir', '-1');
    var s = p.toString();
    history.replaceState(null, '', '#/' + (s ? '?' + s : ''));
  }

  function route() {
    var h = location.hash || '#/';
    document.querySelectorAll('#views a').forEach(function (a) {
      a.removeAttribute('aria-current');
    });
    if (h.indexOf('#/p/') === 0) {
      markView('board');
      renderDetail(decodeURIComponent(h.slice(4)));
    } else if (h === '#/live') {
      markView('live');
      renderLive();
    } else if (h === '#/model') {
      markView('model');
      renderModel();
    } else {
      markView('board');
      parseBoardHash(h);
      renderBoard();
    }
    app.setAttribute('aria-busy', 'false');
    window.scrollTo(0, 0);
  }

  function markView(name) {
    document.querySelectorAll('#views a').forEach(function (a) {
      if (a.getAttribute('data-view') === name) a.setAttribute('aria-current', 'page');
    });
  }

  /* ---------- masthead ---------- */

  function renderMeta() {
    var items = [
      ['Snapshot', DATA.as_of],
      ['Protocols', String(DATA.counts.protocols)],
      ['Watchlist', String(DATA.counts.watchlist)],
      ['Board rows', String(DATA.counts.board)],
      ['Model', DATA.model_version],
    ];
    items.forEach(function (pair) {
      meta.appendChild(el('dt', { text: pair[0] }));
      meta.appendChild(el('dd', { text: pair[1] }));
    });
  }

  /* ---------- the board ---------- */

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.wl && !r.on_watchlist) return false;
      if (state.cat !== 'all' && (r.category || 'Uncategorised') !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function sortedRows(list) {
    var key = state.sort, dir = state.dir;
    var val = function (r) {
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'change') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'age') return r.age_days === null ? -1 : r.age_days;
      if (key === 'implied') return r.implied_value_usd;
      return r.rank;
    };
    return list.slice().sort(function (a, b) {
      var d = (val(a) - val(b)) * dir;
      return d !== 0 ? d : a.rank - b.rank;
    });
  }

  function sortHead(key, label, numeric) {
    var arrow = state.sort === key ? (state.dir === 1 ? ' ↑' : ' ↓') : '';
    return el('th', numeric ? { class: 'num' } : null, [
      el('button', {
        type: 'button', text: label + arrow,
        onclick: function () {
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
          writeBoardHash(); renderBoard();
        },
      }),
    ]);
  }

  function renderBoard() {
    app.textContent = '';
    app.appendChild(el('div', { class: 'formula-strip' }, [
      el('strong', { text: 'How a row earns its rank' }),
      el('code', { text: 'implied = TVL × peer multiple × momentum × endurance' }),
      el('span', { text: 'The multiple is the median market value per TVL dollar of live protocols in the same category. Full model on the model page.' }),
    ]));

    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    var chainCount = {};
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { chainCount[c] = (chainCount[c] || 0) + 1; }); });
    var chains = Object.keys(chainCount).sort(function (a, b) { return chainCount[b] - chainCount[a] || (a < b ? -1 : 1); });

    var search = el('input', {
      type: 'search', placeholder: 'Search name or slug…', value: state.q, 'aria-label': 'Search protocols',
      oninput: function () { state.q = search.value; searchHadFocus = true; writeBoardHash(); renderBoardTable(); },
      onfocus: function () { searchHadFocus = true; },
      onblur: function () { searchHadFocus = false; },
    });
    var catSel = el('select', { 'aria-label': 'Filter by category', onchange: function () { state.cat = catSel.value; writeBoardHash(); renderBoard(); } },
      [el('option', { value: 'all', text: 'All categories' })].concat(cats.map(function (c) {
        return el('option', { value: c, text: c, selected: c === state.cat ? 'selected' : null });
      })));
    var chainSel = el('select', { 'aria-label': 'Filter by chain', onchange: function () { state.chain = chainSel.value; writeBoardHash(); renderBoard(); } },
      [el('option', { value: 'all', text: 'All chains' })].concat(chains.map(function (c) {
        return el('option', { value: c, text: c + ' (' + chainCount[c] + ')', selected: c === state.chain ? 'selected' : null });
      })));
    var wlBox = el('input', { type: 'checkbox', onchange: function () { state.wl = wlBox.checked; writeBoardHash(); renderBoard(); } });
    if (state.wl) wlBox.setAttribute('checked', '');
    var count = el('span', { class: 'count', id: 'row-count' });

    app.appendChild(el('div', { class: 'controls' }, [
      search, catSel, chainSel,
      el('label', { class: 'check' }, [wlBox, 'Watchlist only']),
      count,
    ]));
    app.appendChild(el('div', { id: 'board-slot' }));
    renderBoardTable();
    /* Only the search box reclaims focus, and only when the reader was typing in it: a sort or a
       filter change rebuilds the controls, and stealing focus then would fight the reader. */
    if (searchHadFocus) {
      search.focus({ preventScroll: true });
      if (state.q) search.setSelectionRange(state.q.length, state.q.length);
    }
  }

  function renderBoardTable() {
    var slot = document.getElementById('board-slot');
    if (!slot) return;
    slot.textContent = '';
    var list = sortedRows(visibleRows());
    var count = document.getElementById('row-count');
    if (count) count.textContent = list.length + ' of ' + DATA.rows.length + ' rows';
    if (list.length === 0) {
      slot.appendChild(el('div', { class: 'empty' }, [
        el('p', { text: 'No protocol matches these filters.' }),
        el('button', {
          type: 'button', text: 'Clear the filters',
          onclick: function () { state.q = ''; state.cat = 'all'; state.chain = 'all'; state.wl = false; writeBoardHash(); renderBoard(); },
        }),
      ]));
      return;
    }
    var table = el('table', { class: 'board' });
    table.appendChild(el('thead', null, [el('tr', null, [
      sortHead('rank', '#'),
      el('th', { text: 'Protocol' }),
      el('th', { class: 'hide-s', text: 'Category' }),
      el('th', { class: 'hide-s', text: 'Chains' }),
      sortHead('tvl', 'TVL', true),
      sortHead('change', '7d', true),
      sortHead('age', 'Age', true),
      el('th', { class: 'num', text: 'Multiple' }),
      sortHead('implied', 'Implied value', true),
    ])]));
    var body = el('tbody');
    list.forEach(function (r) {
      var tr = el('tr', {
        tabindex: '0', role: 'link',
        onclick: function () { location.hash = '#/p/' + encodeURIComponent(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter') location.hash = '#/p/' + encodeURIComponent(r.slug); },
      }, [
        el('td', { class: 'rank', text: String(r.rank) }),
        el('td', { class: 'name' }, [
          document.createTextNode(r.name),
          r.on_watchlist
            ? el('span', { class: 'badge watch', text: 'Watchlist' })
            : el('span', { class: 'badge early', text: 'Early' }),
          el('span', { class: 'slug', text: r.slug }),
        ]),
        el('td', { class: 'hide-s', text: r.category || '—' }),
        el('td', { class: 'hide-s' }, [el('span', { class: 'chains', text: r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') })]),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: r.multiple.toFixed(2) + '×' }),
        el('td', { class: 'num implied', text: fmtUsd(r.implied_value_usd) }),
      ]);
      body.appendChild(tr);
    });
    table.appendChild(body);
    slot.appendChild(table);
  }

  /* ---------- detail ---------- */

  function kv(label, value, plain) {
    return el('tr', null, [el('th', { text: label }), el('td', plain ? { class: 'plain', text: value } : { text: value })]);
  }

  function renderDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    app.textContent = '';
    if (!row) {
      app.appendChild(el('p', null, [el('a', { href: '#/', text: '← Back to the board' })]));
      app.appendChild(el('div', { class: 'empty' }, [el('p', { text: 'No board row names this protocol.' })]));
      return;
    }
    app.appendChild(el('a', { class: 'back', href: '#/', text: '← Back to the board' }));
    app.appendChild(el('div', { class: 'detail-head' }, [
      el('span', { class: 'rank-big', text: '#' + row.rank }),
      el('h2', { text: row.name }),
      row.on_watchlist
        ? el('span', { class: 'badge watch', text: 'On the snapshot watchlist' })
        : el('span', { class: 'badge early', text: 'Early — below the watchlist floor' }),
    ]));
    app.appendChild(el('p', { class: 'detail-sub' }, [
      el('span', { class: 'slug', text: row.slug }),
      document.createTextNode(' · ' + (row.category || 'Uncategorised') + ' · records no token in the snapshot of ' + DATA.as_of),
    ]));

    var record = el('div', { class: 'card' }, [
      el('h3', { text: 'The record' }),
      el('table', { class: 'kv' }, [
        kv('TVL', fmtFull(row.tvl_usd)),
        kv('TVL change, 7 days', fmtPct(row.change_7d)),
        kv('Chains', row.chains.join(', ') || '—', true),
        kv('Tracked since', row.listed_at || 'not recorded', true),
        kv('Age at snapshot', row.age_days === null ? 'not recorded' : row.age_days.toLocaleString('en-US') + ' days (' + fmtAge(row.age_days) + ')'),
        kv('Token', 'none recorded (no market cap, no CoinGecko id, no symbol)', true),
      ]),
    ]);

    var check = recompute(row);
    var value = el('div', { class: 'card' }, [
      el('h3', { text: 'Why this value — model ' + DATA.model_version }),
      el('table', { class: 'kv' }, [
        kv('TVL', fmtFull(row.tvl_usd)),
        kv('Peer multiple (' + row.multiple_scope + ', ' + row.multiple_peers + ' live peers)', fmtFactor(row.multiple)),
        kv('Momentum (7d ' + fmtPct(row.momentum_pct) + ')', fmtFactor(row.momentum_factor)),
        kv('Endurance (age ' + (row.age_days === null ? 'unrecorded' : row.age_days + ' d') + ')', fmtFactor(row.endurance_factor)),
        el('tr', { class: 'total' }, [el('th', { text: 'Implied value' }), el('td', { text: fmtFull(row.implied_value_usd) })]),
      ]),
      el('p', { class: 'agree' }, [
        document.createTextNode('This page recomputes the row from its own figures: '),
        el('strong', { text: fmtFull(check) }),
        document.createTextNode(check === row.implied_value_usd ? ' — the same number board.json carries.' : ' — which differs from the board: the data would be stale.'),
      ]),
    ]);

    var plan = el('div', { class: 'card' }, [
      el('h3', { text: 'How to farm it' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) { return el('li', { text: s }); })),
    ]);

    app.appendChild(el('div', { class: 'grid' }, [
      el('div', null, [record, el('div', { style: 'height:16px' }), value]),
      plan,
    ]));
  }

  /* ---------- already trading ---------- */

  function renderLive() {
    app.textContent = '';
    app.appendChild(el('div', { class: 'prose' }, [
      el('h2', { text: 'Already trading — set aside, and used as the yardstick' }),
      el('p', { text: 'These protocols record a token, so the radar never ranks them: the market has already priced them. They are not decoration — the board\'s peer multiples are the median market-cap / TVL of the live protocols in each category, computed from this same snapshot. The ' + DATA.global_anchor.peers + ' live protocols with a recorded market cap set the all-market median at ' + DATA.global_anchor.multiple.toFixed(4) + '× TVL.' }),
    ]));
    var table = el('table', { class: 'board' });
    table.appendChild(el('thead', null, [el('tr', null, [
      el('th', { text: 'Protocol' }),
      el('th', { text: 'Symbol' }),
      el('th', { class: 'hide-s', text: 'Category' }),
      el('th', { class: 'num', text: 'TVL' }),
      el('th', { class: 'num', text: 'Market cap' }),
      el('th', { class: 'num', text: 'Mcap / TVL' }),
      el('th', { class: 'num', text: '7d' }),
    ])]));
    var body = el('tbody');
    DATA.live.forEach(function (r) {
      body.appendChild(el('tr', { style: 'cursor:default' }, [
        el('td', { class: 'name' }, [document.createTextNode(r.name), el('span', { class: 'slug', text: r.slug })]),
        el('td', { text: r.symbol || '—' }),
        el('td', { class: 'hide-s', text: r.category || '—' }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_usd !== null && r.tvl_usd > 0 ? (r.mcap_usd / r.tvl_usd).toFixed(2) + '×' : '—' }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
      ]));
    });
    table.appendChild(body);
    app.appendChild(table);
  }

  /* ---------- the model ---------- */

  function renderModel() {
    var m = DATA.model;
    app.textContent = '';
    var prose = el('div', { class: 'prose' });
    prose.appendChild(el('h2', { text: 'The model — ' + DATA.model_version }));
    prose.appendChild(el('p', { text: 'One function scores every protocol on the board. No name is special-cased, no row is hand-picked, and every input is a figure the snapshot itself carries: TVL, the seven-day TVL change, the listing date, the category, and the market caps of the protocols that already trade.' }));
    prose.appendChild(el('div', { class: 'formula-big', text: 'implied value = TVL × peer multiple × momentum × endurance' }));
    var list = el('ul');
    [
      ['Peer multiple. ', 'For the protocol\'s category, the median market-cap / TVL ratio across the snapshot\'s live-token protocols in that category, when at least ' + m.min_peers + ' such peers record a market cap; otherwise the all-market median. Clamped to ' + m.mult_floor + '×–' + m.mult_cap + '×. It answers: what does the market pay today for one TVL dollar of this kind of protocol?'],
      ['Momentum. ', '1 + clamp(7d change, ' + m.momentum_floor + '%, +' + m.momentum_cap + '%) × ' + m.momentum_weight + '. Growth into a launch compounds; a shrinking protocol is discounted. An unreported change scores neutral.'],
      ['Endurance. ', m.endurance_floor + ' + ' + m.endurance_range + ' × min(age, ' + m.endurance_days + ' days) / ' + m.endurance_days + '. The longer a protocol has run at size with no token, the more record a launch price can stand on. An unrecorded listing date scores ' + m.unknown_endurance + '.'],
    ].forEach(function (pair) {
      list.appendChild(el('li', null, [el('strong', { text: pair[0] }), document.createTextNode(pair[1])]));
    });
    prose.appendChild(list);
    prose.appendChild(el('h3', { text: 'Who is ranked, who is not' }));
    prose.appendChild(el('p', { text: 'The board covers every protocol on the snapshot\'s watchlist and every other protocol that records no token and is not a product of one that trades: wrapped, staked, bridged and versioned products, and exchanges, are never ranked — a wrapped bitcoin is bitcoin, not a launch. Protocols whose token already trades are set aside on the Already trading page and used only as the yardstick. The watchlist is a floor, never a ceiling: ' + (DATA.counts.board - DATA.counts.watchlist) + ' of this board\'s ' + DATA.counts.board + ' rows sit outside it.' }));
    prose.appendChild(el('h3', { text: 'The peer anchors in this snapshot' }));
    app.appendChild(prose);
    var table = el('table', { class: 'anchors' });
    table.appendChild(el('thead', null, [el('tr', null, [
      el('th', { text: 'Category' }), el('th', { class: 'num', text: 'Live peers' }), el('th', { class: 'num', text: 'Median mcap / TVL' }),
    ])]));
    var body = el('tbody');
    DATA.anchors.forEach(function (a) {
      body.appendChild(el('tr', null, [
        el('td', { text: a.category }),
        el('td', { class: 'num', text: String(a.peers) }),
        el('td', { class: 'num', text: a.multiple.toFixed(4) + '×' }),
      ]));
    });
    body.appendChild(el('tr', null, [
      el('td', null, [el('strong', { text: 'All categories (fallback)' })]),
      el('td', { class: 'num', text: String(DATA.global_anchor.peers) }),
      el('td', { class: 'num', text: DATA.global_anchor.multiple.toFixed(4) + '×' }),
    ]));
    table.appendChild(body);
    app.appendChild(table);
    app.appendChild(el('div', { class: 'prose' }, [
      el('p', { text: 'Categories with fewer than ' + m.min_peers + ' live peers fall back to the all-market median, so a thin category cannot set its own price. Source: ' + DATA.source + ', as of ' + DATA.as_of + '.' }),
    ]));
  }

  /* ---------- go ---------- */

  renderMeta();
  window.addEventListener('hashchange', route);
  route();
})();
