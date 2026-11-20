'use strict';
// Webview HTML for the viewer and the Pro tool panels. No vscode import, so tests can check the CSP: no remote origin,
// no connect-src, no worker or blob source, scripts only with the page nonce.
const crypto = require('crypto');
const { footerHtml, FOOTER_CSS } = require('./support');

const PREFIX = 'mdbViewer';
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function csp(cspSource, n) {
  return ["default-src 'none'", `style-src ${cspSource} 'nonce-${n}'`, `script-src 'nonce-${n}'`, `img-src ${cspSource} data:`, `font-src ${cspSource}`].join('; ');
}

function head(p, n) {
  const footer = footerHtml(PREFIX, p.showSupportLinks !== false, '');
  return { footer, html: `<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(p.cspSource, n)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${attr(p.styleUri)}">
${footer ? `<style nonce="${n}">${FOOTER_CSS}</style>` : ''}
${typeof p.head === 'function' ? p.head(n) : ''}
<title>${attr(p.title)}</title>` };
}

/** p: { cspSource, scriptUri, styleUri, title, showSupportLinks, head?(nonce) } */
function editorHtml(p) {
  const n = p.nonce || crypto.randomBytes(18).toString('base64url');
  const h = head(p, n);
  return `<!DOCTYPE html>
<html lang="en">
<head>
${h.html}
</head>
<body data-state="loading">
<div id="toolbar" role="toolbar" aria-label="Access database viewer">
  <span id="fmt" class="chip" title="Format, engine and size"></span>
  <span id="tabs" class="grp"><button class="tb tab sel" id="tabData" data-tab="data">Data</button><button class="tb tab" id="tabSchema" data-tab="schema">Schema</button></span>
  <input id="filter" type="search" spellcheck="false" placeholder="Filter rows" aria-label="Filter the rows of this table">
  <select id="filterCol" aria-label="Column to filter"><option value="-1">All columns</option></select>
  <span id="count" class="muted"></span>
  <label class="chk" title="Show the MSys system tables of the database"><input type="checkbox" id="sysToggle"> System tables</label>
</div>
<div id="app">
  <aside id="side" aria-label="Tables">
    <div id="tables" role="listbox" aria-label="Tables"></div>
    <section id="facts" aria-label="File facts"></section>
  </aside>
  <main id="main">
    <div id="msg" role="alert" hidden></div>
    <section id="dataView">
      <div id="gridWrap"><table id="grid" aria-label="Rows"><thead></thead><tbody></tbody></table></div>
      <div id="pager">
        <button class="tb" id="first" title="First page">&#x23EE;</button><button class="tb" id="prev" title="Previous page">&#x25C0;</button>
        <span id="pageInfo"></span>
        <button class="tb" id="next" title="Next page">&#x25B6;</button><button class="tb" id="last" title="Last page">&#x23ED;</button>
        <label>Rows per page <select id="pageSize"><option>50</option><option selected>100</option><option>250</option><option>500</option><option>1000</option></select></label>
      </div>
      <section id="detail" aria-label="Selected cell" hidden>
        <div class="dbar"><strong id="dHead"></strong><span id="dNote" class="muted"></span><span class="spacer"></span><button class="tb" id="copyCell" title="Copy the value of this cell">Copy cell</button><button class="tb" id="copyRow" title="Copy the row, tab separated">Copy row</button></div>
        <pre id="dText"></pre>
      </section>
    </section>
    <section id="schemaView" hidden></section>
  </main>
</div>
<div id="status"><span id="statusText"></span></div>
<div id="footer"></div>
<template id="zovo-footer">${h.footer}</template>
<script nonce="${n}" src="${attr(p.scriptUri)}"></script>
</body>
</html>`;
}

/** Panel of a Pro tool. p: { cspSource, scriptUri, styleUri, title, head?(nonce), showSupportLinks } */
function panelHtml(p) {
  const n = p.nonce || crypto.randomBytes(18).toString('base64url');
  const h = head(p, n);
  return `<!DOCTYPE html>
<html lang="en">
<head>
${h.html}
</head>
<body class="panel">
<div id="toolbar" role="toolbar"><strong id="title"></strong><span id="actions"></span></div>
<div id="app" class="panelApp">
  <div id="report"><p class="muted">Working...</p></div>
</div>
<div id="footer">${h.footer}</div>
<script nonce="${n}" src="${attr(p.scriptUri)}"></script>
</body>
</html>`;
}

module.exports = { editorHtml, panelHtml, csp };
