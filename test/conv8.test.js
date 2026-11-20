// CONV8 (20 Nov 2026, CONV7 changes 1 and 3, owner yes): every Pro badge (the Pro tools row link, the status bar
// pick's Get Zovo Pro row, the footer link, a viewer's Pro section link, a { direct: true } link) opens the in-editor
// Pro panel, the same modal as requirePro, not the web /buy page. Order: the 7-day trial first while no trial ever
// started, then "Pay USD 19 by card" (the Worker /pay/), then GitHub Sponsors. Card first in the Pro panel of a tool and
// in the trial-end panel too. Tags <install id>_<surface>_<listing>. Nothing on open; the browser opens only after a
// panel button; no price change.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
// factory/sprint/license/test or a listing's test/ folder (module in src/license or src/zovo)
const dir = ['..', '../src/license', '../src/zovo'].find((d) => fs.existsSync(path.join(__dirname, d, 'index.js')) && fs.existsSync(path.join(__dirname, d, 'license.js'))) || '../src/license';
const IDX = require(`${dir}/index.js`);
const SRC = fs.readFileSync(path.join(__dirname, dir, 'index.js'), 'utf8');

const CARD = 'https://license.zovo.one/buy/zovo-pro';
const T = IDX.TRIAL_LABEL;
const SP = 'Pay with GitHub Sponsors (USD 19 once)';
const CB = 'Pay USD 19 by card';
const SD = 'See details';
function fakeVscode({ answers = [], setting, tabs } = {}) {
  const log = { modal: [], info: [], opened: [], items: [] };
  const global = new Map();
  const q = [...answers];
  const tabState = { active: tabs || null, listeners: [] };
  const vscode = {
    Uri: { parse: (s) => ({ toString: () => s, s }) },
    StatusBarAlignment: { Left: 1, Right: 2 },
    env: { openExternal: async (u) => { log.opened.push(u.toString()); return true; }, language: 'en', uriScheme: 'vscode', appName: 'Visual Studio Code' },
    window: {
      showInformationMessage: async (msg, ...rest) => {
        if (rest[0] && rest[0].modal) { log.modal.push({ msg, detail: rest[0].detail, buttons: rest.slice(1) }); return q.shift(); }
        log.info.push({ msg, buttons: rest }); return undefined;
      },
      showWarningMessage: async (m) => { log.info.push({ msg: m }); }, showErrorMessage: async (m) => { log.info.push({ msg: m }); },
      showQuickPick: async () => undefined, showInputBox: async () => undefined,
      onDidChangeWindowState: () => ({ dispose() {} }),
      createWebviewPanel: undefined,
      createStatusBarItem: (id, align, prio) => { const it = { id, align, prio, text: '', shown: false, show() { this.shown = true; }, hide() { this.shown = false; }, dispose() {} }; log.items.push(it); return it; },
      tabGroups: {
        get activeTabGroup() { return { activeTab: tabState.active }; },
        all: [],
        onDidChangeTabs: (fn) => { tabState.listeners.push(fn); return { dispose() {} }; },
        onDidChangeTabGroups: () => ({ dispose() {} }),
      },
    },
    commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => undefined },
    extensions: { all: [] },
    workspace: { getConfiguration: (section) => ({ get: (k, d) => (section === 'zovo.hex.trial' && k === 'enabled' && setting !== undefined ? setting : d) }) },
    authentication: { getSession: async () => undefined },
  };
  const context = { subscriptions: [], extension: { id: 'zovo.zovo-hex-viewer', packageJSON: { version: '9.9.9', contributes: { customEditors: [{ viewType: 'hexViewer.editor' }] } } },
    globalState: { get: (k) => global.get(k), update: async (k, v) => { global.set(k, v); } },
    secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} } };
  return { vscode, context, log, global, tabState, answer: (a) => q.push(a) };
}
const stub = (pro = false) => ({ id: 'github-sponsors', ready: Promise.resolve(), isPro: () => pro, unlock: async () => ({ pro: false }), refresh: async () => false, remove: async () => {}, state: () => null, onDidChange: () => ({ dispose() {} }) });
const mk = (f, extra = {}) => IDX.createLicense({
  vscode: f.vscode, context: f.context, sku: 'hex-pro', name: 'Zovo', product: 'Hex Viewer', commandPrefix: 'hexViewer',
  cardBuyUrl: CARD, listing: 'hex', rails: [stub()], sharedFile: '', returnDelayMs: 0, trial: true, env: { ZOVO_TRIAL_TODAY: '2026-11-20' }, ...extra,
});
const day = (d) => ({ ZOVO_TRIAL_TODAY: d });
const TAG = (tag) => new RegExp(`client_reference_id=[0-9a-f-]{36}_${tag}_hex(&|$)`);


const PP = 'Pay with PayPal';
const EK = 'Enter a key';
const NN = 'Not now (tell us why)';
const BADGE = 'The Pro tools of Hex Viewer are part of Zovo Pro.';
const ref = (u) => new URL(u).searchParams.get('client_reference_id');

test('CONV8 module version, badge surfaces, prices and labels unchanged', () => {
  assert.match(IDX.MODULE_VERSION, /^2026-11-20\.conv8(-conv3)?$/);
  assert.deepEqual(IDX.BADGE_SURFACES, ['toolbar', 'status', 'footer', 'panel']);
  assert.deepEqual(IDX.PRICE, { one: 19, team: 59, seats: 5 });
  assert.equal(IDX.PANEL_CARD_LABEL, CB);
  assert.equal(IDX.PANEL_SPONSORS_LABEL, SP);
  assert.equal(IDX.TRIAL_LABEL, T);
  assert.ok(!/\*\*/.test(SRC.slice(SRC.indexOf('function badgeTitle'), SRC.indexOf('async function badgePanel'))), 'no bold in the panel text');
});

test('CONV8 nothing on open: no panel, no message, no URL, no state at activation', async () => {
  const f = fakeVscode();
  const p = mk(f);
  await p.ready;
  assert.deepEqual([f.log.modal.length, f.log.info.length, f.log.opened.length], [0, 0, 0]);
  assert.equal(f.global.get(IDX.TRIAL_STATE_KEY), undefined);
});

test('CONV8 each badge surface opens the Pro panel: trial first, then card, Sponsors, See details; nothing opens on Escape', async () => {
  for (const arg of [[{ surface: 'toolbar' }], { surface: 'status' }, ['footer'], 'footer', 'panel', { surface: 'pick', direct: true }]) {
    const f = fakeVscode();
    const p = mk(f);
    await p.ready;
    assert.equal(await p.getPro(arg), false);
    assert.equal(f.log.modal.length, 1, JSON.stringify(arg));
    const m = f.log.modal[0];
    assert.equal(m.msg, BADGE);
    assert.deepEqual(m.buttons, [T, CB, SP, SD, PP, EK, NN]);
    assert.match(m.detail, /^Try all Pro tools of Hex Viewer for 7 days, free\. No card and no account\. The trial starts only when you click its button\. It ends on its own on 27 Nov 2026\./);
    assert.match(m.detail, /One key turns on Pro in every Zovo extension, for life\. USD 19 once\./);
    assert.match(m.detail, /The card page shows BeLikeNative, our payments account\.$/);
    assert.deepEqual(f.log.opened, [], 'no browser before a button click');
    assert.equal(f.global.get(IDX.TRIAL_STATE_KEY), undefined, 'no trial without its button');
  }
});

test('CONV8 badge panel links: card = /pay/, Sponsors = /gh/, See details = /buy/, Not now = nn=1; all tagged <id>_<surface>_<listing>', async () => {
  const cases = [[CB, /^https:\/\/license\.zovo\.one\/pay\/zovo-pro\?client_reference_id=[0-9a-f-]{36}_toolbar_hex$/],
    [SP, /^https:\/\/license\.zovo\.one\/gh\/zovo-pro\?client_reference_id=[0-9a-f-]{36}_toolbar_hex$/],
    [SD, /^https:\/\/license\.zovo\.one\/buy\/zovo-pro\?client_reference_id=[0-9a-f-]{36}_toolbar_hex&lang=en$/],
    [NN, /^https:\/\/license\.zovo\.one\/buy\/zovo-pro\?nn=1&ref=[0-9a-f-]{36}_toolbar_hex&lang=en$/]];
  for (const [btn, re] of cases) {
    const f = fakeVscode({ answers: [btn] });
    const p = mk(f);
    await p.ready;
    assert.equal(await p.getPro({ surface: 'toolbar' }), false);
    assert.equal(f.log.opened.length, 1, btn);
    assert.match(f.log.opened[0], re);
    assert.ok(!/stripe\.com|github\.com/.test(f.log.opened[0]), 'only the license Worker');
    assert.equal(f.global.get(IDX.TRIAL_STATE_KEY), undefined);
  }
  for (const s of ['status', 'footer', 'panel']) {
    const f = fakeVscode({ answers: [CB] });
    await mk(f).getPro({ surface: s });
    assert.match(ref(f.log.opened[0]), new RegExp(`^[0-9a-f-]{36}_${s}_hex$`));
  }
});

test('CONV8 the trial button of a badge panel starts the trial: Pro on, one message, no URL; then no trial button', async () => {
  const f = fakeVscode({ answers: [T], tabs: { input: { viewType: 'hexViewer.editor' } } });
  const p = mk(f);
  await p.ready;
  assert.equal(p.isPro(), false);
  assert.equal(await p.getPro('footer'), true);
  assert.equal(p.isPro(), true);
  assert.equal(p.isPaid(), false);
  assert.deepEqual(f.log.opened, []);
  assert.equal(f.global.get(IDX.TRIAL_STATE_KEY).start, '2026-11-20');
  assert.deepEqual(f.log.info.map((i) => i.msg), ['Pro trial on. Every Pro tool of Hex Viewer works until 27 Nov 2026.']);
  assert.ok(f.log.items.some((it) => it.shown && it.text === '$(clock) Pro trial: 7 days left'));
  // a badge click during the trial: the panel with no trial button, card first, the end date
  await p.getPro({ surface: 'toolbar' });
  const m = f.log.modal.at(-1);
  assert.deepEqual(m.buttons, [CB, SP, SD, PP, EK, NN]);
  assert.match(m.detail, /^Your Pro trial runs until 27 Nov 2026\. USD 19 once keeps every Pro tool after it\./);
  assert.deepEqual(f.log.opened, []);
});

test('CONV8 a paid user: a badge click shows one message and opens nothing', async () => {
  const f = fakeVscode();
  const p = mk(f, { rails: [stub(true)] });
  await p.ready;
  assert.equal(await p.getPro({ surface: 'toolbar' }), true);
  assert.equal(f.log.modal.length, 0);
  assert.deepEqual(f.log.info.map((i) => i.msg), ['Zovo Pro is on in Hex Viewer. Every Pro tool works.']);
  assert.deepEqual(f.log.opened, []);
});

test('CONV8 card first in the Pro panel of a tool (requirePro), tagged as before', async () => {
  const f = fakeVscode({ answers: [CB] });
  const p = mk(f);
  await p.ready;
  assert.equal(await p.requirePro('Checksums', { triesUsed: 1 }), false);
  assert.deepEqual(f.log.modal[0].buttons, [T, CB, SP, SD, PP, EK, NN]);
  assert.equal(f.log.modal[0].msg, 'Checksums is part of Zovo Pro.');
  assert.match(ref(f.log.opened[0]), /^[0-9a-f-]{36}_trialstart_hex$/);
  const g = fakeVscode({ answers: [CB] });
  const q = mk(g, { trial: false });
  await q.requirePro('Checksums', { triesUsed: 1 });
  assert.deepEqual(g.log.modal[0].buttons, [CB, SP, SD, PP, EK, NN]);
  assert.match(ref(g.log.opened[0]), /^[0-9a-f-]{36}_panel_hex$/);
  assert.match(g.log.opened[0], /^https:\/\/license\.zovo\.one\/pay\/zovo-pro\?/);
});

test('CONV8 card first in the trial-end panel; a badge click after the end shows the panel with the end date, no trial button', async () => {
  const f = fakeVscode({ answers: [T] });
  const p = mk(f);
  await p.ready;
  await p.getPro('footer');
  assert.equal(p.isPro(), true);
  const g = fakeVscode();
  g.global.set(IDX.TRIAL_STATE_KEY, f.global.get(IDX.TRIAL_STATE_KEY));
  const q = mk(g, { env: day('2026-11-27') });
  await q.ready;
  assert.equal(q.isPro(), false);
  await q.getPro({ surface: 'toolbar' });
  assert.deepEqual(g.log.modal[0].buttons, [CB, SP, SD, PP, EK, NN]);
  assert.match(g.log.modal[0].detail, /^Your 7-day trial ended on 27 Nov 2026\./);
  g.answer(CB);
  await q.requirePro('Checksums', { triesUsed: 1 });
  const end = g.log.modal[1];
  assert.equal(end.msg, IDX.TRIAL_ENDED_LINE);
  assert.deepEqual(end.buttons, [CB, SP, SD, EK]);
  assert.match(ref(g.log.opened[0]), /^[0-9a-f-]{36}_trialend_hex$/);
  assert.match(g.log.opened[0], /^https:\/\/license\.zovo\.one\/pay\/zovo-pro\?/);
});

test('CONV8 kill switch off: the badge panel has no trial button; a direct Stripe link keeps the old path', async () => {
  const f = fakeVscode({ setting: false });
  const p = mk(f);
  await p.ready;
  await p.getPro({ surface: 'toolbar' });
  assert.deepEqual(f.log.modal[0].buttons, [CB, SP, SD, PP, EK, NN]);
  assert.match(f.log.modal[0].detail, /^One key turns on Pro/);
  const s = fakeVscode();
  const sp = mk(s, { cardBuyUrl: 'https://buy.stripe.com/test_eVq3cw2oagsgeklaYZ43S0Q' });
  await sp.ready;
  await sp.getPro({ surface: 'toolbar' });
  assert.equal(s.log.modal.length, 0, 'no badge panel without the license Worker');
  assert.deepEqual(s.log.opened, []);
});

test('CONV8 the activation link handler is still there (vscode://<id>/license?key=...)', async () => {
  const f = fakeVscode();
  const p = mk(f);
  await p.ready;
  assert.equal(typeof p.handleUri, 'function');
  assert.equal(await p.handleUri({ path: '/license', query: 'key=nope' }), false);
  assert.equal(f.log.modal.length, 0);
  assert.equal(await p.handleUri({ path: '/activate', query: 'key=nope' }), false);
  assert.deepEqual(f.log.opened, []);
});
