'use strict';
// Read-only custom editor mdbViewer.database for .mdb, .mde, .accdb and .accde. The extension host reads the file
// through VS Code's file system API (Remote SSH, WSL and containers work the same), opens it with src/core/access.js
// and sends the webview one page of rows at a time. The database file is never written. The webview has no network
// access (CSP default-src 'none'). A file that is not an Access database, a cut file, an empty file and a file with a
// password each get a plain note in the view: no error popup, and the viewer never reopens a tab by itself.
const vscode = require('vscode');
const path = require('path');
const A = require('./core/access');
const G = require('./core/grid');
const V = require('./core/values');
const { editorHtml } = require('./html');
const support = require('./support');

const VIEW_TYPE = 'mdbViewer.database';
const PREFIX = 'mdbViewer';
const MAX_BYTES = 1024 * 1024 * 1024;
const DB_RE = /\.(mdb|mde|accdb|accde)$/i;
const setting = (k, d) => vscode.workspace.getConfiguration(PREFIX).get(k, d);
const HEX_EDITORS = [['zovo.zovo-hex-viewer', 'hexViewer.editor', 'Hex Viewer'], ['ms-vscode.hexeditor', 'hexEditor.hexedit', 'Hex Editor']];

function sizeText(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Reads and opens a database file. Shared by the viewer and the Pro tools.
 * Returns { uri, name, size, kind: 'db' | 'empty' | 'notaccess' | 'cut' | 'password' | 'badpassword' | 'damaged' | 'error', db, error }.
 */
async function loadFile(uri, password) {
  const name = path.posix.basename(uri.path);
  const out = { uri, name, size: 0, kind: 'error', db: null, error: '' };
  try { const st = await vscode.workspace.fs.stat(uri); if (st && st.size > MAX_BYTES) { out.size = st.size; out.kind = 'damaged'; out.error = `This file is ${sizeText(st.size)}, more than the 1 GB the viewer reads.`; return out; } } catch (e) { /* stat is optional */ }
  let bytes;
  try { bytes = await vscode.workspace.fs.readFile(uri); } catch (e) { out.error = `The file could not be read: ${String((e && e.message) || e)}`; return out; }
  out.size = bytes.byteLength;
  if (!bytes.byteLength) { out.kind = 'empty'; out.error = 'This file is empty.'; return out; }
  try {
    out.db = A.open(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { password });
    out.kind = 'db';
  } catch (e) {
    out.kind = e && e.kind ? e.kind : 'error';
    out.error = String((e && e.message) || e);
  }
  return out;
}

class MdbDocument {
  constructor(uri) { this.uri = uri; this.panels = new Set(); this.listeners = []; this.data = null; this.password = undefined; this.cache = null; this.selected = ''; }
  get name() { return path.posix.basename(this.uri.path); }
  async load() {
    try { this.data = await loadFile(this.uri, this.password); } catch (e) { this.data = { kind: 'error', error: String((e && e.message) || e), name: this.name, size: 0 }; }
    this.cache = null;
  }
  /** The rows of a table, read once and kept for paging, sorting and filtering (one table at a time). */
  table(name) {
    if (this.cache && this.cache.name === name) return this.cache;
    const t = A.readTable(this.data.db, name);
    this.cache = { name, table: t, idx: null, key: '' };
    return this.cache;
  }
  dispose() { for (const l of this.listeners) { try { l.dispose(); } catch (e) { /* gone */ } } }
}

class MdbEditorProvider {
  constructor(context, hooks = {}) {
    this.context = context;
    this.hooks = hooks;
    this.docs = new Set();
    this.active = null;
    this.activePanel = null;
    this._success = new WeakSet();
  }
  dispose() { for (const d of this.docs) d.dispose(); this.docs.clear(); }

  async openCustomDocument(uri) {
    const doc = new MdbDocument(uri);
    await doc.load();
    this.docs.add(doc);
    let timer = null;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(async () => { await doc.load(); for (const p of doc.panels) this.init(doc, p.webview); }, 600); };
    try {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), path.posix.basename(uri.path)));
      doc.listeners.push(w, w.onDidChange(() => refresh()), w.onDidCreate(() => refresh()));
    } catch (e) { /* no watcher: the view still works */ }
    return { uri, dispose: () => { this.docs.delete(doc); doc.dispose(); if (this.active === doc) this.active = null; }, _doc: doc };
  }

  async resolveCustomEditor(handle, panel) {
    const doc = handle._doc;
    doc.panels.add(panel);
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const reach = this.hooks.reach ? this.hooks.reach() : null;
    panel.webview.options = {
      enableScripts: true, localResourceRoots: [media],
      enableCommandUris: (reach ? reach.commandIds() : []).concat(support.commandUris(PREFIX)),
    };
    panel.webview.html = editorHtml({
      cspSource: panel.webview.cspSource,
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'viewer.js')).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'viewer.css')).toString(),
      title: doc.name,
      head: reach ? (n) => reach.headHtml(n) : undefined,
      showSupportLinks: setting('showSupportLinks', true) !== false,
    });
    if (reach) reach.attach(panel.webview, panel);
    const setActive = () => { if (panel.active) { this.active = doc; this.activePanel = panel; } };
    setActive();
    panel.onDidChangeViewState(setActive);
    panel.onDidDispose(() => { doc.panels.delete(panel); if (this.activePanel === panel) { this.activePanel = null; if (this.active === doc) this.active = null; } });
    panel.webview.onDidReceiveMessage(async (m) => {
      if (reach && reach.onMessage(m)) return;
      if (!m || typeof m !== 'object') return;
      try { await this.onMessage(doc, panel, m); } catch (e) {
        this.send(panel.webview, { type: 'error', error: String((e && e.message) || e), table: m.name || '' });
      }
    });
  }

  send(webview, msg) { try { const r = webview.postMessage(msg); if (r && r.then) r.then(undefined, () => false); } catch (e) { /* disposed */ } }

  hexEditor() {
    for (const [id, viewType, name] of HEX_EDITORS) { try { if (vscode.extensions.getExtension(id)) return { viewType, name }; } catch (e) { /* none */ } }
    return null;
  }

  init(doc, webview) {
    const d = doc.data || { kind: 'error', error: 'The file could not be read.' };
    const base = { type: 'init', name: doc.name, kind: d.kind, sizeText: sizeText(d.size || 0), settings: { pageSize: Number(setting('pageSize', 100)) || 100 } };
    if (d.kind !== 'db') {
      const hex = this.hexEditor();
      this.send(webview, { ...base, error: d.error || 'The file could not be read.', hex: d.kind === 'notaccess' || d.kind === 'damaged' || d.kind === 'cut' ? (hex ? hex.name : '') : '' });
      if ((d.kind === 'damaged' || d.kind === 'cut' || d.kind === 'error') && this.hooks.onFailure) this.hooks.onFailure(doc);
      return;
    }
    const db = d.db;
    const jet3 = db.info.code === 0;
    const meta = (t) => ({ name: t.name, rows: t.rows, error: t.error, columns: t.columns.map((c) => ({ name: c.name, type: c.type, typeName: V.typeName(c, jet3), nullable: c.nullable })) });
    this.send(webview, {
      ...base, facts: A.facts(db, d.size), tables: db.tables.map(meta), system: db.system.map(meta), linked: db.linked, selected: doc.selected,
    });
  }

  /** The panel showing uri (the active one first), or null. */
  panelFor(uri) {
    const key = uri.toString();
    if (this.active && this.active.uri.toString() === key && this.activePanel) return { doc: this.active, panel: this.activePanel };
    for (const d of this.docs) if (d.uri.toString() === key) for (const p of d.panels) return { doc: d, panel: p };
    return null;
  }

  rows(doc, webview, m) {
    const c = doc.table(String(m.name));
    const view = { filter: String(m.filter || ''), col: Number.isInteger(m.col) ? m.col : -1, sort: Number.isInteger(m.sort) ? m.sort : -1, desc: !!m.desc };
    const key = JSON.stringify(view);
    if (!c.idx || c.key !== key) { c.idx = G.order(c.table, view); c.key = key; }
    const pg = G.page(c.table, c.idx, m.offset, m.limit);
    this.send(webview, { type: 'rows', name: c.name, seq: m.seq, ...view, ...pg, colErrors: c.table.colErrors });
  }

  async onMessage(doc, panel, m) {
    const w = panel.webview;
    switch (m.type) {
      case 'ready': this.init(doc, w); return;
      case 'rendered':
        if (!this._success.has(doc) && doc.data && doc.data.kind === 'db') { this._success.add(doc); if (this.hooks.onSuccess) this.hooks.onSuccess(doc); }
        return;
      case 'select': doc.selected = String(m.name || ''); return;
      case 'rows': doc.selected = String(m.name || ''); this.rows(doc, w, m); return;
      case 'cell': {
        const c = doc.table(String(m.name));
        const row = c.table.rows[Number(m.i)];
        const col = c.table.columns[Number(m.c)];
        if (!row || !col) return;
        const det = V.cellDetail(row[Number(m.c)], col.type);
        this.send(w, { type: 'cell', name: c.name, i: Number(m.i), c: Number(m.c), column: col.name, typeName: V.typeName(col, doc.data.db.info.code === 0), ...det });
        return;
      }
      case 'copy': {
        const c = doc.table(String(m.name));
        const row = c.table.rows[Number(m.i)];
        if (!row) return;
        let text, what;
        if (m.what === 'row') { text = row.map((v, k) => V.copyText(v, c.table.columns[k].type).replace(/\t/g, ' ').replace(/\r\n|\r|\n/g, ' ')).join('\t'); what = 'the row'; }
        else { const k = Number(m.c); if (!c.table.columns[k]) return; text = V.copyText(row[k], c.table.columns[k].type); what = `the ${c.table.columns[k].name} value`; }
        await vscode.env.clipboard.writeText(text.slice(0, 10000000));
        vscode.window.setStatusBarMessage(`Copied ${what}`, 3000);
        this.send(w, { type: 'copied', what });
        return;
      }
      case 'password': {
        const pw = await vscode.window.showInputBox({ password: true, ignoreFocusOut: true, title: `Password for ${doc.name}`, prompt: 'The database password. It is used only to open this file in this window and is not stored.' });
        if (pw === undefined) return;
        doc.password = pw;
        await doc.load();
        for (const p of doc.panels) this.init(doc, p.webview);
        return;
      }
      case 'openHex': { const h = this.hexEditor(); if (h) await vscode.commands.executeCommand('vscode.openWith', doc.uri, h.viewType); return; }
      default:
    }
  }
}

module.exports = { MdbEditorProvider, MdbDocument, loadFile, VIEW_TYPE, DB_RE, sizeText };
