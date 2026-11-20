'use strict';
// The four Zovo Pro tools: Export to CSV and JSON, Export to SQLite, Schema as SQL, Compare two Access files. Each
// asks pro.allowed() on every click and calls pro.produced() only after its result is there (the result panel drawn,
// the SQL file open), so Escape, Cancel or an error never uses a free try. Everything runs on this computer; files are
// read and written through VS Code's file system API. The database file itself is never written.
const vscode = require('vscode');
const path = require('path');
const A = require('./core/access');
const C = require('./core/convert');
const { loadFile, DB_RE } = require('./editor');
const { panelHtml } = require('./html');
const support = require('./support');

const PREFIX = 'mdbViewer';
const setting = (k, d) => vscode.workspace.getConfiguration(PREFIX).get(k, d);
const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const base = (uri) => path.posix.basename(uri.path);
const stem = (uri) => base(uri).replace(/\.[^.]+$/, '');
const FILTERS = { 'Access databases': ['mdb', 'accdb', 'mde', 'accde'], 'All files': ['*'] };
const fmtN = (n) => Number(n || 0).toLocaleString('en-US');

function sibling(uri, name) { return vscode.Uri.joinPath(uri, '..', name); }
async function writeBytes(uri, bytes) { await vscode.workspace.fs.writeFile(uri, bytes instanceof Uint8Array ? bytes : Buffer.from(bytes, 'utf8')); }
const sameFile = (a, b) => a && b && a.toString() === b.toString();
const plural = (n, one, many) => `${fmtN(n)} ${n === 1 ? one : many}`;

function createTools({ context, provider, pro, reach }) {
  const panels = {};

  function openPanel(kind, title) {
    const media = vscode.Uri.joinPath(context.extensionUri, 'media');
    const old = panels[kind];
    if (old && !old.disposed) old.panel.dispose();
    const panel = vscode.window.createWebviewPanel(`${PREFIX}.${kind}`, title, { viewColumn: vscode.ViewColumn.Active, preserveFocus: false }, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media],
      enableCommandUris: (reach ? reach.commandIds() : []).concat(support.commandUris(PREFIX)),
    });
    panel.webview.html = panelHtml({
      cspSource: panel.webview.cspSource,
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.js')).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'viewer.css')).toString(),
      title, head: reach ? (n) => reach.headHtml(n) : undefined, showSupportLinks: setting('showSupportLinks', true) !== false,
    });
    if (reach) reach.attach(panel.webview, panel);
    let readyFn;
    const p = { panel, kind, disposed: false, actions: null, shown: null };
    p.ready = new Promise((r) => { readyFn = r; });
    p.post = (msg) => { try { const r = panel.webview.postMessage(msg); if (r && r.then) r.then(undefined, () => false); } catch (e) { /* disposed */ } };
    p.show = async (o) => { await p.ready; p.post({ type: 'show', ...o }); };
    panel.webview.onDidReceiveMessage(async (m) => {
      if (reach && reach.onMessage(m)) return;
      if (!m || typeof m !== 'object') return;
      try {
        if (m.type === 'ready') readyFn();
        else if (m.type === 'shown') { if (p.shown) { const f = p.shown; p.shown = null; await f(m); } }
        else if (m.type === 'action' && p.actions) await p.actions(m.id, m);
      } catch (e) { vscode.window.showErrorMessage(String((e && e.message) || e)); }
    });
    panel.onDidDispose(() => { p.disposed = true; if (panels[kind] === p) delete panels[kind]; });
    panels[kind] = p;
    return p;
  }

  /** The file a tool works on: the clicked one, else the file of the active viewer, else a dialog. */
  async function targetFile(arg, title) {
    if (arg && arg.scheme) return arg;
    if (provider.active) return provider.active.uri;
    const r = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Choose', title, filters: FILTERS });
    return r && r[0];
  }

  /**
   * The open database of uri: the viewer's own when it is open, else read now. A file with a password asks for it
   * (the password is used for this read only). Throws with a plain message when the file cannot be read.
   */
  async function dbFor(uri) {
    for (const d of provider.docs) if (d.uri.toString() === uri.toString() && d.data && d.data.kind === 'db') return { db: d.data.db, doc: d };
    let data = await loadFile(uri);
    if (data.kind === 'password') {
      const pw = await vscode.window.showInputBox({ password: true, ignoreFocusOut: true, title: `Password for ${base(uri)}`, prompt: 'The database password. It is used only for this and is not stored.' });
      if (pw === undefined) return null;
      data = await loadFile(uri, pw);
    }
    if (data.kind !== 'db') throw new Error(`${base(uri)} could not be read as an Access database: ${data.error}`);
    return { db: data.db, doc: null };
  }
  /** Rows of a table: through the viewer's cache when the file is open there. */
  const reader = (h) => (name) => (h.doc ? h.doc.table(name).table : A.readTable(h.db, name));

  async function pickOther(uriA, title) {
    const items = [];
    const seen = new Set([uriA.toString()]);
    for (const d of provider.docs) if (!seen.has(d.uri.toString()) && d.data && d.data.kind === 'db') { seen.add(d.uri.toString()); items.push({ label: d.name, description: 'open in the viewer', uri: d.uri }); }
    let files = [];
    try { files = await vscode.workspace.findFiles('**/*.{mdb,accdb,mde,accde,MDB,ACCDB,MDE,ACCDE}', '**/node_modules/**', 300); } catch (e) { files = []; }
    for (const u of files) if (!seen.has(u.toString())) { seen.add(u.toString()); items.push({ label: base(u), description: vscode.workspace.asRelativePath ? vscode.workspace.asRelativePath(u) : u.fsPath, uri: u }); }
    items.push({ label: 'Choose a file...', description: 'MDB, ACCDB, MDE or ACCDE', file: true });
    const pick = await vscode.window.showQuickPick(items, { ignoreFocusOut: true, title, placeHolder: 'The database to compare with (B)', matchOnDescription: true });
    if (!pick) return undefined;
    if (!pick.file) return pick.uri;
    const r = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Compare', title, filters: FILTERS });
    return r && r[0];
  }

  function readable(db, uri) {
    const ok = db.tables.filter((t) => !t.error);
    if (!ok.length) throw new Error(`${base(uri)} has no table that can be read${db.linked.length ? ' (its tables are linked to other files)' : ''}.`);
    return ok;
  }

  // ---------- 1. Export to CSV and JSON ----------
  async function exportData(arg, extra = {}) {
    if (!(await pro.allowed('exportData', arg))) return undefined;
    const uri = await targetFile(arg, 'Export: choose an Access database');
    if (!uri) return undefined;
    const h = await dbFor(uri);
    if (!h) return undefined;
    const ok = readable(h.db, uri);
    const current = h.doc && h.doc.selected && ok.find((t) => t.name === h.doc.selected);
    let scope = extra.scope;
    let tname = extra.table || (current && current.name) || '';
    if (!scope) {
      const items = [
        { label: 'All tables as CSV', description: `${plural(ok.length, 'file', 'files')}, one per table, in a folder`, id: 'allCsv' },
        { label: 'All tables as one JSON file', description: '.json, { tables: { name: [rows] } }', id: 'allJson' },
      ];
      if (current) {
        items.push({ label: `${current.name} as CSV`, description: `the open table, ${plural(current.rows, 'row', 'rows')}`, id: 'tableCsv' });
        items.push({ label: `${current.name} as JSON`, description: 'the open table, an array of rows', id: 'tableJson' });
      }
      const pick = await vscode.window.showQuickPick(items, { ignoreFocusOut: true, title: `Export ${base(uri)}`, placeHolder: 'Save the data as...' });
      if (!pick) return undefined;
      scope = pick.id;
    }
    const read = reader(h);
    const tables = scope === 'tableCsv' || scope === 'tableJson' ? ok.filter((t) => t.name === tname) : ok;
    if (!tables.length) throw new Error(`There is no readable table named ${tname}.`);
    let dest = extra.dest;
    const defName = scope === 'allCsv' ? `${stem(uri)}-csv` : scope === 'allJson' ? `${stem(uri)}.json` : `${stem(uri)}-${C.safeName(tables[0].name)}.${scope === 'tableCsv' ? 'csv' : 'json'}`;
    if (!dest) {
      dest = await vscode.window.showSaveDialog({
        defaultUri: sibling(uri, defName), saveLabel: scope === 'allCsv' ? 'Save Here' : 'Save',
        filters: scope === 'allCsv' ? { Folder: ['*'] } : scope.endsWith('Json') ? { JSON: ['json'] } : { CSV: ['csv'] },
        title: scope === 'allCsv' ? 'Folder for the CSV files (one file per table)' : `Save ${scope === 'allJson' ? 'all tables' : tables[0].name} as ${scope.endsWith('Json') ? 'JSON' : 'CSV'}`,
      });
    }
    if (!dest) return undefined;
    if (sameFile(dest, uri)) { vscode.window.showErrorMessage('Choose another name: the export never writes over the database it reads.'); return undefined; }
    const files = [];
    if (scope === 'allCsv') {
      await vscode.workspace.fs.createDirectory(dest);
      const fileNames = C.uniqueFileNames(tables.map((t) => t.name));
      for (const [k, t] of tables.entries()) {
        const data = read(t.name);
        const f = vscode.Uri.joinPath(dest, `${fileNames[k]}.csv`);
        const text = C.toCsv(data);
        await writeBytes(f, text);
        files.push({ uri: f, table: t.name, rows: data.rows.length, bytes: Buffer.byteLength(text) });
      }
    } else if (scope === 'allJson') {
      const text = C.toJsonDoc(base(uri), tables.map((t) => ({ name: t.name, data: read(t.name) })));
      await writeBytes(dest, text);
      files.push({ uri: dest, table: `${plural(tables.length, 'table', 'tables')}`, rows: tables.reduce((a, t) => a + t.rows, 0), bytes: Buffer.byteLength(text) });
    } else {
      const data = read(tables[0].name);
      const text = scope === 'tableCsv' ? C.toCsv(data) : C.tableJson(data);
      await writeBytes(dest, text);
      files.push({ uri: dest, table: tables[0].name, rows: data.rows.length, bytes: Buffer.byteLength(text) });
    }
    const title = `Export: ${base(uri)}`;
    const p = openPanel('exportData', title);
    const result = { scope, dest, files };
    p.result = result;
    p.shown = async () => { await pro.produced('exportData'); };
    p.actions = async (id) => {
      if (id === 'reveal') await vscode.commands.executeCommand('revealFileInOS', scope === 'allCsv' ? files[0].uri : dest);
      else if (id.startsWith('open:')) { const f = files[Number(id.slice(5))]; if (f) { const td = await vscode.workspace.openTextDocument(f.uri); await vscode.window.showTextDocument(td, { viewColumn: vscode.ViewColumn.Beside, preview: true }); } }
    };
    const totalRows = files.reduce((a, f) => a + f.rows, 0);
    const rows = files.map((f, i) => `<tr><td><a href="#" class="act" data-id="open:${i}"><code>${esc(base(f.uri))}</code></a></td><td>${esc(f.table)}</td><td class="num">${fmtN(f.rows)}</td><td class="num">${fmtN(f.bytes)}</td></tr>`).join('');
    const html = `<div class="stats"><div><b id="nFiles">${files.length}</b><span>${files.length === 1 ? 'file written' : 'files written'}</span></div><div><b id="nRows">${fmtN(totalRows)}</b><span>rows</span></div></div>
<p class="muted">Saved to <code id="dest">${esc(dest.fsPath || dest.path)}</code>. ${scope.endsWith('Csv') ? 'CSV: UTF-8, comma separated, a header line, CRLF line ends. Dates as YYYY-MM-DD HH:MM:SS, binary and OLE values as base64.' : 'JSON: dates as ISO text without a time zone (as Access stores them), binary values as { base64, bytes }.'}</p>
<table id="files" class="sort"><thead><tr><th>File</th><th>Table</th><th class="num">Rows</th><th class="num">Bytes</th></tr></thead><tbody>${rows}</tbody></table>`;
    await p.show({ title, html });
    return result;
  }

  // ---------- 2. Export to SQLite ----------
  async function exportSqlite(arg, extra = {}) {
    if (!(await pro.allowed('exportSqlite', arg))) return undefined;
    const uri = await targetFile(arg, 'Export to SQLite: choose an Access database');
    if (!uri) return undefined;
    const h = await dbFor(uri);
    if (!h) return undefined;
    readable(h.db, uri);
    const dest = extra.dest || await vscode.window.showSaveDialog({ defaultUri: sibling(uri, `${stem(uri)}.db`), filters: { 'SQLite database': ['db', 'sqlite', 'sqlite3'] }, title: `Export ${base(uri)} to SQLite` });
    if (!dest) return undefined;
    if (sameFile(dest, uri)) { vscode.window.showErrorMessage('Choose another name: the export never writes over the database it reads.'); return undefined; }
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Export to SQLite' }, () => C.toSqlite(h.db, reader(h)));
    await writeBytes(dest, r.bytes);
    const back = await C.sqliteCounts(await vscode.workspace.fs.readFile(dest));
    const count = new Map(back.map((x) => [x.name, x.rows]));
    const title = `Export to SQLite: ${base(uri)}`;
    const p = openPanel('exportSqlite', title);
    const result = { dest, tables: r.tables, skipped: r.skipped, check: back, size: r.bytes.length };
    p.result = result;
    p.shown = async () => { await pro.produced('exportSqlite'); };
    p.actions = async (id) => { if (id === 'reveal') await vscode.commands.executeCommand('revealFileInOS', dest); };
    const allOk = r.tables.every((t) => count.get(t.name) === t.rows);
    const rows = r.tables.map((t) => `<tr class="${count.get(t.name) === t.rows ? '' : 'removed'}"><td><code>${esc(t.name)}</code></td><td class="num">${fmtN(t.rows)}</td><td class="num">${fmtN(count.get(t.name))}</td><td>${count.get(t.name) === t.rows ? 'same' : 'DIFFERENT'}</td><td class="num">${t.attachments ? fmtN(t.attachments) : ''}</td></tr>`).join('');
    const html = `<div class="stats"><div><b id="nTables">${r.tables.length}</b><span>tables written</span></div><div><b id="nRows">${fmtN(r.tables.reduce((a, t) => a + t.rows, 0))}</b><span>rows</span></div><div><b id="nSize">${fmtN(r.bytes.length)}</b><span>bytes</span></div><div><b id="nCheck">${allOk ? 'OK' : 'CHECK'}</b><span>row counts read back from the new file</span></div></div>
<p class="muted">Saved to <code id="dest">${esc(dest.fsPath || dest.path)}</code>. Dates are TEXT (YYYY-MM-DD HH:MM:SS), Yes/No is 0 or 1, Currency and Decimal are NUMERIC, OLE and binary values are BLOBs. Indexes and keys are not copied.</p>
<table id="tables" class="sort"><thead><tr><th>Table</th><th class="num">Rows in Access</th><th class="num">Rows in SQLite</th><th>Check</th><th class="num">Attachments</th></tr></thead><tbody>${rows}</tbody></table>
${r.skipped.length ? `<h3>Not exported (${r.skipped.length})</h3><ul id="skipped">${r.skipped.map((s) => `<li><code>${esc(s.name)}</code>: ${esc(s.reason)}</li>`).join('')}</ul>` : ''}`;
    await p.show({ title, html });
    return result;
  }

  // ---------- 3. Schema as SQL ----------
  async function schemaSql(arg, extra = {}) {
    if (!(await pro.allowed('schemaSql', arg))) return undefined;
    const uri = await targetFile(arg, 'Schema as SQL: choose an Access database');
    if (!uri) return undefined;
    const h = await dbFor(uri);
    if (!h) return undefined;
    readable(h.db, uri);
    let dialect = extra.dialect;
    if (!dialect) {
      const items = Object.entries(C.DIALECTS).map(([id, d]) => ({ label: d.label, description: id === 'sqlite' ? 'TEXT, INTEGER, REAL, NUMERIC, BLOB' : id === 'postgres' ? 'varchar, integer identity, numeric, timestamp, bytea' : id === 'mysql' ? 'VARCHAR, INT AUTO_INCREMENT, DECIMAL, DATETIME, LONGBLOB' : 'NVARCHAR, INT IDENTITY, MONEY, DATETIME2, VARBINARY', id }));
      const pick = await vscode.window.showQuickPick(items, { ignoreFocusOut: true, title: `Schema of ${base(uri)} as SQL`, placeHolder: 'The SQL dialect of the CREATE TABLE statements' });
      if (!pick) return undefined;
      dialect = pick.id;
    }
    const text = C.toDdl(h.db, base(uri), dialect);
    const dest = extra.dest || await vscode.window.showSaveDialog({ defaultUri: sibling(uri, `${stem(uri)}.${dialect}.sql`), filters: { SQL: ['sql'] }, title: `Save the ${C.DIALECTS[dialect].label} schema` });
    if (!dest) return undefined;
    if (sameFile(dest, uri)) { vscode.window.showErrorMessage('Choose another name: the export never writes over the database it reads.'); return undefined; }
    await writeBytes(dest, text);
    const td = await vscode.workspace.openTextDocument(dest);
    await vscode.window.showTextDocument(td, { viewColumn: vscode.ViewColumn.Beside, preview: true });
    const n = (text.match(/^CREATE TABLE /gm) || []).length;
    vscode.window.setStatusBarMessage(`Saved ${base(dest)}: ${plural(n, 'CREATE TABLE statement', 'CREATE TABLE statements')} (${C.DIALECTS[dialect].label})`, 8000);
    await pro.produced('schemaSql');
    return { dest, dialect, tables: n, text };
  }

  // ---------- 4. Compare two Access files ----------
  async function compare(arg, extra = {}) {
    if (!(await pro.allowed('compare', arg))) return undefined;
    const uriA = await targetFile(arg, 'Compare: choose the first database (A)');
    if (!uriA) return undefined;
    const uriB = extra.other || await pickOther(uriA, `Compare ${base(uriA)} with...`);
    if (!uriB) return undefined;
    const ha = await dbFor(uriA);
    if (!ha) return undefined;
    const hb = await dbFor(uriB);
    if (!hb) return undefined;
    const r = C.compare(ha.db, hb.db);
    const nameA = base(uriA), nameB = base(uriB);
    const title = `Compare: ${nameA} and ${nameB}`;
    const p = openPanel('compare', title);
    p.result = r;
    p.shown = async () => { await pro.produced('compare'); };
    p.actions = async (id) => {
      if (id !== 'md') return;
      const dest = await vscode.window.showSaveDialog({ defaultUri: sibling(uriA, `${stem(uriA)}-vs-${stem(uriB)}.compare.md`), filters: { Markdown: ['md'] }, title: 'Save the comparison as Markdown' });
      if (!dest) return;
      await writeBytes(dest, C.compareMarkdown(r, nameA, nameB));
      p.post({ type: 'patch', target: 'saved', html: `Saved ${esc(dest.fsPath || dest.path)}.` });
    };
    const list = (arr, id) => (arr.length ? `<ul id="${id}">${arr.map((t) => `<li><code>${esc(t.name)}</code> <span class="muted">(${plural(t.rows, 'row', 'rows')})</span></li>`).join('')}</ul>` : `<p id="${id}" class="muted">None.</p>`);
    const sign = (n) => (n > 0 ? `+${fmtN(n)}` : fmtN(n));
    const rows = r.both.map((t) => `<tr class="${t.changed ? 'changed' : ''}" data-name="${esc(t.name)}"><td><code>${esc(t.name)}</code></td><td class="num">${fmtN(t.rowsA)}</td><td class="num">${fmtN(t.rowsB)}</td><td class="num">${sign(t.rowsB - t.rowsA)}</td><td>${esc(t.colsOnlyA.join(', '))}</td><td>${esc(t.colsOnlyB.join(', '))}</td><td>${esc(t.typeChanged.map((x) => `${x.name}: ${x.a} to ${x.b}`).join('; '))}</td></tr>`).join('');
    const html = `<p class="row"><button class="tb act" data-id="md">Save as Markdown...</button> <span id="saved" class="muted"></span></p>
<div class="stats"><div><b id="nOnlyA">${r.onlyA.length}</b><span>tables only in A</span></div><div><b id="nOnlyB">${r.onlyB.length}</b><span>tables only in B</span></div><div><b id="nChanged">${r.changed}</b><span>tables changed</span></div><div><b id="nSame">${r.same}</b><span>tables the same</span></div></div>
<p class="muted">A: ${esc(nameA)} (${ha.db.info.ace ? 'ACCDB' : 'MDB'}, ${ha.db.info.label}, ${plural(ha.db.tables.length, 'table', 'tables')}). B: ${esc(nameB)} (${hb.db.info.ace ? 'ACCDB' : 'MDB'}, ${hb.db.info.label}, ${plural(hb.db.tables.length, 'table', 'tables')}). Tables and columns are matched by name without case, as Access does. System tables are left out.</p>
<h3>Tables only in A</h3>${list(r.onlyA, 'onlyA')}
<h3>Tables only in B</h3>${list(r.onlyB, 'onlyB')}
<h3>Tables in both</h3>${r.both.length ? `<table id="bothTable" class="sort"><thead><tr><th>Table</th><th class="num">Rows in A</th><th class="num">Rows in B</th><th class="num">Difference</th><th>Columns only in A</th><th>Columns only in B</th><th>Type changes</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">None.</p>'}`;
    await p.show({ title, html });
    return r;
  }

  return { exportData, exportSqlite, schemaSql, compare, panels, dbFor, targetFile };
}

module.exports = { createTools, sibling, DB_RE };
