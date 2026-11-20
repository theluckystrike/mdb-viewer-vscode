'use strict';
// Zovo Pro for the MDB Viewer, on top of the shared license module (src/license, copied unchanged from
// factory/sprint/license by apply.sh). Four Pro tools, 1 free try each on this computer. A try counts only after the
// tool showed its result (the export result panel drawn, the SQL file open, the comparison report drawn); Escape,
// Cancel or an error never uses one. Every click on a Pro tool checks the count again, whatever the file: the 2nd use
// opens the Pro panel, on the same file or another one.
// Nothing about Pro shows on open or activation: the panel appears only after a click on a Pro tool with no tries left.
// The 7-day trial of the module (TRIAL2) starts only from that panel's first button.
const { createLicense } = require('./license');
const { currentSurface } = require('./reach');

const SKU = 'mdb-viewer-pro';
// OWNER DECISION 15 Nov (TRIES1): 1 free try per Pro tool. The only place this listing sets the number.
const TRIES = 1;
const TRIAL_USES = TRIES;
const TRIAL_KEY = 'mdbViewer.proTrial';

const FEATURES = {
  exportData: {
    title: 'Export to CSV and JSON',
    detail: 'Saves one table or every table as CSV files (one per table) or as one JSON file, with memo text, dates and binary values kept.',
  },
  exportSqlite: {
    title: 'Export to SQLite',
    detail: 'Writes every table with all its rows into one SQLite .db file, attachments in a side table, and checks the row counts in the new file.',
  },
  schemaSql: {
    title: 'Schema as SQL',
    detail: 'Writes a CREATE TABLE statement for every table in the SQLite, PostgreSQL, MySQL or SQL Server dialect, with the column types mapped.',
  },
  compare: {
    title: 'Compare two Access files',
    detail: 'Compares two .mdb or .accdb files: tables only in one of them, columns added or removed, type changes and row counts, with a Markdown report.',
  },
};
const TOOLS = Object.values(FEATURES).map((f) => f.title);

function surfaceOf(arg) {
  const s = currentSurface();
  if (s) return s;
  if (arg && typeof arg === 'object' && typeof arg.surface === 'string') return arg.surface;
  return undefined;
}

function createPro({ vscode, context, license, prefix = 'mdbViewer', productName = 'MDB Viewer' }) {
  const emitter = new vscode.EventEmitter();
  const lic = license || createLicense({ vscode, context, sku: SKU, name: 'Zovo', product: productName, commandPrefix: prefix, proTools: TOOLS });
  if (lic.onDidChange) lic.onDidChange(() => emitter.fire(lic.isPro(SKU)));

  // Counts never go down in a session: globalState can hand back an older value for a moment after a write, so the
  // highest count seen here wins.
  const seen = {};
  const used = (f) => Math.max(Number((context.globalState.get(TRIAL_KEY) || {})[f]) || 0, seen[f] || 0);
  const left = (f) => (FEATURES[f] ? Math.max(0, TRIES - used(f)) : 0);
  const licensed = () => lic.isPro(SKU);

  /** Before a Pro tool runs: true when it may run (licensed or in the trial, or a free try left). Otherwise the one panel. */
  async function allowed(f, arg) {
    if (licensed()) { if (lic.refresh) lic.refresh(); return true; }
    if (left(f) > 0) return true;
    const feat = FEATURES[f] || { title: 'This tool', detail: '' };
    const surface = surfaceOf(arg);
    return !!(await lic.requirePro(feat.title, { detail: feat.detail, toolId: f, triesUsed: used(f), ...(surface ? { surface } : {}) }));
  }

  /** After the tool showed its result: counts one free try (nothing when licensed or in the trial). */
  async function produced(f) {
    if (licensed() || !FEATURES[f]) return;
    const m = { ...(context.globalState.get(TRIAL_KEY) || {}) };
    for (const k of Object.keys(seen)) m[k] = Math.max(Number(m[k]) || 0, seen[k]);
    m[f] = used(f) + 1;
    seen[f] = m[f];
    await context.globalState.update(TRIAL_KEY, m);
    const l = left(f);
    vscode.window.setStatusBarMessage(`Zovo Pro: free try ${used(f)} of ${TRIES} of "${FEATURES[f].title}" used${l ? `, ${l} left` : ''} on this computer.`, 8000);
    emitter.fire(false);
  }

  context.subscriptions.push(emitter);
  return {
    SKU, FEATURES, TRIES, TRIAL_USES,
    get licensed() { return licensed(); },
    ready: lic.ready,
    allowed, produced, left, used,
    tries: () => Object.fromEntries(Object.keys(FEATURES).map((f) => [f, left(f)])),
    handleUri: (uri) => (lic.handleUri ? lic.handleUri(uri) : undefined),
    noteOpen: (uri) => { try { if (lic.noteOpen) lic.noteOpen(uri); } catch (e) { /* optional */ } },
    onDidChange: emitter.event,
    license: lic,
  };
}

module.exports = { createPro, FEATURES, SKU, TRIES, TRIAL_USES, TRIAL_KEY, TOOLS, surfaceOf };
