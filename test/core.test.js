'use strict';
// Core tests (no vscode): opening Jet 3, Jet 4 and ACE files, passwords, broken files, cell values, filter, sort and
// paging, CSV and JSON, the SQL DDL of the four dialects (the SQLite one runs in sql.js), the SQLite export read back,
// and the comparison of two databases.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('../src/core/access');
const V = require('../src/core/values');
const G = require('../src/core/grid');
const C = require('../src/core/convert');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const rd = (f) => fs.readFileSync(f);
const shopAccdb = () => A.open(rd(path.join(ROOT, 'samples', 'zovo-demo-shop.accdb')));
const shopMdb = () => A.open(rd(path.join(ROOT, 'samples', 'zovo-demo-shop.mdb')));

// ---------- open ----------
test('open: our ACCDB sample (ACE 14) lists 5 user tables with row counts; system tables are separate', () => {
  const db = shopAccdb();
  assert.equal(db.info.label, 'ACE 14');
  assert.equal(db.info.ace, true);
  assert.deepEqual(db.tables.map((t) => [t.name, t.rows]), [['Customers', 48], ['OrderLines', 600], ['Orders', 240], ['Products', 20], ['Shippers', 3]]);
  assert.ok(db.system.length > 5 && db.system.every((t) => /^(MSys|f_[0-9A-F]{32}_)/.test(t.name)));
  assert.deepEqual(db.linked, []);
  const f = A.facts(db, 487424);
  assert.equal(f.format, 'ACCDB');
  assert.equal(f.engine, 'ACE 14 (Access 2010)');
  assert.equal(f.rows, 911);
  assert.equal(f.password, false);
});
test('open: the same data as a Jet 4 MDB, and a Jet 3 (Access 97) file', () => {
  const db = shopMdb();
  assert.equal(db.info.label, 'Jet 4');
  assert.equal(db.info.ace, false);
  assert.deepEqual(db.tables.map((t) => t.rows), [48, 600, 240, 20, 3]);
  const j3 = A.open(rd(path.join(FIX, 'jet3-test.mdb')));
  assert.equal(j3.info.label, 'Jet 3');
  assert.equal(j3.info.page, 2048);
  assert.deepEqual(j3.tables.map((t) => t.name), ['Table1', 'Table2', 'Table3', 'Table4']);
  const t1 = A.readTable(j3, 'Table1');
  assert.deepEqual(t1.rows.find((r) => r[0] === 'abcdefg').slice(0, 5), ['abcdefg', 'hijklmnop', 2, 222, 333333333]);
});
test('open: a Jet 4 file with a database password asks for it, refuses a wrong one, opens with the right one', () => {
  const b = rd(path.join(FIX, 'V2003_with-password.mdb'));
  assert.throws(() => A.open(b), (e) => e.kind === 'password' && /protected with a password/.test(e.message));
  assert.throws(() => A.open(b, { password: 'nope' }), (e) => e.kind === 'badpassword');
  const db = A.open(b, { password: 'password' });
  assert.equal(db.tables[0].rows, 3);
  assert.equal(A.facts(db, b.length).password, true);
});
test('open: an encrypted ACCDB (password) asks for it, refuses a wrong one, opens with the right one', () => {
  const b = rd(path.join(FIX, 'V2010_with-password.accdb'));
  assert.throws(() => A.open(b), (e) => e.kind === 'password');
  assert.throws(() => A.open(b, { password: 'x' }), (e) => e.kind === 'badpassword');
  const db = A.open(b, { password: 'password' });
  assert.equal(A.readTable(db, db.tables[0].name).rows.length, 3);
});
test('open: not an Access file, a cut file and a header-only file give plain errors with a kind', () => {
  assert.throws(() => A.open(Buffer.from('hello, this is text and not a database at all, really')), (e) => e.kind === 'notaccess' && /not a Microsoft Access database/.test(e.message));
  const full = rd(path.join(ROOT, 'samples', 'zovo-demo-shop.accdb'));
  assert.throws(() => A.open(full.subarray(0, 3000)), (e) => e.kind === 'cut' && /cut off/.test(e.message));
  assert.throws(() => A.open(full.subarray(0, 40000)), (e) => ['cut', 'damaged'].includes(e.kind));
  assert.equal(A.sniff(Buffer.alloc(10)), null);
});
test('open: a table with a column type the reader does not know is listed with a note, not a crash', () => {
  const db = A.open(rd(path.join(FIX, 'unsupportedFieldsTestV2007.accdb')));
  const t = db.tables[0];
  assert.match(t.error, /column type the reader does not support/);
  assert.throws(() => A.readTable(db, t.name), (e) => e.kind === 'damaged');
});

// ---------- values ----------
test('values: dates, currency, booleans, memo text, OLE and binary are shown safely', () => {
  const db = shopAccdb();
  const c = A.readTable(db, 'Customers');
  const ci = (n) => c.columns.findIndex((x) => x.name === n);
  assert.equal(V.cellText(c.rows[0][ci('Joined')], 'datetime'), '2019-01-01');
  assert.equal(V.cellText(c.rows[0][ci('Active')], 'boolean'), 'No');
  const memo = c.rows[0][ci('Notes')];
  assert.match(memo, /<b>tags are text here<\/b> & so is this\./);
  assert.match(V.cellText(memo, 'memo'), /Prefers delivery before noon\. ↵ Call ahead/);
  assert.equal(V.cellDetail(memo, 'memo').text, memo);
  const p = A.readTable(db, 'Products');
  const pic = p.rows[0][p.columns.findIndex((x) => x.name === 'Picture')];
  assert.ok(V.isBytes(pic));
  assert.equal(V.cellText(pic, 'ole'), `OLE object (PNG image), ${pic.length} bytes`);
  assert.match(V.cellDetail(pic, 'ole').note, /Shown as hex only: nothing in it is opened or run/);
  assert.match(V.cellDetail(pic, 'ole').text, /^000000  89 50 4e 47/);
  assert.equal(V.cellText(p.rows[0][p.columns.findIndex((x) => x.name === 'UnitPrice')], 'currency'), '3.50');
  assert.equal(V.currencyText('1.2345'), '1.2345');
  assert.equal(V.currencyText('-7.1000'), '-7.10');
  assert.equal(V.extDateText('2020.06.17 00:00:00.000000000'), '2020-06-17');
  assert.equal(V.extDateText('2020.06.17 13:01:02.500000000'), '2020-06-17 13:01:02.5');
  assert.equal(V.dateText(new Date(Date.UTC(2025, 2, 4, 9, 13, 0))), '2025-03-04 09:13:00');
  assert.equal(V.cellText(null, 'text'), '');
  assert.equal(V.cellText(42n, 'bigint'), '42');
});
test('values: attachments list names and sizes; a complex column that cannot be read is marked, the rest still reads', () => {
  const att = A.open(rd(path.join(FIX, 'attachments.accdb')));
  const t = A.readTable(att, 'Table1');
  const a = t.rows[2][2];
  assert.equal(V.cellText(a, 'complex'), '3 attachments: attachment1.txt, attachment2.txt, attachment3.txt');
  assert.match(V.cellDetail(a, 'complex').text, /attachment2\.txt {2}\(txt, 12 bytes\)/);
  const cx = A.open(rd(path.join(FIX, 'complexDataTestV2010.accdb')));
  const r = A.readTable(cx, 'Table1');
  assert.equal(r.rows.length, 4);
  assert.ok(Object.keys(r.colErrors).length >= 1);
  const memoCol = r.columns.findIndex((x) => x.name === 'memo-data');
  assert.equal(r.rows[1][memoCol], 'row2-memo');
  const bad = r.columns.findIndex((x) => r.colErrors[x.name]);
  assert.equal(V.cellText(r.rows[0][bad], 'complex'), '(not read)');
  const attCol = r.columns.findIndex((x) => x.name === 'attach-data');
  assert.ok(!r.colErrors['attach-data']);
  assert.match(V.cellText(r.rows[1][attCol], 'complex'), /test_data\.txt/);
});
test('values: Access type names and text sizes in characters (Jet 4 and ACE store 2 bytes a character)', () => {
  const db = shopAccdb();
  const c = db.tables.find((t) => t.name === 'Customers').columns;
  assert.deepEqual(c.map((x) => V.typeName(x, false)), ['AutoNumber (Long Integer)', 'Short Text (80)', 'Short Text (50)', 'Short Text (50)', 'Short Text (120)', 'Date/Time', 'Yes/No', 'Long Text (Memo)']);
  const j3 = A.open(rd(path.join(FIX, 'jet3-test.mdb')));
  const col = j3.tables[0].columns[0];
  assert.equal(V.typeName(col, true), `Short Text (${col.size})`);
});
test('values: CSV fields are quoted when needed and JSON values keep exact decimals', () => {
  assert.equal(V.csvField('a,b', 'text'), '"a,b"');
  assert.equal(V.csvField('say "hi"', 'text'), '"say ""hi"""');
  assert.equal(V.csvField('two\nlines', 'memo'), '"two\nlines"');
  assert.equal(V.csvField(null, 'text'), '');
  assert.equal(V.csvField(true, 'boolean'), 'true');
  assert.equal(V.csvField('3.5000', 'currency'), '3.50');
  assert.equal(V.jsonValue('3.5000', 'currency'), 3.5);
  assert.equal(V.jsonValue('12345678901234567890.1234', 'numeric'), '12345678901234567890.1234');
  assert.equal(V.jsonValue(new Date(Date.UTC(2019, 0, 1)), 'datetime'), '2019-01-01T00:00:00');
  assert.deepEqual(V.jsonValue(Buffer.from([1, 2, 3]), 'ole'), { base64: 'AQID', bytes: 3 });
});

// ---------- filter, sort, page ----------
test('grid: filter text over all columns or one column, sort up and down with nulls last, paging', () => {
  const db = shopAccdb();
  const t = A.readTable(db, 'Orders');
  const st = t.columns.findIndex((c) => c.name === 'Status');
  const want = t.rows.filter((r) => r[st] === 'Returned').length;
  const idx = G.order(t, { filter: 'returned', col: st });
  assert.equal(idx.length, want);
  assert.ok(want > 10);
  const total = t.columns.findIndex((c) => c.name === 'Total');
  const asc = G.order(t, { sort: total });
  const vals = asc.map((i) => Number(t.rows[i][total]));
  assert.deepEqual(vals, [...vals].sort((a, b) => a - b));
  const desc = G.order(t, { sort: total, desc: true });
  assert.equal(Number(t.rows[desc[0]][total]), Math.max(...vals));
  const pg = G.page(t, asc, 200, 100);
  assert.equal(pg.offset, 200);
  assert.equal(pg.rows.length, 40);
  assert.equal(pg.total, 240);
  assert.equal(pg.shown, 240);
  const c = A.readTable(db, 'Customers');
  const notes = c.columns.findIndex((x) => x.name === 'Notes');
  const sorted = G.order(c, { sort: notes });
  const firstNull = sorted.findIndex((i) => c.rows[i][notes] === null);
  assert.ok(firstNull > 0 && sorted.slice(firstNull).every((i) => c.rows[i][notes] === null));
  const p0 = G.page(c, sorted, 0, 5);
  assert.ok(p0.rows.every((r) => r.cells.length === c.columns.length));
  assert.equal(G.order(c, { filter: 'zzzz-not-there' }).length, 0);
});

// ---------- CSV and JSON ----------
test('CSV: a header line, one line per row, CRLF line ends, memo with line breaks quoted', () => {
  const db = shopAccdb();
  const t = A.readTable(db, 'Customers');
  const csv = C.toCsv(t);
  assert.ok(csv.startsWith('CustomerID,Name,City,Country,Email,Joined,Active,Notes\r\n1,Ana Silva,Lisbon,Portugal,ana.silva@example.com,2019-01-01,false,"Prefers delivery before noon.\nCall ahead'));
  const records = csv.split(/\r\n(?=(?:[^"]*"[^"]*")*[^"]*$)/).filter(Boolean);
  assert.equal(records.length, 49);
});
test('JSON: one document with every table; rows as objects', () => {
  const db = shopAccdb();
  const doc = JSON.parse(C.toJsonDoc('zovo-demo-shop.accdb', db.tables.map((t) => ({ name: t.name, data: A.readTable(db, t.name) }))));
  assert.equal(doc.source, 'zovo-demo-shop.accdb');
  assert.deepEqual(Object.keys(doc.tables), ['Customers', 'OrderLines', 'Orders', 'Products', 'Shippers']);
  assert.equal(doc.tables.Orders.length, 240);
  assert.equal(doc.tables.Products[0].UnitPrice, 3.5);
  assert.equal(doc.tables.Products[0].Picture.bytes > 50, true);
  assert.equal(doc.tables.Customers[0].Joined, '2019-01-01T00:00:00');
  assert.equal(C.safeName('a/b:c*?'), 'a_b_c__');
});

// ---------- SQL DDL ----------
test('DDL: every dialect has a CREATE TABLE per table with mapped types; AutoNumber per dialect', () => {
  const db = shopAccdb();
  const pg = C.toDdl(db, 'shop.accdb', 'postgres');
  assert.equal((pg.match(/^CREATE TABLE /gm) || []).length, 5);
  assert.match(pg, /"CustomerID" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL/);
  assert.match(pg, /"Name" varchar\(80\)/);
  assert.match(pg, /"UnitPrice" numeric\(19,4\)/);
  assert.match(pg, /"Picture" bytea/);
  assert.match(pg, /Indexes, keys and relationships are not included/);
  const my = C.toDdl(db, 'shop.accdb', 'mysql');
  assert.match(my, /`CustomerID` INT AUTO_INCREMENT UNIQUE NOT NULL/);
  assert.match(my, /`Joined` DATETIME/);
  const ms = C.toDdl(db, 'shop.accdb', 'sqlserver');
  assert.match(ms, /\[CustomerID\] INT IDENTITY\(1,1\) NOT NULL/);
  assert.match(ms, /\[Name\] NVARCHAR\(80\)/);
  assert.match(ms, /\[UnitPrice\] MONEY/);
  assert.throws(() => C.toDdl(db, 'x', 'oracle'), /Unknown SQL dialect/);
});
test('DDL: the SQLite statements run in SQLite and make the same tables and columns', async () => {
  const db = shopMdb();
  const sql = C.toDdl(db, 'shop.mdb', 'sqlite');
  const SQL = await C.loadSql();
  const d = new SQL.Database();
  d.exec(sql);
  const names = d.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")[0].values.map((v) => v[0]);
  assert.deepEqual(names, ['Customers', 'OrderLines', 'Orders', 'Products', 'Shippers']);
  const cols = d.exec('PRAGMA table_info("Products")')[0].values.map((v) => `${v[1]} ${v[2]}`);
  assert.deepEqual(cols, ['ProductID INTEGER', 'SKU TEXT', 'ProductName TEXT', 'Category TEXT', 'UnitPrice NUMERIC', 'InStock INTEGER', 'WeightKg REAL', 'Discontinued INTEGER', 'Picture BLOB']);
  d.close();
});
test('DDL: a table that cannot be read is left out and named in the header', () => {
  const db = A.open(rd(path.join(FIX, 'unsupportedFieldsTestV2007.accdb')));
  const sql = C.toDdl(db, 'u.accdb', 'sqlite');
  assert.match(sql, /-- Left out \(could not be read\): /);
  assert.equal((sql.match(/^CREATE TABLE /gm) || []).length, 0);
});

// ---------- SQLite ----------
test('SQLite export: every table with every row; values typed; read back with the same counts', async () => {
  const db = shopAccdb();
  const r = await C.toSqlite(db, (n) => A.readTable(db, n));
  assert.deepEqual(r.tables.map((t) => [t.name, t.rows]), [['Customers', 48], ['OrderLines', 600], ['Orders', 240], ['Products', 20], ['Shippers', 3]]);
  assert.deepEqual(await C.sqliteCounts(r.bytes), r.tables.map((t) => ({ name: t.name, rows: t.rows })));
  const SQL = await C.loadSql();
  const d = new SQL.Database(r.bytes);
  const row = d.exec('SELECT Name, Joined, Active, Notes FROM Customers WHERE CustomerID = 1')[0].values[0];
  assert.deepEqual(row.slice(0, 3), ['Ana Silva', '2019-01-01 00:00:00', 0]);
  assert.match(row[3], /^Prefers delivery before noon\.\nCall ahead/);
  const p = d.exec('SELECT UnitPrice, typeof(Picture), length(Picture) FROM Products WHERE ProductID = 1')[0].values[0];
  assert.deepEqual(p.slice(0, 2), [3.5, 'blob']);
  assert.ok(p[2] > 50);
  const sum = d.exec('SELECT ROUND(SUM(Total), 2) FROM Orders')[0].values[0][0];
  const t = A.readTable(db, 'Orders');
  const ti = t.columns.findIndex((c) => c.name === 'Total');
  assert.equal(sum, Math.round(t.rows.reduce((a, x) => a + Number(x[ti]), 0) * 100) / 100);
  d.close();
});
test('SQLite export: attachments go to a side table with their bytes', async () => {
  const db = A.open(rd(path.join(FIX, 'attachments.accdb')));
  const r = await C.toSqlite(db, (n) => A.readTable(db, n));
  assert.equal(r.tables[0].attachments, 4);
  const SQL = await C.loadSql();
  const d = new SQL.Database(r.bytes);
  const rows = d.exec('SELECT "row", file_name, CAST(data AS TEXT) FROM "Table1__attachments" ORDER BY "row", file_name')[0].values;
  assert.deepEqual(rows[rows.length - 1], [3, 'attachment3.txt', 'Attachment 3']);
  d.close();
});

// ---------- compare ----------
test('compare: our shop A and B: Shippers only in A, Suppliers only in B, the Phone column and row counts', () => {
  const a = shopAccdb();
  const b = A.open(rd(path.join(FIX, 'zovo-demo-shop-v2.accdb')));
  const r = C.compare(a, b);
  assert.deepEqual(r.onlyA, [{ name: 'Shippers', rows: 3 }]);
  assert.deepEqual(r.onlyB, [{ name: 'Suppliers', rows: 2 }]);
  const cust = r.both.find((t) => t.name === 'Customers');
  assert.deepEqual([cust.rowsA, cust.rowsB, cust.colsOnlyA, cust.colsOnlyB], [48, 52, [], ['Phone']]);
  const prod = r.both.find((t) => t.name === 'Products');
  assert.equal(prod.changed, false);
  assert.equal(r.changed, 3);
  assert.equal(r.same, 1);
  const md = C.compareMarkdown(r, 'zovo-demo-shop.accdb', 'zovo-demo-shop-v2.accdb');
  assert.match(md, /^# Access database comparison/);
  assert.match(md, /## Tables only in A \(1\)\n\n- `Shippers` \(3 rows\)/);
  assert.match(md, /\| Customers \| 48 \| 52 \| \+4 \|  \| Phone \|  \|/);
});
test('compare: an MDB with the same tables as an ACCDB: same names, Jet text sizes compared in characters', () => {
  const r = C.compare(shopMdb(), shopAccdb());
  assert.equal(r.onlyA.length + r.onlyB.length, 0);
  assert.equal(r.changed, 0);
  assert.equal(r.same, 5);
});
