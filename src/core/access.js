'use strict';
// Reads Microsoft Access databases (.mdb Jet 3 and Jet 4, .accdb ACE 12 to 17, and the compiled .mde/.accde) from a
// byte buffer, read-only, with the vendored mdb-reader (lib/mdb-reader.js, MIT). No vscode import: the viewer, the
// Pro tools and the unit tests share this file. Nothing here writes to the database file.
const MDBReader = require('../../lib/mdb-reader.js').default;
const V = require('./values');

const ENGINES = {
  0: { label: 'Jet 3', version: 'Access 97', page: 2048 },
  1: { label: 'Jet 4', version: 'Access 2000 to 2003', page: 4096 },
  2: { label: 'ACE 12', version: 'Access 2007', page: 4096 },
  3: { label: 'ACE 14', version: 'Access 2010', page: 4096 },
  4: { label: 'ACE 15', version: 'Access 2013', page: 4096 },
  5: { label: 'ACE 16', version: 'Access 2016', page: 4096 },
  6: { label: 'ACE 17', version: 'Access 2019 or later', page: 4096 },
};

class AccessError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

/** The engine facts of a file from its first page, or null when it is not an Access database. */
function sniff(buf) {
  if (!buf || buf.length < 0x20) return null;
  if (buf[0] !== 0 || buf[1] !== 1 || buf[2] !== 0 || buf[3] !== 0) return null;
  const name = Buffer.from(buf.subarray(4, 19)).toString('latin1');
  if (name !== 'Standard Jet DB' && name !== 'Standard ACE DB' && name !== 'MSISAM Database') return null;
  const v = buf[0x14];
  const e = ENGINES[v];
  if (!e) return { engine: name, code: v, label: `unknown version ${v}`, version: '', page: 4096, supported: false };
  return { engine: name, code: v, label: name === 'MSISAM Database' ? 'MSISAM' : e.label, version: e.version, page: e.page, supported: true, ace: name === 'Standard ACE DB' };
}

/** Plain words for an error thrown while reading the file. */
function damageText(e) {
  const m = String((e && e.message) || e);
  if (/out of range|outside buffer|ERR_OUT_OF_RANGE|ERR_BUFFER_OUT_OF_BOUNDS|Attempt to access memory outside/i.test(m)) return 'A page points past the end of the file.';
  return m;
}

/**
 * Opens a database buffer. opts.password: the password the user typed (only asked when the file needs one).
 * Throws AccessError with kind 'notaccess', 'cut', 'password', 'badpassword' or 'damaged'.
 * Returns { reader, info, tables, system, linked, created, sortOrder }.
 */
function open(buf, opts = {}) {
  const info = sniff(buf);
  if (!info) throw new AccessError('notaccess', 'This file is not a Microsoft Access database: it does not start with the Jet or ACE file header.');
  if (!info.supported) throw new AccessError('damaged', `This Access file uses an engine version this viewer does not know (${info.code}).`);
  if (buf.length < info.page * 2) throw new AccessError('cut', `The file is cut off: it holds ${buf.length.toLocaleString('en-US')} bytes, less than two ${info.page.toLocaleString('en-US')}-byte pages.`);
  const pw = typeof opts.password === 'string' ? opts.password : '';
  let reader;
  try {
    reader = new MDBReader(Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength), { password: pw });
  } catch (e) {
    const m = String((e && e.message) || e);
    if (/wrong password/i.test(m)) {
      throw new AccessError(pw ? 'badpassword' : 'password', pw ? 'That password does not open this database.' : 'This database is protected with a password.');
    }
    if (buf.length % info.page) throw new AccessError('cut', `The file is cut off or damaged: its size is not a whole number of ${info.page.toLocaleString('en-US')}-byte pages. ${damageText(e)}`);
    throw new AccessError('damaged', `The database could not be read: ${damageText(e)}`);
  }
  // Jet 3 and Jet 4 keep the database password in the header, and the pages are not encrypted. Ask for it anyway, the
  // same way Access does, and show nothing before the right one is typed. The password itself is never shown.
  let stored = null;
  try { stored = reader.getPassword(); } catch (e) { stored = null; }
  if (stored && !info.ace) {
    if (!pw) throw new AccessError('password', 'This database is protected with a password.');
    if (pw !== stored) throw new AccessError('badpassword', 'That password does not open this database.');
  }
  let names = [], system = [], linked = [];
  try {
    names = reader.getTableNames();
    system = reader.getTableNames({ normalTables: false, systemTables: true });
    linked = reader.getTableNames({ normalTables: false, linkedTables: true });
  } catch (e) {
    throw new AccessError('damaged', `The table list (MSysObjects) could not be read: ${damageText(e)}`);
  }
  const tables = names.map((n) => tableInfo(reader, n, false)).sort(byName);
  const sys = system.map((n) => tableInfo(reader, n, true)).sort(byName);
  let created = null;
  try { const d = reader.getCreationDate(); created = d && !Number.isNaN(d.getTime()) ? d : null; } catch (e) { created = null; }
  return { reader, info, tables, system: sys, linked: linked.slice().sort((a, b) => a.localeCompare(b)), created, protectedByPassword: !!(stored || (info.ace && pw)) };
}

const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

/** Name, row count and columns of one table; error holds the reason when its definition could not be read. */
function tableInfo(reader, name, system) {
  const t = { name, system, rows: 0, columns: [], error: '' };
  try {
    const tb = reader.getTable(name);
    t.rows = tb.rowCount;
    t.columns = tb.getColumns().map((c) => ({
      name: c.name, type: c.type, size: c.size, nullable: !!c.nullable, fixedLength: !!c.fixedLength, autoLong: !!c.autoLong, autoUUID: !!c.autoUUID,
      precision: c.precision, scale: c.scale, complex: !!c.complex,
    }));
  } catch (e) {
    t.error = /Unsupported column type/.test(String(e && e.message)) ? 'This table has a column type the reader does not support, so its columns and rows cannot be shown.' : `This table could not be read: ${damageText(e)}`;
  }
  return t;
}

/** The table entry of db by name (user, then system tables). */
function findTable(db, name) {
  return db.tables.find((t) => t.name === name) || db.system.find((t) => t.name === name) || null;
}

/**
 * Reads every row of a table. Complex columns (attachments, multi-value lists, version history) are read one by one,
 * so one that fails leaves the rest readable. Returns { columns, rows (arrays of raw values), colErrors }.
 */
function readTable(db, name) {
  const t = findTable(db, name);
  if (!t) throw new AccessError('damaged', `There is no table named ${name}.`);
  if (t.error) throw new AccessError('damaged', t.error);
  const tb = db.reader.getTable(name);
  const cols = t.columns;
  const plain = cols.filter((c) => !c.complex).map((c) => c.name);
  const colErrors = Object.create(null);
  let data;
  try {
    data = plain.length ? tb.getData({ columns: plain }) : null;
  } catch (e) {
    throw new AccessError('damaged', `The rows of ${name} could not be read: ${damageText(e)}`);
  }
  const extra = Object.create(null);
  for (const c of cols.filter((x) => x.complex)) {
    try { extra[c.name] = tb.getData({ columns: [c.name] }).map((r) => r[c.name]); } catch (e) {
      colErrors[c.name] = 'This multi-value, attachment or version history column could not be read.';
      extra[c.name] = null;
    }
  }
  const n = data ? data.length : (Object.values(extra).find(Array.isArray) || []).length;
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = data ? data[i] : {};
    rows[i] = cols.map((c) => {
      if (!c.complex) return r[c.name] === undefined ? null : r[c.name];
      const e = extra[c.name];
      return e ? (e[i] === undefined ? null : e[i]) : V.UNREAD;
    });
  }
  return { columns: cols, rows, colErrors };
}

/** File facts for the side pane and the reports. */
function facts(db, size) {
  const i = db.info;
  const rows = db.tables.reduce((a, t) => a + (t.rows || 0), 0);
  return {
    format: i.ace ? 'ACCDB' : 'MDB',
    engine: `${i.label}${i.version ? ` (${i.version})` : ''}`,
    pageSize: i.page,
    size,
    tables: db.tables.length,
    rows,
    system: db.system.length,
    linked: db.linked.length,
    created: db.created ? V.dateText(db.created) : '',
    password: !!db.protectedByPassword,
  };
}

module.exports = { open, sniff, readTable, findTable, tableInfo, facts, AccessError, ENGINES };
