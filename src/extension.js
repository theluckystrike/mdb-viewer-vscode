'use strict';
// MDB Viewer & ACCDB, Access DB by Zovo: opens Microsoft Access databases (.mdb, .mde, .accdb, .accde) read-only as a
// table list, rows and schema. No network, no telemetry. Activation shows nothing: no message, no popup. The viewer
// opens only for files the user opens, and it never reopens a tab in another editor by itself.
const vscode = require('vscode');
const { MdbEditorProvider, VIEW_TYPE, DB_RE } = require('./editor');
const { createTools } = require('./tools');
const { createPro } = require('./pro');
const { createRatingPrompt } = require('./rate');
const support = require('./support');
const { createReach } = require('./reach');
const reachConfig = require('./reach-config');

const PREFIX = 'mdbViewer';
const EXT_ID = 'zovo.zovo-mdb-viewer';
const setting = (k, d) => vscode.workspace.getConfiguration(PREFIX).get(k, d);

function activate(context) {
  const sub = (d) => context.subscriptions.push(d);
  let rating = { success() {}, failure() {} };
  try { rating = createRatingPrompt({ vscode, context, extensionId: EXT_ID, section: PREFIX, name: 'MDB Viewer' }); } catch (e) { /* rating is optional */ }
  support.registerSupport({ vscode, context, prefix: PREFIX, selfId: EXT_ID });
  const pro = createPro({ vscode, context });
  const reach = createReach({ vscode, ...reachConfig, maximum: pro.TRIES, context, licensed: () => !!pro.licensed, shown: () => setting('showProTools', true) !== false });
  reach.registerCtx();
  sub(pro.onDidChange(() => reach.refresh()));

  const provider = new MdbEditorProvider(context, {
    reach: () => reach,
    onSuccess: (doc) => { rating.success(doc.uri); pro.noteOpen(doc.uri); },
    onFailure: () => rating.failure(),
  });
  sub(vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true }));
  sub(provider);
  const tools = createTools({ context, provider, pro, reach });

  const reg = (id, fn) => sub(vscode.commands.registerCommand(id, async (...a) => {
    try { return await fn(...a); } catch (e) { vscode.window.showErrorMessage(String((e && e.message) || e)); return undefined; }
  }));
  const target = (uri) => (uri && uri.scheme ? uri : undefined);
  const extraOf = (x) => (x && !x.scheme && !Array.isArray(x) && typeof x === 'object' ? x : {});
  const sample = (name) => vscode.Uri.joinPath(context.extensionUri, 'samples', name);
  reg(`${PREFIX}.openWithViewer`, (uri) => {
    const u = uri && uri.scheme ? uri : (provider.active && provider.active.uri);
    if (!u || !DB_RE.test(u.path)) { vscode.window.showInformationMessage('Select a .mdb, .mde, .accdb or .accde file first.'); return undefined; }
    return vscode.commands.executeCommand('vscode.openWith', u, VIEW_TYPE);
  });
  reg(`${PREFIX}.openSample`, () => vscode.commands.executeCommand('vscode.openWith', sample('zovo-demo-shop.accdb'), VIEW_TYPE));
  reg(`${PREFIX}.openSampleMdb`, () => vscode.commands.executeCommand('vscode.openWith', sample('zovo-demo-shop.mdb'), VIEW_TYPE));
  reg(`${PREFIX}.openWalkthrough`, () => vscode.commands.executeCommand('workbench.action.openWalkthrough', `${EXT_ID}#${PREFIX}.start`, false));
  reg(`${PREFIX}.exportData`, reach.wrap((uri, extra) => tools.exportData(target(uri), extraOf(extra))));
  reg(`${PREFIX}.exportSqlite`, reach.wrap((uri, extra) => tools.exportSqlite(target(uri), extraOf(extra))));
  reg(`${PREFIX}.schemaSql`, reach.wrap((uri, extra) => tools.schemaSql(target(uri), extraOf(extra))));
  reg(`${PREFIX}.compare`, reach.wrap((uri, extra) => tools.compare(target(uri), extraOf(extra))));
  sub(vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration(`${PREFIX}.showProTools`)) reach.refresh(); }));
  sub(vscode.window.registerUriHandler({ handleUri: (uri) => pro.handleUri(uri) }));
  return { provider, tools, pro };
}

function deactivate() {}

module.exports = { activate, deactivate };
