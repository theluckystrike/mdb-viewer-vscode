'use strict';
// Filter, sort and page the rows of one table, all on this computer. The table is read once; the order of row indexes
// is kept so paging through a sorted or filtered view does not read the file again.
const V = require('./values');

/**
 * view: { filter: text, col: column index or -1 (all), sort: column index or -1, desc: bool }
 * Returns the row indexes in view order.
 */
function order(table, view = {}) {
  const { columns, rows } = table;
  let idx = rows.map((_, i) => i);
  const text = String(view.filter || '').trim().toLowerCase();
  if (text) {
    const cols = Number.isInteger(view.col) && view.col >= 0 && view.col < columns.length ? [view.col] : columns.map((_, i) => i);
    const memo = new Map();
    const textOf = (i, c) => {
      const k = i * columns.length + c;
      let s = memo.get(k);
      if (s === undefined) { s = V.cellText(rows[i][c], columns[c].type, 100000).toLowerCase(); memo.set(k, s); }
      return s;
    };
    idx = idx.filter((i) => cols.some((c) => textOf(i, c).includes(text)));
  }
  if (Number.isInteger(view.sort) && view.sort >= 0 && view.sort < columns.length) {
    const c = view.sort, type = columns[c].type, dir = view.desc ? -1 : 1;
    const keys = new Map(idx.map((i) => [i, V.sortKey(rows[i][c], type)]));
    idx.sort((a, b) => {
      const x = keys.get(a), y = keys.get(b);
      if (x === null && y === null) return a - b;
      if (x === null) return 1;
      if (y === null) return -1;
      let r;
      if (typeof x === 'number' && typeof y === 'number') r = x - y;
      else if (typeof x === 'number') r = -1;
      else if (typeof y === 'number') r = 1;
      else r = x < y ? -1 : x > y ? 1 : 0;
      return r ? r * dir : a - b;
    });
  }
  return idx;
}

/** One page for the webview: the cell text of each row, with null cells marked. */
function page(table, idx, offset, limit) {
  const start = Math.max(0, Math.min(Number(offset) || 0, Math.max(0, idx.length - 1)));
  const lim = Math.max(1, Math.min(Number(limit) || 100, 1000));
  const rows = idx.slice(start, start + lim).map((i) => ({
    i,
    cells: table.rows[i].map((v, c) => (v === null || v === undefined ? null : V.cellText(v, table.columns[c].type))),
  }));
  return { offset: idx.length ? start : 0, limit: lim, total: table.rows.length, shown: idx.length, rows };
}

module.exports = { order, page };
