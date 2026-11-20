'use strict';
// NEWBFIX: JSON export keeps every table and column name, __proto__ too, in the order of the database
// (VER26 BLOCK, 20 Nov 03:45). The CSV folder export gives each table its own file name.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core/convert');

const table = (names, rows) => ({ columns: names.map((name) => ({ name, type: 'text' })), rows });
const keysInText = (text) => [...text.matchAll(/^\s*"((?:[^"\\]|\\.)*)":/gm)].map((m) => JSON.parse(`"${m[1]}"`));

test('JSON: a column named __proto__ is an own property of the row', () => {
  const t = table(['id', '__proto__', 'constructor'], [['1', 'p', 'c']]);
  const text = C.tableJson(t);
  assert.match(text, /"__proto__": "p"/);
  const rows = JSON.parse(text);
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], '__proto__'), true);
  assert.equal(rows[0].constructor, 'c');
  // toObjects gives rows with own data properties, also for __proto__
  const o = C.toObjects(t)[0];
  assert.deepEqual(Object.keys(o), ['id', '__proto__', 'constructor']);
  assert.equal(Object.getOwnPropertyDescriptor(o, '__proto__').value, 'p');
});

test('JSON: a table named __proto__ is kept in the document', () => {
  const text = C.toJsonDoc('x.accdb', [{ name: '__proto__', data: table(['a'], [['1']]) }, { name: 'Orders', data: table(['b'], [['2']]) }]);
  assert.match(text, /"__proto__": \[/);
  const doc = JSON.parse(text);
  assert.equal(Object.prototype.hasOwnProperty.call(doc.tables, '__proto__'), true);
  assert.deepEqual(Object.keys(doc.tables), ['__proto__', 'Orders']);
});

test('JSON: column and table order is the database order, also for names that look like numbers', () => {
  const t = table(['Name', '2024', '10', 'Total'], [['a', '1', '2', '3']]);
  assert.deepEqual(keysInText(C.tableJson(t)), ['Name', '2024', '10', 'Total']);
  const doc = C.toJsonDoc('x.accdb', [{ name: 'Zeta', data: t }, { name: '7', data: t }]);
  assert.deepEqual(keysInText(doc).filter((k) => ['Zeta', '7', 'source', 'tables'].includes(k)), ['source', 'tables', 'Zeta', '7']);
});

test('JSON: the text is the same as JSON.stringify with 2 spaces for plain names and values', () => {
  const t = { columns: [{ name: 'n', type: 'long' }, { name: 'b', type: 'binary' }, { name: 's', type: 'text' }], rows: [[5, new Uint8Array([1, 2]), 'x "q"\n'], [null, null, '']] };
  const plain = t.rows.map((r) => ({ n: r[0], b: r[1] ? { base64: Buffer.from(r[1]).toString('base64'), bytes: r[1].length } : null, s: r[2] }));
  assert.equal(C.tableJson(t), JSON.stringify(plain, null, 2) + '\n');
  assert.equal(C.tableJson(table(['a'], [])), '[]\n');
});

test('CSV folder: table names that clean to the same file name get distinct file names', () => {
  const names = C.uniqueFileNames(['a/b', 'a_b', 'A_B', 'index', 'con']);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length);
  assert.equal(names[0], 'a_b');
});

// A real Access file where the table Customers and the column Products.UnitPrice are renamed to __proto__
// (both names have 9 characters, so the bytes keep their size).
const fs = require('fs');
const path = require('path');
const A = require('../src/core/access');
function protoFile(name) {
  let b = fs.readFileSync(path.join(__dirname, '..', 'samples', name));
  for (const from of ['Customers', 'UnitPrice']) {
    const f = Buffer.from(from, 'utf16le'); const t = Buffer.from('__proto__', 'utf16le');
    for (let at = b.indexOf(f); at >= 0; at = b.indexOf(f, at + 1)) t.copy(b, at);
  }
  return b;
}
for (const name of ['zovo-demo-shop.accdb', 'zovo-demo-shop.mdb']) {
  test(`real file ${name}: a table and a column named __proto__ read and export with their values`, () => {
    const db = A.open(protoFile(name));
    assert.ok(db.tables.some((t) => t.name === '__proto__'));
    const products = A.readTable(db, 'Products');
    const k = products.columns.findIndex((c) => c.name === '__proto__');
    assert.ok(k >= 0);
    assert.equal(String(products.rows[0][k]), '3.5000');
    const doc = JSON.parse(C.toJsonDoc(name, db.tables.map((t) => ({ name: t.name, data: A.readTable(db, t.name) }))));
    assert.equal(Object.prototype.hasOwnProperty.call(doc.tables, '__proto__'), true);
    assert.equal(doc.tables.__proto__ === Object.prototype, false);
    assert.equal(Object.getOwnPropertyDescriptor(doc.tables, '__proto__').value.length, 48);
    assert.equal(Object.getOwnPropertyDescriptor(doc.tables.Products[0], '__proto__').value, 3.5);
  });
}
