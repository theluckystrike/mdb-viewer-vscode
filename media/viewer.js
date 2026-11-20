// MDB Viewer webview: table list, rows with paging, sort and filter, the selected cell, and the schema of every table.
// Data comes from the extension host one page at a time; cell text goes into the page with textContent only.
// This page makes no network request (CSP default-src 'none').
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const fmtN = (n) => Number(n || 0).toLocaleString('en-US');
  const saved = vscode.getState() || {};
  let data = null;
  let table = null; // { name, columns, rows, error }
  let showSys = !!saved.sys;
  let tab = saved.tab === 'schema' ? 'schema' : 'data';
  let view = { filter: '', col: -1, sort: -1, desc: false, offset: 0, limit: 100 };
  let page = null;
  let sel = null; // { i, c, r }
  let seq = 0;

  function footer() {
    const f = $('zovo-footer');
    if (f && !$('footer').childElementCount) $('footer').innerHTML = f.innerHTML;
  }
  function status(t) { $('statusText').textContent = t; }
  function message(nodes) {
    const m = $('msg');
    m.textContent = '';
    for (const n of nodes) m.appendChild(n);
    m.hidden = !nodes.length;
  }
  function para(text) { return el('p', '', text); }
  function button(id, label, fn) { const b = el('button', 'tb', label); b.id = id; b.onclick = fn; return b; }
  function remember() { vscode.setState({ table: table ? table.name : '', tab, sys: showSys }); }

  function init(m) {
    data = m;
    document.body.dataset.kind = m.kind;
    footer();
    $('tables').textContent = '';
    $('facts').textContent = '';
    $('schemaView').textContent = '';
    clearGrid();
    if (m.kind !== 'db') {
      document.body.dataset.state = m.kind === 'password' || m.kind === 'badpassword' ? 'password' : m.kind;
      $('fmt').textContent = m.sizeText || '';
      const parts = [para(m.error)];
      if (m.kind === 'password' || m.kind === 'badpassword') {
        parts.push(para('Type the database password to see its tables. The password is not stored.'));
        const p = el('p'); p.appendChild(button('pwBtn', 'Enter Password', () => vscode.postMessage({ type: 'password' }))); parts.push(p);
      } else if (m.hex) {
        const p = el('p'); p.appendChild(button('mHex', `Open in ${m.hex}`, () => vscode.postMessage({ type: 'openHex' }))); parts.push(p);
      }
      message(parts);
      $('dataView').hidden = true;
      $('schemaView').hidden = true;
      status(m.kind === 'password' ? 'Password needed' : '');
      return;
    }
    message([]);
    document.body.dataset.state = 'ready';
    view.limit = m.settings && m.settings.pageSize ? m.settings.pageSize : 100;
    $('pageSize').value = String(view.limit);
    const f = m.facts;
    $('fmt').textContent = `${f.format}, ${f.engine}, ${m.sizeText}`;
    facts(f);
    list();
    schema();
    const all = m.tables.concat(m.system);
    const want = (saved.table && all.find((t) => t.name === saved.table)) || (m.selected && all.find((t) => t.name === m.selected)) || m.tables.find((t) => !t.error) || m.tables[0] || null;
    // a table that cannot be read is still selected when no other is, so its note shows instead of an empty view
    if (want && (m.tables.includes(want) || showSys)) selectTable(want.name, true);
    else if (!m.tables.length) {
      message([para(m.linked.length ? 'This database has only linked tables: their rows live in other files.' : 'This database has no tables of its own.')]);
      status(`0 tables${m.system.length ? `, ${m.system.length} system tables` : ''}`);
    }
    setTab(tab);
    vscode.postMessage({ type: 'rendered', tables: m.tables.length });
  }

  function facts(f) {
    const dl = el('dl');
    const add = (k, v) => { if (v === '' || v === undefined || v === null) return; dl.appendChild(el('dt', '', k)); dl.appendChild(el('dd', '', String(v))); };
    add('Format', f.format);
    add('Engine', f.engine);
    add('Tables', `${fmtN(f.tables)} (${fmtN(f.rows)} rows)`);
    if (f.linked) add('Linked tables', fmtN(f.linked));
    add('System tables', fmtN(f.system));
    add('Page size', `${fmtN(f.pageSize)} bytes`);
    add('Created', f.created);
    if (f.password) add('Password', 'yes (typed in this window)');
    add('Access', 'Read-only. The file is never written.');
    $('facts').appendChild(el('h3', '', 'File'));
    $('facts').appendChild(dl);
  }

  function item(t, kind) {
    const d = el('div', `tbl${t.error ? ' bad' : ''}${kind ? ` ${kind}` : ''}`);
    d.setAttribute('role', 'option');
    d.dataset.name = t.name;
    d.tabIndex = 0;
    d.appendChild(el('span', 'nm', t.name));
    d.appendChild(el('span', 'rc', t.error ? '!' : fmtN(t.rows)));
    d.title = t.error || `${t.name}: ${fmtN(t.rows)} rows, ${t.columns.length} columns`;
    d.onclick = () => selectTable(t.name);
    d.onkeydown = (e) => { if (e.key === 'Enter') selectTable(t.name); };
    return d;
  }

  function list() {
    const box = $('tables');
    box.textContent = '';
    box.appendChild(el('div', 'grpHead', `Tables (${data.tables.length})`));
    for (const t of data.tables) box.appendChild(item(t, ''));
    if (data.linked.length) {
      box.appendChild(el('div', 'grpHead', `Linked tables (${data.linked.length})`));
      for (const n of data.linked) { const d = el('div', 'tbl linked'); d.appendChild(el('span', 'nm', n)); d.appendChild(el('span', 'rc', 'link')); d.title = 'A linked table: its rows live in another file.'; box.appendChild(d); }
    }
    $('sysToggle').checked = showSys;
    if (showSys) {
      box.appendChild(el('div', 'grpHead', `System tables (${data.system.length})`));
      for (const t of data.system) box.appendChild(item(t, 'sys'));
    }
    mark();
  }
  function mark() { for (const d of document.querySelectorAll('#tables .tbl')) d.classList.toggle('sel', !!table && d.dataset.name === table.name); }

  function find(name) { return data.tables.find((t) => t.name === name) || data.system.find((t) => t.name === name) || null; }

  function selectTable(name, keepTab) {
    const t = find(name);
    if (!t) return;
    table = t;
    sel = null;
    $('detail').hidden = true;
    view = { filter: '', col: -1, sort: -1, desc: false, offset: 0, limit: view.limit };
    $('filter').value = '';
    const fc = $('filterCol');
    fc.textContent = '';
    const all = el('option', '', 'All columns'); all.value = '-1'; fc.appendChild(all);
    t.columns.forEach((c, i) => { const o = el('option', '', c.name); o.value = String(i); fc.appendChild(o); });
    mark();
    remember();
    vscode.postMessage({ type: 'select', name });
    if (t.error) {
      clearGrid();
      message([para(t.error)]);
      status(`${t.name}: not readable`);
      return;
    }
    message([]);
    if (tab !== 'data' && !keepTab) setTab('data');
    request();
  }

  function request() {
    if (!table) return;
    seq++;
    document.body.dataset.loading = '1';
    vscode.postMessage({ type: 'rows', seq, name: table.name, filter: view.filter, col: view.col, sort: view.sort, desc: view.desc, offset: view.offset, limit: view.limit });
  }

  function clearGrid() { $('grid').tHead.textContent = ''; $('grid').tBodies[0].textContent = ''; $('pageInfo').textContent = ''; $('count').textContent = ''; }

  function rows(m) {
    if (!table || m.name !== table.name || m.seq !== seq) return;
    delete document.body.dataset.loading;
    page = m;
    const g = $('grid');
    const head = g.tHead; head.textContent = '';
    const tr = el('tr');
    const num = el('th', 'rn', '#'); tr.appendChild(num);
    table.columns.forEach((c, i) => {
      const th = el('th', 'col');
      th.dataset.c = String(i);
      th.appendChild(el('span', 'cn', c.name));
      th.appendChild(el('span', 'ty', c.typeName));
      if (m.colErrors && Object.prototype.hasOwnProperty.call(m.colErrors, c.name) && m.colErrors[c.name]) { th.classList.add('bad'); th.title = m.colErrors[c.name]; } else th.title = `${c.name}: ${c.typeName}. Click to sort.`;
      if (view.sort === i) th.dataset.dir = view.desc ? 'desc' : 'asc';
      th.onclick = () => { if (view.sort === i) { if (view.desc) { view.sort = -1; view.desc = false; } else view.desc = true; } else { view.sort = i; view.desc = false; } view.offset = 0; request(); };
      tr.appendChild(th);
    });
    head.appendChild(tr);
    const body = g.tBodies[0]; body.textContent = '';
    const frag = document.createDocumentFragment();
    m.rows.forEach((r, k) => {
      const row = el('tr');
      row.dataset.i = String(r.i);
      row.appendChild(el('td', 'rn', String(m.offset + k + 1)));
      r.cells.forEach((v, c) => {
        const td = el('td', v === null ? 'null' : '', v === null ? '' : v);
        td.dataset.c = String(c);
        if (sel && sel.i === r.i && sel.c === c) td.classList.add('sel');
        row.appendChild(td);
      });
      frag.appendChild(row);
    });
    body.appendChild(frag);
    const from = m.shown ? m.offset + 1 : 0, to = m.offset + m.rows.length;
    $('pageInfo').textContent = `Rows ${fmtN(from)} to ${fmtN(to)} of ${fmtN(m.shown)}${m.shown !== m.total ? ` (filtered from ${fmtN(m.total)})` : ''}`;
    $('count').textContent = view.filter ? `${fmtN(m.shown)} ${m.shown === 1 ? 'match' : 'matches'}` : '';
    $('first').disabled = $('prev').disabled = m.offset <= 0;
    $('next').disabled = $('last').disabled = m.offset + m.limit >= m.shown;
    status(`${table.name}: ${fmtN(m.total)} ${m.total === 1 ? 'row' : 'rows'}, ${table.columns.length} ${table.columns.length === 1 ? 'column' : 'columns'}${view.sort >= 0 ? `, sorted by ${table.columns[view.sort].name}${view.desc ? ' (descending)' : ''}` : ''}`);
    document.body.dataset.table = table.name;
  }

  function selectCell(td) {
    const tr = td.parentElement;
    if (!tr || !tr.dataset.i || td.classList.contains('rn')) return;
    for (const x of document.querySelectorAll('#grid td.sel')) x.classList.remove('sel');
    td.classList.add('sel');
    sel = { i: Number(tr.dataset.i), c: Number(td.dataset.c) };
    vscode.postMessage({ type: 'cell', name: table.name, i: sel.i, c: sel.c });
  }

  function cell(m) {
    if (!table || m.name !== table.name || !sel || m.i !== sel.i || m.c !== sel.c) return;
    $('detail').hidden = false;
    $('dHead').textContent = `${m.column} (${m.typeName})`;
    $('dNote').textContent = m.note || '';
    $('dText').textContent = m.text;
  }

  function schema() {
    const box = $('schemaView');
    box.textContent = '';
    const tables = data.tables.concat(showSys ? data.system : []);
    box.appendChild(el('p', 'muted', `${data.tables.length} ${data.tables.length === 1 ? 'table' : 'tables'}${showSys ? ` and ${data.system.length} system tables` : ''}. Types are the Access field types.`));
    for (const t of tables) {
      const s = el('section', 'sch');
      s.dataset.name = t.name;
      const h = el('h3');
      const a = el('a', '', t.name); a.href = '#'; a.onclick = (e) => { e.preventDefault(); selectTable(t.name); };
      h.appendChild(a);
      h.appendChild(el('span', 'muted', t.error ? '  not readable' : `  ${fmtN(t.rows)} rows, ${t.columns.length} columns`));
      s.appendChild(h);
      if (t.error) { s.appendChild(el('p', 'muted', t.error)); box.appendChild(s); continue; }
      const tb = el('table', 'schema');
      const hr = el('tr'); for (const x of ['#', 'Column', 'Type', 'Required']) hr.appendChild(el('th', '', x));
      const th = el('thead'); th.appendChild(hr); tb.appendChild(th);
      const bd = el('tbody');
      t.columns.forEach((c, i) => { const r = el('tr'); r.appendChild(el('td', 'rn', String(i + 1))); r.appendChild(el('td', 'cn', c.name)); r.appendChild(el('td', '', c.typeName)); r.appendChild(el('td', '', c.nullable ? '' : 'yes')); bd.appendChild(r); });
      tb.appendChild(bd);
      s.appendChild(tb);
      box.appendChild(s);
    }
  }

  function setTab(t) {
    tab = t;
    $('tabData').classList.toggle('sel', t === 'data');
    $('tabSchema').classList.toggle('sel', t === 'schema');
    $('dataView').hidden = t !== 'data' || !data || data.kind !== 'db';
    $('schemaView').hidden = t !== 'schema' || !data || data.kind !== 'db';
    $('filter').disabled = $('filterCol').disabled = t !== 'data';
    document.body.dataset.tab = t;
    remember();
  }

  // ---- events ----
  $('tabData').onclick = () => setTab('data');
  $('tabSchema').onclick = () => setTab('schema');
  $('sysToggle').onchange = () => { showSys = $('sysToggle').checked; if (data && data.kind === 'db') { list(); schema(); } remember(); };
  let timer = null;
  $('filter').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { view.filter = $('filter').value; view.offset = 0; request(); }, 250); });
  $('filter').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); view.filter = $('filter').value; view.offset = 0; request(); } });
  $('filterCol').onchange = () => { view.col = Number($('filterCol').value); view.offset = 0; if (view.filter) request(); };
  $('pageSize').onchange = () => { view.limit = Number($('pageSize').value) || 100; view.offset = 0; request(); };
  $('first').onclick = () => { view.offset = 0; request(); };
  $('prev').onclick = () => { view.offset = Math.max(0, view.offset - view.limit); request(); };
  $('next').onclick = () => { if (page && view.offset + view.limit < page.shown) { view.offset += view.limit; request(); } };
  $('last').onclick = () => { if (page) { view.offset = Math.max(0, Math.floor((page.shown - 1) / view.limit) * view.limit); request(); } };
  $('grid').addEventListener('click', (e) => { const td = e.target.closest('td'); if (td) selectCell(td); });
  $('copyCell').onclick = () => { if (sel) vscode.postMessage({ type: 'copy', name: table.name, i: sel.i, c: sel.c, what: 'cell' }); };
  $('copyRow').onclick = () => { if (sel) vscode.postMessage({ type: 'copy', name: table.name, i: sel.i, what: 'row' }); };
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C') && sel && !String(window.getSelection() || '')) { e.preventDefault(); vscode.postMessage({ type: 'copy', name: table.name, i: sel.i, c: sel.c, what: 'cell' }); return; }
    if (!sel || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const cur = document.querySelector('#grid td.sel');
    if (!cur) return;
    let next = null;
    if (e.key === 'ArrowLeft') next = cur.previousElementSibling;
    else if (e.key === 'ArrowRight') next = cur.nextElementSibling;
    else { const row = e.key === 'ArrowUp' ? cur.parentElement.previousElementSibling : cur.parentElement.nextElementSibling; if (row) next = row.children[cur.cellIndex]; }
    if (next && !next.classList.contains('rn')) { e.preventDefault(); selectCell(next); next.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  });

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'init') init(m);
    else if (m.type === 'rows') rows(m);
    else if (m.type === 'cell') cell(m);
    else if (m.type === 'copied') status(`Copied ${m.what}`);
    else if (m.type === 'error') { delete document.body.dataset.loading; message([para(m.error)]); status(m.table ? `${m.table}: not readable` : 'Error'); }
  });
  vscode.postMessage({ type: 'ready' });
}());
