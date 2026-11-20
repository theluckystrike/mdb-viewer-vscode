'use strict';
// Extension tests with the vscode stub: listing, activation, the viewer's messages (tables, rows, sort, filter, cells,
// copy, password, broken files), the four Pro tools with 1 free try each (the use on file B after file A opens the Pro
// panel; a reload keeps the count), the trial setting, README and support links.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadExtension, tmpDir, cleanup } = require('./support/vscode-stub');
const { editorHtml, panelHtml } = require('../src/html');

const ROOT = path.join(__dirname, '..');
const SAMPLES = path.join(ROOT, 'samples');
const FIX = path.join(__dirname, 'fixtures');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = f(); if (v) return v; await tick(10); } return f(); };
test.after(() => cleanup());

function fakePanel() {
  let onMsg;
  const posted = [];
  return {
    posted, viewColumn: 1, active: true,
    webview: { options: {}, html: '', cspSource: 'vscode-resource:', asWebviewUri: (u) => u, postMessage: async (m) => { posted.push(m); return true; }, onDidReceiveMessage: (f) => { onMsg = f; return { dispose() {} }; } },
    onDidChangeViewState: () => ({ dispose() {} }), onDidDispose: () => ({ dispose() {} }), reveal() {},
    send: (m) => onMsg(m),
  };
}

const activated = [];
/** Activates with a fresh stub. state: entries to put into globalState first (a "reload" of the window). */
function activate(folder, state) {
  const s = loadExtension();
  if (folder) s.vscode.workspace.workspaceFolders = [{ uri: s.vscode.Uri.file(folder), name: 'ws' }];
  if (state) for (const [k, v] of state) s.state.set(k, v);
  s.api = s.ext.activate(s.context);
  activated.push(s);
  // tool panels answer "show" with "shown" like the real panel does after drawing
  s.log.onPost = (panel, m) => { if (m.type === 'show' && m.html) panel.send({ type: 'shown' }); };
  s.opened = [];
  s.commands.set('vscode.openWith', async (uri, viewType) => { s.opened.push([uri.fsPath, viewType]); return undefined; });
  return s;
}
test.after(() => { for (const s of activated) s.api.provider.dispose(); });

async function openEditor(s, file) {
  const prov = s.api.provider;
  const handle = await prov.openCustomDocument(s.vscode.Uri.file(file));
  const panel = fakePanel();
  await prov.resolveCustomEditor(handle, panel);
  await panel.send({ type: 'ready' });
  const init = panel.posted.find((m) => m.type === 'init');
  if (init && init.kind === 'db') await panel.send({ type: 'rendered', tables: init.tables.length });
  prov.active = handle._doc; prov.activePanel = panel;
  return { prov, handle, panel, doc: handle._doc, init };
}
const last = (panel, type) => [...panel.posted].reverse().find((m) => m.type === type);
function ws() {
  const dir = tmpDir('mdb-ws-');
  for (const f of fs.readdirSync(SAMPLES)) fs.copyFileSync(path.join(SAMPLES, f), path.join(dir, f));
  for (const f of fs.readdirSync(FIX)) fs.copyFileSync(path.join(FIX, f), path.join(dir, f));
  fs.copyFileSync(path.join(SAMPLES, 'zovo-demo-shop.mdb'), path.join(dir, 'SHOP.MDB'));
  fs.writeFileSync(path.join(dir, 'cut.accdb'), fs.readFileSync(path.join(SAMPLES, 'zovo-demo-shop.accdb')).subarray(0, 3000));
  fs.writeFileSync(path.join(dir, 'empty.mdb'), Buffer.alloc(0));
  fs.writeFileSync(path.join(dir, 'symbols.mdb'), Buffer.from('Mono debugger symbols, not an Access file\n'.repeat(10)));
  return dir;
}
const proPanels = (s, title) => s.log.info.filter((m) => m.text === `${title} is part of Zovo Pro.`);
const U = (s, dir, f) => s.vscode.Uri.file(path.join(dir, f));

// ---------- package.json and listing ----------
test('listing: display name, description with the phrase first, 5 keywords, engines, repository, activation', () => {
  assert.equal(pkg.displayName, 'MDB Viewer & ACCDB, Access DB');
  assert.ok(pkg.displayName.length <= 30);
  assert.match(pkg.description, /^MDB viewer/);
  assert.deepEqual(pkg.keywords, ['mdb', 'accdb', 'access', 'database', 'jet']);
  assert.equal(pkg.engines.vscode, '^1.75.0');
  assert.equal(pkg.publisher, 'zovo');
  assert.equal(pkg.name, 'zovo-mdb-viewer');
  assert.equal(pkg.version, '0.1.0');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.repository.url, 'https://github.com/theluckystrike/mdb-viewer-vscode');
  assert.deepEqual(pkg.activationEvents, ['onUri']);
  assert.ok(fs.existsSync(path.join(ROOT, 'icon.png')));
});
test('editor: .mdb, .mde, .accdb and .accde by default; no language, grammar or theme', () => {
  const [ed] = pkg.contributes.customEditors;
  assert.equal(pkg.contributes.customEditors.length, 1);
  assert.equal(ed.viewType, 'mdbViewer.database');
  assert.deepEqual(ed.selector.map((s) => s.filenamePattern), ['*.mdb', '*.mde', '*.accdb', '*.accde']);
  assert.equal(ed.priority, 'default');
  assert.ok(!pkg.contributes.themes && !pkg.contributes.grammars && !pkg.contributes.languages && !pkg.contributes.configurationDefaults);
});
test('menus: one backslash before the dot; the right-click regex matches upper case; no title on menu items; wrappers hidden in the palette', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
  assert.ok(!raw.includes('\\\\\\\\.'));
  const items = Object.values(pkg.contributes.menus).flat();
  assert.ok(items.every((m) => !('title' in m)));
  const ctx = pkg.contributes.menus['explorer/context'].find((m) => m.command === 'mdbViewer.zovoPro.compare');
  const re = new RegExp(/resourceFilename =~ \/(.*)\/i/.exec(ctx.when)[1], 'i');
  for (const f of ['SHOP.MDB', 'a.accdb', 'B.ACCDB', 'app.mde', 'app.accde']) assert.ok(re.test(f), f);
  assert.ok(!re.test('a.txt') && !re.test('a.mdb.bak') && !re.test('a.laccdb') && !re.test('a.ldb'));
  const wrappers = pkg.contributes.commands.filter((c) => /\.zovoPro\./.test(c.command));
  assert.equal(wrappers.length, 4);
  assert.ok(wrappers.every((c) => c.title.startsWith('Zovo Pro: ')));
  for (const w of wrappers) assert.ok(pkg.contributes.menus.commandPalette.some((m) => m.command === w.command && m.when === 'false'));
});
test('settings: the trial kill switch zovo.mdb.trial.enabled (default true) and the listing settings', () => {
  const p = pkg.contributes.configuration.properties;
  assert.deepEqual(p['zovo.mdb.trial.enabled'], { type: 'boolean', default: true, description: 'Show the 7-day Zovo Pro trial button in the Pro panel.' });
  for (const k of ['mdbViewer.showProTools', 'mdbViewer.askForRating', 'mdbViewer.showSupportLinks', 'mdbViewer.pageSize']) assert.ok(p[k], k);
});
test('every contributed command is registered, and every registered mdbViewer command is contributed', () => {
  const s = activate();
  const contributed = pkg.contributes.commands.map((c) => c.command);
  for (const c of contributed) assert.ok(s.commands.has(c), c);
  for (const c of s.commands.keys()) if (c.startsWith('mdbViewer.')) assert.ok(contributed.includes(c), c);
});
test('activation shows nothing: no message, no panel, no editor', () => {
  const s = activate();
  assert.equal(s.log.info.length + s.log.warn.length + s.log.error.length, 0);
  assert.equal(s.log.panel, undefined);
  assert.equal(s.opened.length, 0);
});

// ---------- the viewer ----------
test('viewer: the ACCDB sample sends the tables, columns, system tables and facts; rating success once after it rendered', async () => {
  const dir = ws();
  const s = activate(dir);
  const { init, panel } = await openEditor(s, path.join(dir, 'zovo-demo-shop.accdb'));
  assert.equal(init.kind, 'db');
  assert.deepEqual(init.tables.map((t) => `${t.name} ${t.rows}`), ['Customers 48', 'OrderLines 600', 'Orders 240', 'Products 20', 'Shippers 3']);
  assert.equal(init.tables[0].columns[0].typeName, 'AutoNumber (Long Integer)');
  assert.ok(init.system.some((t) => t.name === 'MSysObjects'));
  assert.equal(init.facts.engine, 'ACE 14 (Access 2010)');
  await panel.send({ type: 'rendered', tables: 5 });
  assert.equal(s.api.pro.license.opensCount(), 1); // counted once per file, no name kept
  assert.equal(s.log.info.length + s.log.error.length, 0);
});
test('viewer: rows page by page, sorted and filtered; cell detail; copy cell and row to the clipboard', async () => {
  const dir = ws();
  const s = activate(dir);
  const { panel, doc } = await openEditor(s, path.join(dir, 'zovo-demo-shop.mdb'));
  await panel.send({ type: 'rows', seq: 1, name: 'Orders', offset: 0, limit: 100 });
  let r = last(panel, 'rows');
  assert.equal(r.seq, 1);
  assert.equal(r.total, 240);
  assert.equal(r.rows.length, 100);
  assert.equal(doc.selected, 'Orders');
  await panel.send({ type: 'rows', seq: 2, name: 'Orders', offset: 200, limit: 100 });
  r = last(panel, 'rows');
  assert.equal(r.rows.length, 40);
  assert.equal(r.rows[0].cells[0], '201');
  await panel.send({ type: 'rows', seq: 3, name: 'Orders', offset: 0, limit: 50, sort: 5, desc: true });
  r = last(panel, 'rows');
  const totals = r.rows.map((x) => Number(x.cells[5]));
  assert.deepEqual(totals, [...totals].sort((a, b) => b - a));
  await panel.send({ type: 'rows', seq: 4, name: 'Orders', offset: 0, limit: 100, filter: 'Returned', col: 4 });
  r = last(panel, 'rows');
  assert.ok(r.shown > 10 && r.shown < 240 && r.rows.every((x) => x.cells[4] === 'Returned'));
  await panel.send({ type: 'rows', seq: 5, name: 'Customers', offset: 0, limit: 100 });
  r = last(panel, 'rows');
  await panel.send({ type: 'cell', name: 'Customers', i: r.rows[0].i, c: 7 });
  const cell = last(panel, 'cell');
  assert.equal(cell.column, 'Notes');
  assert.match(cell.text, /^Prefers delivery before noon\.\nCall ahead/);
  await panel.send({ type: 'copy', name: 'Customers', i: r.rows[0].i, c: 1, what: 'cell' });
  assert.equal(s.log.clipboard, 'Ana Silva');
  await panel.send({ type: 'copy', name: 'Customers', i: r.rows[0].i, what: 'row' });
  assert.match(s.log.clipboard, /^1\tAna Silva\tLisbon\tPortugal\tana\.silva@example\.com\t2019-01-01\tNo\tPrefers delivery before noon\. Call ahead/);
});
test('viewer: a password file shows a note; Enter Password with the right password opens it, a wrong one says so', async () => {
  const dir = ws();
  const s = activate(dir);
  const { panel, init } = await openEditor(s, path.join(dir, 'V2003_with-password.mdb'));
  assert.equal(init.kind, 'password');
  assert.match(init.error, /protected with a password/);
  s.ui.input.push('wrong');
  await panel.send({ type: 'password' });
  assert.equal(last(panel, 'init').kind, 'badpassword');
  s.ui.input.push('password');
  await panel.send({ type: 'password' });
  const ok = last(panel, 'init');
  assert.equal(ok.kind, 'db');
  assert.equal(ok.tables[0].rows, 3);
  assert.equal(s.log.error.length, 0);
});
test('viewer: not an Access file, empty and cut files give plain notes, no error message, and no tab is reopened by itself', async () => {
  const dir = ws();
  const s = activate(dir);
  for (const [f, kind, re] of [['symbols.mdb', 'notaccess', /not a Microsoft Access database/], ['empty.mdb', 'empty', /This file is empty\./], ['cut.accdb', 'cut', /cut off/]]) {
    const { init } = await openEditor(s, path.join(dir, f));
    assert.equal(init.kind, kind, f);
    assert.match(init.error, re, f);
  }
  assert.equal(s.log.error.length + s.log.info.length, 0);
  assert.equal(s.opened.length, 0);
});
test('viewer: a table the reader cannot read is listed with its note; a complex column that fails is marked', async () => {
  const dir = ws();
  const s = activate(dir);
  let o = await openEditor(s, path.join(dir, 'unsupportedFieldsTestV2007.accdb'));
  assert.match(o.init.tables[0].error, /column type the reader does not support/);
  o = await openEditor(s, path.join(dir, 'complexDataTestV2010.accdb'));
  await o.panel.send({ type: 'rows', seq: 1, name: 'Table1', offset: 0, limit: 100 });
  const r = last(o.panel, 'rows');
  assert.equal(r.total, 4);
  assert.ok(Object.keys(r.colErrors).length >= 1);
});
test('webview HTML: strict CSP, nonce scripts, no remote URLs, no blob, worker or connect sources', () => {
  const e = editorHtml({ cspSource: 'vscode-resource:', scriptUri: 'media/viewer.js', styleUri: 'media/viewer.css', title: 'x<y', showSupportLinks: true, nonce: 'abc' });
  const p = panelHtml({ cspSource: 'vscode-resource:', scriptUri: 'media/panel.js', styleUri: 'media/viewer.css', title: 't', nonce: 'abc' });
  for (const h of [e, p]) {
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(h)[1];
    assert.match(csp, /^default-src 'none'/);
    assert.match(csp, /script-src 'nonce-abc'(;|$)/);
    assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline|connect-src|worker-src|blob:|https?:/);
    assert.ok([...h.matchAll(/<script\b[^>]*>/g)].every((m) => /nonce="abc"/.test(m[0])));
    assert.doesNotMatch(h.replace(/https:\/\/(marketplace\.visualstudio\.com|github\.com|www\.paypal\.com|open-vsx\.org)[^"]*/g, ''), /https?:\/\//);
  }
  assert.match(e, /<title>x&lt;y<\/title>/);
});
test('media scripts load nothing remote, open no connection, and put cell text in with textContent', () => {
  for (const f of ['viewer.js', 'panel.js']) {
    const t = fs.readFileSync(path.join(ROOT, 'media', f), 'utf8');
    assert.doesNotMatch(t, /fetch\(|XMLHttpRequest|WebSocket|new Worker|importScripts|https?:\/\/|eval\(/, f);
  }
  const v = fs.readFileSync(path.join(ROOT, 'media', 'viewer.js'), 'utf8');
  assert.deepEqual(v.match(/innerHTML/g), ['innerHTML', 'innerHTML']); // only the footer template copy
});
test('no source file opens a network connection', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(ROOT, 'src')).filter((x) => x.endsWith('.js') && !x.includes(`${path.sep}license${path.sep}`))) {
    const t = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(t, /require\(['"](https?|net|tls|dgram|child_process)['"]\)|fetch\(/, f);
  }
  const lib = fs.readFileSync(path.join(ROOT, 'lib', 'mdb-reader.js'), 'utf8');
  assert.doesNotMatch(lib, /require\(["'](node:)?(https?|net|tls|dgram|child_process)["']\)/);
});

// ---------- Pro 1: Export to CSV and JSON ----------
test('Pro Export: all tables as CSV into a folder; the result panel lists the files; try counted after it showed', async () => {
  const dir = ws();
  const s = activate(dir);
  const out = path.join(dir, 'shop-csv');
  s.ui.quick.push((items) => items.find((i) => i.id === 'allCsv'));
  s.ui.save.push(s.vscode.Uri.file(out));
  const r = await s.api.tools.exportData(U(s, dir, 'zovo-demo-shop.accdb'));
  assert.deepEqual(fs.readdirSync(out).sort(), ['Customers.csv', 'OrderLines.csv', 'Orders.csv', 'Products.csv', 'Shippers.csv']);
  assert.equal(fs.readFileSync(path.join(out, 'Orders.csv'), 'utf8').split('\r\n').filter(Boolean).length, 241);
  assert.equal(r.files.length, 5);
  assert.equal(s.log.panel.title, 'Export: zovo-demo-shop.accdb');
  await until(() => s.api.pro.left('exportData') === 0);
  assert.equal(s.api.pro.left('exportData'), 0);
  assert.match(s.log.status.join('\n'), /free try 1 of 1 of "Export to CSV and JSON" used/);
});
test('Pro Export: the open table as JSON (the table chosen in the viewer)', async () => {
  const dir = ws();
  const s = activate(dir);
  const { panel } = await openEditor(s, path.join(dir, 'zovo-demo-shop.mdb'));
  await panel.send({ type: 'rows', seq: 1, name: 'Shippers', offset: 0, limit: 100 });
  s.ui.quick.push((items) => items.find((i) => i.id === 'tableJson'));
  s.ui.save.push(U(s, dir, 'shippers.json'));
  await s.api.tools.exportData();
  const rows = JSON.parse(fs.readFileSync(path.join(dir, 'shippers.json'), 'utf8'));
  assert.deepEqual(rows.map((x) => x.ShipperName), ['Swift Parcel', 'Blue Van Freight', 'North Courier']);
});
test('Pro Export A then B: after the export of file A, the export of file B opens the Pro panel; Escape used no try', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.quick.push(undefined); // Escape at the pick
  assert.equal(await s.api.tools.exportData(U(s, dir, 'zovo-demo-shop.accdb')), undefined);
  s.ui.quick.push((items) => items.find((i) => i.id === 'allJson'));
  s.ui.save.push(undefined); // Cancel at the save dialog
  assert.equal(await s.api.tools.exportData(U(s, dir, 'zovo-demo-shop.accdb')), undefined);
  assert.equal(s.api.pro.left('exportData'), 1);
  await s.api.tools.exportData(U(s, dir, 'zovo-demo-shop.accdb'), { scope: 'allJson', dest: U(s, dir, 'a.json') });
  await until(() => s.api.pro.left('exportData') === 0);
  assert.ok(fs.existsSync(path.join(dir, 'a.json')));
  const r = await s.api.tools.exportData(U(s, dir, 'SHOP.MDB'), { scope: 'allJson', dest: U(s, dir, 'b.json') });
  assert.equal(r, undefined);
  assert.equal(proPanels(s, 'Export to CSV and JSON').length, 1);
  assert.ok(!fs.existsSync(path.join(dir, 'b.json')));
});

// ---------- Pro 2: Export to SQLite ----------
test('Pro SQLite: every table into one .db, counts read back in the result panel; try counted after it showed', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.save.push(U(s, dir, 'shop.db'));
  const r = await s.api.tools.exportSqlite(U(s, dir, 'zovo-demo-shop.accdb'));
  assert.deepEqual(r.check, [{ name: 'Customers', rows: 48 }, { name: 'OrderLines', rows: 600 }, { name: 'Orders', rows: 240 }, { name: 'Products', rows: 20 }, { name: 'Shippers', rows: 3 }]);
  assert.equal(fs.readFileSync(path.join(dir, 'shop.db')).subarray(0, 15).toString(), 'SQLite format 3');
  const show = s.log.panel.posted.find((m) => m.type === 'show');
  assert.match(show.html, /<b id="nCheck">OK<\/b>/);
  await until(() => s.api.pro.left('exportSqlite') === 0);
  assert.equal(s.api.pro.left('exportSqlite'), 0);
});
test('Pro SQLite A then B: after file A, file B opens the Pro panel and writes nothing', async () => {
  const dir = ws();
  const s = activate(dir);
  await s.api.tools.exportSqlite(U(s, dir, 'zovo-demo-shop.mdb'), { dest: U(s, dir, 'a.db') });
  await until(() => s.api.pro.left('exportSqlite') === 0);
  const r = await s.api.tools.exportSqlite(U(s, dir, 'attachments.accdb'), { dest: U(s, dir, 'b.db') });
  assert.equal(r, undefined);
  assert.equal(proPanels(s, 'Export to SQLite').length, 1);
  assert.ok(!fs.existsSync(path.join(dir, 'b.db')));
});

// ---------- Pro 3: Schema as SQL ----------
test('Pro Schema as SQL: the dialect pick, the .sql file written and opened; try counted after it opened', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.quick.push((items) => items.find((i) => i.id === 'postgres'));
  s.ui.save.push(U(s, dir, 'shop.postgres.sql'));
  const r = await s.api.tools.schemaSql(U(s, dir, 'zovo-demo-shop.accdb'));
  assert.equal(r.tables, 5);
  const sql = fs.readFileSync(path.join(dir, 'shop.postgres.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE "Orders" \(\n {2}"OrderID" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,/);
  assert.ok(s.log.opened.some((d) => d.uri && d.uri.fsPath === path.join(dir, 'shop.postgres.sql')));
  assert.equal(s.api.pro.left('schemaSql'), 0);
  assert.deepEqual(s.log.lastPick.items.map((i) => i.label), ['SQLite', 'PostgreSQL', 'MySQL', 'SQL Server']);
  assert.equal(s.log.lastPick.opts.ignoreFocusOut, true);
});
test('Pro Schema as SQL A then B: after file A, file B opens the Pro panel; the pick is not shown', async () => {
  const dir = ws();
  const s = activate(dir);
  await s.api.tools.schemaSql(U(s, dir, 'zovo-demo-shop.accdb'), { dialect: 'mysql', dest: U(s, dir, 'a.sql') });
  assert.equal(s.api.pro.left('schemaSql'), 0);
  s.log.lastPick = null;
  const r = await s.api.tools.schemaSql(U(s, dir, 'jet3-test.mdb'));
  assert.equal(r, undefined);
  assert.equal(proPanels(s, 'Schema as SQL').length, 1);
  assert.equal(s.log.lastPick, null);
});

// ---------- Pro 4: Compare ----------
test('Pro Compare: A with B (picked from the workspace); report; Markdown saved; try counted after the report showed', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.quick.push((items) => items.find((i) => i.label === 'zovo-demo-shop-v2.accdb'));
  const r = await s.api.tools.compare(U(s, dir, 'zovo-demo-shop.accdb'));
  assert.deepEqual(r.onlyA.map((t) => t.name), ['Shippers']);
  assert.deepEqual(r.onlyB.map((t) => t.name), ['Suppliers']);
  const show = s.log.panel.posted.find((m) => m.type === 'show');
  assert.match(show.html, /<b id="nOnlyA">1<\/b>/);
  assert.match(show.html, /<td><code>Customers<\/code><\/td><td class="num">48<\/td><td class="num">52<\/td><td class="num">\+4<\/td><td><\/td><td>Phone<\/td>/);
  await until(() => s.api.pro.left('compare') === 0);
  s.ui.save.push(U(s, dir, 'cmp.md'));
  await s.log.panel.send({ type: 'action', id: 'md' });
  await until(() => fs.existsSync(path.join(dir, 'cmp.md')));
  assert.match(fs.readFileSync(path.join(dir, 'cmp.md'), 'utf8'), /## Tables only in B \(1\)\n\n- `Suppliers` \(2 rows\)/);
});
test('Pro Compare A then B: after one comparison, comparing another pair opens the Pro panel; Escape in the pick used no try', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.quick.push(undefined);
  assert.equal(await s.api.tools.compare(U(s, dir, 'zovo-demo-shop.accdb')), undefined);
  assert.equal(s.api.pro.left('compare'), 1);
  await s.api.tools.compare(U(s, dir, 'zovo-demo-shop.accdb'), { other: U(s, dir, 'zovo-demo-shop-v2.accdb') });
  await until(() => s.api.pro.left('compare') === 0);
  const r = await s.api.tools.compare(U(s, dir, 'SHOP.MDB'), { other: U(s, dir, 'jet3-test.mdb') });
  assert.equal(r, undefined);
  assert.equal(proPanels(s, 'Compare two Access files').length, 1);
  assert.equal(s.log.panel.posted.filter((m) => m.type === 'show').length, 1);
});
test('Pro tools on a password file ask for the password; Escape there uses no try', async () => {
  const dir = ws();
  const s = activate(dir);
  s.ui.input.push(undefined);
  assert.equal(await s.api.tools.schemaSql(U(s, dir, 'V2003_with-password.mdb'), { dialect: 'sqlite', dest: U(s, dir, 'p.sql') }), undefined);
  assert.equal(s.api.pro.left('schemaSql'), 1);
  s.ui.input.push('password');
  const r = await s.api.tools.schemaSql(U(s, dir, 'V2003_with-password.mdb'), { dialect: 'sqlite', dest: U(s, dir, 'p.sql') });
  assert.equal(r.tables, 1);
});

// ---------- tries across tools, reloads and the panel ----------
test('a window reload keeps the counts: after a reload every used tool opens the Pro panel', async () => {
  const dir = ws();
  const s = activate(dir);
  await s.api.tools.schemaSql(U(s, dir, 'zovo-demo-shop.accdb'), { dialect: 'sqlite', dest: U(s, dir, 'a.sql') });
  await s.api.tools.compare(U(s, dir, 'zovo-demo-shop.accdb'), { other: U(s, dir, 'zovo-demo-shop-v2.accdb') });
  await until(() => s.api.pro.left('compare') === 0);
  const s2 = activate(dir, s.state);
  assert.deepEqual(s2.api.pro.tries(), { exportData: 1, exportSqlite: 1, schemaSql: 0, compare: 0 });
  assert.equal(await s2.api.tools.schemaSql(U(s2, dir, 'SHOP.MDB'), { dialect: 'sqlite', dest: U(s2, dir, 'b.sql') }), undefined);
  assert.equal(proPanels(s2, 'Schema as SQL').length, 1);
  assert.equal(await s2.api.tools.compare(U(s2, dir, 'SHOP.MDB'), { other: U(s2, dir, 'zovo-demo-shop.accdb') }), undefined);
  assert.equal(proPanels(s2, 'Compare two Access files').length, 1);
});
test('the Pro panel names the other tools with their tries and no URL is opened when it is cancelled', async () => {
  const dir = ws();
  const s = activate(dir);
  await s.api.tools.schemaSql(U(s, dir, 'zovo-demo-shop.accdb'), { dialect: 'sqlite', dest: U(s, dir, 'a.sql') });
  await s.api.tools.schemaSql(U(s, dir, 'zovo-demo-shop.mdb'), { dialect: 'sqlite', dest: U(s, dir, 'b.sql') });
  const p = proPanels(s, 'Schema as SQL')[0];
  assert.ok(p && p.opts.modal);
  assert.match(p.opts.detail, /You used the free try of Schema as SQL on this computer\./);
  assert.match(p.opts.detail, /Export to CSV and JSON: 0 of 1 free try used/);
  assert.match(p.opts.detail, /Compare two Access files: 0 of 1 free try used/);
  assert.equal(s.log.external.length, 0);
});
test('the Explorer entry runs the tool on the clicked file (upper-case extension too)', async () => {
  const dir = ws();
  const s = activate(dir);
  const r = await s.vscode.commands.executeCommand('mdbViewer.zovoPro.exportSqlite', U(s, dir, 'SHOP.MDB'), [U(s, dir, 'SHOP.MDB')]);
  assert.equal(r, undefined); // the save dialog was cancelled (no answer queued)
  s.ui.save.push(U(s, dir, 'SHOP.db'));
  const r2 = await s.vscode.commands.executeCommand('mdbViewer.zovoPro.exportSqlite', U(s, dir, 'SHOP.MDB'), [U(s, dir, 'SHOP.MDB')]);
  assert.equal(r2.tables.length, 5);
  assert.equal(s.log.panel.title, 'Export to SQLite: SHOP.MDB');
});
test('the toolbar row lists the 4 Pro tools with 1 free try each; one constant; the proinfo tries key matches', () => {
  const s = activate();
  const reachCfg = require('../src/reach-config');
  const ids = ['exportData', 'exportSqlite', 'schemaSql', 'compare'];
  assert.deepEqual(reachCfg.tools.map((t) => t.id), ids);
  const pro = require('../src/pro');
  assert.equal(pro.TRIES, 1);
  const cfg = require('../src/license/config');
  assert.equal(cfg.listing, 'mdb');
  assert.equal(cfg.pro_info.triesKey, pro.TRIAL_KEY);
  assert.equal(reachCfg.triesKey, pro.TRIAL_KEY);
  assert.equal(cfg.pro_info.triesMax, undefined);
  assert.deepEqual(cfg.pro_info.tools.map((t) => t.id), ids);
  assert.deepEqual(cfg.pro_info.tools.map((t) => t.title), Object.values(pro.FEATURES).map((f) => f.title));
  assert.deepEqual(Object.keys(s.api.pro.tries()), ids);
  const row = s.api.provider.hooks.reach().rowHtml();
  assert.equal((row.match(/<small>1 free try<\/small>/g) || []).length, 4);
  assert.match(row, /Get Zovo Pro/);
});

// ---------- README and text ----------
test('README: first screen has the main use, a screenshot of this product, the free list and the price; by Zovo; no rival names', () => {
  const md = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const first = md.split('\n').slice(0, 30).join('\n');
  assert.match(first, /^# MDB Viewer & ACCDB, Access DB/);
  assert.match(first, /\(images\/screenshot\.png\)/);
  assert.match(first, /Zovo Pro: USD 19 once/);
  assert.match(md, /by Zovo/i);
  for (const f of ['README.md', 'CHANGELOG.md', 'package.json', 'walkthrough/schema.md', 'walkthrough/related.md', 'src/core/access.js', 'src/core/values.js', 'src/core/convert.js', 'src/editor.js', 'src/tools.js', 'src/extension.js', 'media/viewer.js', 'media/panel.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /luna-soft|access-explorer|dbconvert|pinglewareapps|tabulens|mdbtools|jackcess|UCanAccess/i, f);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'images', 'screenshot.png')));
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8'), /^images\/?(\*\*|\*\.png|screenshot)?\s*$/m);
});
test('support links name this listing and related Zovo tools; walkthrough links only to live listings', () => {
  const support = require('../src/support');
  assert.equal(support.SELF_ID, 'zovo.zovo-mdb-viewer');
  assert.ok(support.RELATED.length >= 3 && !support.RELATED.includes(support.SELF_ID));
  assert.equal(support.PRO.getPro, 'mdbViewer.getPro');
  const steps = pkg.contributes.walkthroughs[0].steps;
  const links = steps.flatMap((st) => [...st.description.matchAll(/command:extension\.open\?%5B%22([^%]+)%22%5D/g)].map((m) => m[1]));
  assert.deepEqual(links, ['zovo.sqlite-table-viewer', 'zovo.table-viewer-vscode', 'zovo.zovo-hex-viewer']);
  const live = new Set(support.LIVE.map((x) => x[0]));
  for (const id of links) assert.ok(live.has(id), id);
});
