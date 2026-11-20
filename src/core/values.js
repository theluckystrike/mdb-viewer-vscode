'use strict';
// Cell values of an Access table as the reader returns them, and the ways this extension shows and writes them.
// Text is never turned into HTML here: the webview puts it into the page with textContent.

/** Marks a cell of a complex column that could not be read. */
const UNREAD = Object.freeze({ unread: true });

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Access date/time values have no time zone: the reader gives them as UTC Dates with the stored clock time. */
function dateText(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const h = d.getUTCHours(), m = d.getUTCMinutes(), s = d.getUTCSeconds();
  return h || m || s ? `${day} ${pad(h)}:${pad(m)}:${pad(s)}` : day;
}
/** ISO form for JSON and SQLite: 2025-03-04T09:13:00 (no zone, as stored). */
function dateIso(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
/** Date/Time Extended values come as "2020.06.17 00:00:00.000000000". */
function extDateText(s) {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})(?: (\d{2}:\d{2}:\d{2})(\.\d+)?)?$/.exec(String(s));
  if (!m) return String(s);
  const frac = m[5] && /[1-9]/.test(m[5]) ? m[5].replace(/0+$/, '') : '';
  return m[4] && (m[4] !== '00:00:00' || frac) ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}${frac}` : `${m[1]}-${m[2]}-${m[3]}`;
}
/** Currency comes as a string with 4 decimals ("3.5000"): keep at least 2 decimals, drop zeros after them. */
function currencyText(s) {
  const m = /^(-?\d+)\.(\d+)$/.exec(String(s));
  if (!m) return String(s);
  let d = m[2].replace(/0+$/, '');
  if (d.length < 2) d = d.padEnd(2, '0');
  return `${m[1]}.${d}`;
}

const isBytes = (v) => v instanceof Uint8Array;
const isAttachments = (v) => Array.isArray(v) && v.every((a) => a && typeof a === 'object' && 'name' in a && 'data' in a);

/** What an OLE object or binary value holds, from its first bytes. Nothing is opened, rendered or run. */
function blobKind(b) {
  if (!isBytes(b) || !b.length) return '';
  const head = Buffer.from(b.subarray(0, Math.min(b.length, 8192)));
  const at = (sig, off = 0) => head.length >= off + sig.length && sig.every((x, i) => head[off + i] === x);
  const sigs = [
    [[0x89, 0x50, 0x4e, 0x47], 'PNG image'], [[0xff, 0xd8, 0xff], 'JPEG image'], [[0x47, 0x49, 0x46, 0x38], 'GIF image'],
    [[0x42, 0x4d], 'BMP image'], [[0x25, 0x50, 0x44, 0x46], 'PDF document'], [[0x50, 0x4b, 0x03, 0x04], 'ZIP or Office file'],
    [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 'OLE compound file'], [[0x49, 0x49, 0x2a, 0x00], 'TIFF image'], [[0x4d, 0x4d, 0x00, 0x2a], 'TIFF image'],
    [[0x52, 0x49, 0x46, 0x46], 'RIFF media'],
  ];
  for (const [s, k] of sigs) if (at(s)) return k;
  // Access wraps OLE objects in a header (0x15 0x1C) that names the class, e.g. "Bitmap Image", "Package", "Word.Document.8".
  if (head[0] === 0x15 && head[1] === 0x1c) {
    const nameLen = head.readUInt16LE(4), classLen = head.readUInt16LE(6);
    const off = head.readUInt16LE(2);
    const cls = head.toString('latin1', 20 + nameLen, 20 + nameLen + classLen).replace(/\0.*$/, '');
    let inner = '';
    for (const [s, k] of sigs) { const i = head.indexOf(Buffer.from(s), Math.min(off, head.length)); if (i >= 0 && i < 4096) { inner = k; break; } }
    const c = cls && /^[\x20-\x7e]+$/.test(cls) ? cls : 'OLE object';
    return inner ? `${c}, ${inner}` : c;
  }
  return '';
}

const bytesText = (n) => `${n.toLocaleString('en-US')} ${n === 1 ? 'byte' : 'bytes'}`;

/** One line for the grid. type: the column type of the reader. Long text is cut at max characters. */
function cellText(v, type, max = 200) {
  if (v === null || v === undefined) return '';
  if (v === UNREAD) return '(not read)';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return dateText(v);
  if (isBytes(v)) {
    const k = blobKind(v);
    if (type === 'ole') return `OLE object${k && k !== 'OLE object' ? ` (${k})` : ''}, ${bytesText(v.length)}`;
    return `${k ? `${k}, ` : 'Binary, '}${bytesText(v.length)}`;
  }
  if (isAttachments(v)) return v.length ? `${v.length} ${v.length === 1 ? 'attachment' : 'attachments'}: ${v.map((a) => a.name).join(', ')}`.slice(0, max) : '';
  if (Array.isArray(v)) return v.map((x) => cellText(x, '', 80)).join('; ').slice(0, max);
  if (type === 'currency') return currencyText(v);
  if (type === 'datetimextended') return extDateText(v);
  const s = String(v);
  const one = s.replace(/\r\n|\r|\n/g, ' ↵ ');
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

/** A short hex dump of the first bytes (the detail pane for binary and OLE cells). */
function hexDump(b, max = 256) {
  const u = Buffer.from(b.subarray(0, Math.min(b.length, max)));
  const out = [];
  for (let i = 0; i < u.length; i += 16) {
    const row = u.subarray(i, i + 16);
    const hex = [...row].map((x) => x.toString(16).padStart(2, '0')).join(' ');
    const asc = [...row].map((x) => (x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : '.')).join('');
    out.push(`${i.toString(16).padStart(6, '0')}  ${hex.padEnd(47)}  ${asc}`);
  }
  if (b.length > max) out.push(`... ${bytesText(b.length - max)} more`);
  return out.join('\n');
}

/** The whole value for the detail pane and Copy: { text, note }. */
function cellDetail(v, type, maxChars = 1000000) {
  if (v === null || v === undefined) return { text: '', note: 'Null (no value).' };
  if (v === UNREAD) return { text: '', note: 'This column could not be read.' };
  if (isBytes(v)) {
    const k = blobKind(v);
    return { text: hexDump(v), note: `${type === 'ole' ? 'OLE object' : 'Binary value'}${k ? ` (${k})` : ''}, ${bytesText(v.length)}. Shown as hex only: nothing in it is opened or run.` };
  }
  if (isAttachments(v)) {
    return { text: v.map((a) => `${a.name}  (${a.type || 'file'}, ${bytesText(a.data ? a.data.length : 0)})`).join('\n'), note: `${v.length} ${v.length === 1 ? 'attachment' : 'attachments'}. The files are listed by name and size only: nothing is opened or run.` };
  }
  if (type === 'memo' || type === 'text') {
    const s = String(v);
    return { text: s.length > maxChars ? s.slice(0, maxChars) : s, note: s.length > maxChars ? `First ${maxChars.toLocaleString('en-US')} of ${s.length.toLocaleString('en-US')} characters.` : `${s.length.toLocaleString('en-US')} characters.` };
  }
  return { text: cellText(v, type, maxChars), note: '' };
}

/** The value Copy puts on the clipboard: text as it is, other values as the grid shows them. */
function copyText(v, type) {
  if (v === null || v === undefined || v === UNREAD) return '';
  if (typeof v === 'string' && type !== 'currency' && type !== 'datetimextended') return v;
  return cellText(v, type, Infinity);
}

/** Sort key: numbers, dates and text compare by value; null and unread cells go last. */
function sortKey(v, type) {
  if (v === null || v === undefined || v === UNREAD) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) return v.getTime();
  if (type === 'currency' || type === 'numeric') { const n = Number(v); return Number.isFinite(n) ? n : String(v); }
  if (isBytes(v)) return v.length;
  if (Array.isArray(v)) return v.length;
  return String(v).toLowerCase();
}

/** Access type name for the schema view. */
function typeName(c, jet3) {
  switch (c.type) {
    case 'text': return `Short Text (${textChars(c, jet3)})`;
    case 'memo': return 'Long Text (Memo)';
    case 'byte': return 'Number (Byte)';
    case 'integer': return 'Number (Integer)';
    case 'long': return c.autoLong ? 'AutoNumber (Long Integer)' : 'Number (Long Integer)';
    case 'float': return 'Number (Single)';
    case 'double': return 'Number (Double)';
    case 'currency': return 'Currency';
    case 'datetime': return 'Date/Time';
    case 'datetimextended': return 'Date/Time Extended';
    case 'boolean': return 'Yes/No';
    case 'binary': return `Binary (${c.size || 0} bytes)`;
    case 'ole': return 'OLE Object';
    case 'repid': return c.autoUUID ? 'AutoNumber (Replication ID)' : 'Number (Replication ID)';
    case 'numeric': return `Number (Decimal ${c.precision || 0},${c.scale || 0})`;
    case 'bigint': return 'Large Number';
    case 'complex': return 'Attachment or multi-value';
    default: return c.type;
  }
}

/** Text columns: the reader gives the size in bytes; Jet 4 and ACE store 2 bytes per character. */
function textChars(c, jet3) { return jet3 ? c.size : Math.max(1, Math.floor((c.size || 0) / 2)); }

/** CSV field (RFC 4180): quoted when it holds a comma, a quote, or a line break. */
function csvField(v, type) {
  if (v === null || v === undefined || v === UNREAD) return '';
  let s;
  if (v instanceof Date) s = dateText(v);
  else if (typeof v === 'boolean') s = v ? 'true' : 'false';
  else if (isBytes(v)) s = Buffer.from(v).toString('base64');
  else if (isAttachments(v)) s = v.map((a) => a.name).join('; ');
  else if (type === 'currency') s = currencyText(v);
  else if (type === 'datetimextended') s = extDateText(v);
  else s = String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** JSON value. Dates as ISO text, binary as base64, exact decimals as numbers when they stay exact. */
function jsonValue(v, type) {
  if (v === null || v === undefined || v === UNREAD) return null;
  if (v instanceof Date) return dateIso(v);
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (isBytes(v)) return { base64: Buffer.from(v).toString('base64'), bytes: v.length };
  if (isAttachments(v)) return v.map((a) => ({ name: a.name, type: a.type || '', bytes: a.data ? a.data.length : 0, base64: a.data ? Buffer.from(a.data).toString('base64') : '' }));
  if (type === 'currency' || type === 'numeric') {
    const n = Number(v);
    return Number.isFinite(n) && String(n) === String(v).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') ? n : String(v);
  }
  if (type === 'datetimextended') return extDateText(v);
  return v;
}

module.exports = {
  UNREAD, dateText, dateIso, extDateText, currencyText, blobKind, cellText, cellDetail, copyText, hexDump, sortKey, typeName,
  textChars, csvField, jsonValue, isBytes, isAttachments, bytesText,
};
