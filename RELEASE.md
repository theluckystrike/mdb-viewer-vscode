# MDB Viewer & ACCDB, Access DB 0.1.0 (zovo.zovo-mdb-viewer)

New listing, staged only. NEWB15-picks row 4, built by lane NEWB15 (seat zovo-team2). Not published, not pushed.

- vsix: out/NEWB15-dist/zovo.zovo-mdb-viewer/zovo.zovo-mdb-viewer-0.1.0.vsix
- sha256: 02e45b8b4828a2c455998ec7d9be63374010fb451203e926859c843740681287 (812,684 bytes, 39 files)
- Product repo: factory/products/mdb-viewer-vscode. Local commits only, no remote.
- Unit tests: 279 of 279 pass with `npm test` (scripts/test.js runs every test/*.test.js file with the Node test runner).
- Real-app gate: VS Code 1.142.0 on CDP port 9474, through buildslot. The final run is r1 on this exact vsix: 94 PASS, 0 FAIL. Results: out/NEWB15-data/mdb/mdb-gate-r1.json and .tsv, and gate-r1.log.
- Earlier runs: dev1 had 87 PASS and 8 FAIL. dev2 had 95 PASS and 0 FAIL; it also took the README screenshot, which adds 1 row.

## What it is

- Display name: MDB Viewer & ACCDB, Access DB (29 characters). The description starts with "MDB viewer".
- Keywords: mdb, accdb, access, database, jet.
- engines.vscode is ^1.75.0.
- Activation is onUri only, plus the implicit custom editor and command events. There is no "*" and no onStartupFinished.
- Free core: a read-only custom editor `mdbViewer.database`, the default for *.mdb, *.mde, *.accdb and *.accde.
  - It opens Jet 3 (Access 97) and Jet 4 (2000 to 2003) .mdb files, and ACE 12 to 17 (2007 and later) .accdb files.
  - Table list with row counts. System tables are hidden until you tick System tables. Linked tables are listed by name.
  - Rows in pages of 50 to 1,000. Sort by a column over the whole table. Filter text over all columns or one.
  - Copy cell, Copy row (tab separated), and the full value of the selected cell.
  - Memo text shows as text. OLE and binary values show their size, kind and a hex view. Attachments show file names and sizes.
  - The Schema tab gives every column's Access type and whether it is required.
  - Password and encrypted files ask for the password. It is not stored.
  - Plain notes for a file that is not Access, a cut file, an empty file, and a table with an unsupported column type.
- Zovo Pro tools: all 4 from the row are built. Each has 1 free try.
  - Module settings: 2026-11-19.trial2, listing "mdb", tries key mdbViewer.proTrial, TRIES = 1 in src/pro.js.
  - The proinfo file is factory/sprint/license/proinfo/mdb.json, without triesMax.
  1. Export to CSV and JSON: one table or all tables, CSV files in a folder, or one JSON file. A result panel follows.
  2. Export to SQLite: every table goes into one .db file, written with sql.js. Attachments go to a side table. Row counts are read back from the new file.
  3. Schema as SQL: CREATE TABLE statements in the SQLite, PostgreSQL, MySQL or SQL Server dialect.
  4. Compare two Access files: tables only in A or in B, columns added or removed, type changes and row counts. The report can be saved as Markdown.
- Kill-switch setting: zovo.mdb.trial.enabled (default true).
- src/license/*.js is byte-identical to factory/sprint/license; config.js is the one apply.sh generates. src/rate.js is byte-identical to factory/sprint/rating. All were checked with cmp just before the final package.
- Third-party code, all MIT, listed in THIRD-PARTY-NOTICES.md:
  - lib/mdb-reader.js: mdb-reader 3.2.2 and its MIT XML helpers, bundled with esbuild.
  - lib/sql-wasm.js and lib/sql-wasm.wasm: sql.js 1.13.0, unchanged. The SQLite inside is public domain.
  - src/ is not bundled.

## Samples used

- Shipped in the vsix:
  - samples/zovo-demo-shop.accdb and samples/zovo-demo-shop.mdb hold made-up shop data.
  - They were made with scripts/make-samples.groovy and Jackcess (Apache-2.0), which ran only as a local tool. MIT.
- Unit-test fixtures (test/fixtures, not in the vsix; sources in test/fixtures/SOURCES.md):
  - mdb-reader test data (MIT): jet3-test.mdb, V2003_with-password.mdb, V2010_with-password.accdb, attachments.accdb.
  - Jackcess test data (Apache-2.0): complexDataTestV2010.accdb, unsupportedFieldsTestV2007.accdb.
  - Ours: zovo-demo-shop-v2.accdb.
- Real-app gate files were downloaded once into newb15-work/mdb/dl, each file in its own folder. They were never executed.
  - From https://github.com/andipaetzold/mdb-reader test data (MIT):
    - test/data/V1997/test.mdb, test/data/V2010/test.accdb
    - test/data/real/ASampleDatabase.accdb, test/data/V2016/attachments.accdb
    - V2003_with-password.mdb (password test data)
    - office-agile-4.4.accdb (encryption test data; the exact path in the repo is inferred from the download folder name)
  - From https://github.com/jahlborn/jackcess src/test/data (Apache-2.0):
    - testIndexCodesV2003.mdb, testEmoticonsV2010.accdb, extDateTestV2019.accdb
    - linkerTestV2007.accdb, complexDataTestV2010.accdb, unsupportedFieldsTestV2007.accdb
  - Made by the gate: SHOP.MDB (an upper-case copy of our sample), a text file named .mdb, an ACCDB cut after 3,000 bytes, and an empty .mdb.
  - The gate takes its expected values from the original mdb-reader npm package, not from the product code. It checks SQLite output with /usr/bin/sqlite3.

## Gate coverage (r1)

- Free core (21 rows):
  - Nothing pops up on start. The sample ACCDB opens by default.
  - 5 tables with counts that match the npm reader. Customers shows 48 rows and 8 typed columns. The file facts are correct.
  - Paging works (240 Orders in pages of 100). Sort ascending and descending matches the gate's own sort. The filter finds 40 matches.
  - A memo cell keeps its line breaks and shows "<b>" as text. Copy cell and Copy row reach the clipboard; the gate restores the clipboard afterwards.
  - The OLE cell shows size and kind, and its hex view starts with 89 50 4E 47.
  - The Schema tab and the System tables toggle work. The toolbar Pro row shows 4 tools with "1 free try".
- Real files (13 rows):
  - The Jet 4 sample and 8 real files: each table list and row count matches the npm reader. Formats are checked: Jet 3, Jet 4, ACE 12, ACE 14, ACE 17.
  - Also checked: the linked table, emoji text, attachment names, Date/Time Extended, "(not read)" complex columns, and the unsupported-column note.
- Passwords (4 rows):
  - Jet 4 password file: a wrong password gives a message, the right one opens the file.
  - The encrypted ACCDB (Office agile) opens with its password.
- Broken files (5 rows): text, cut and empty files each get a plain note, with no error toast. The upper-case SHOP.MDB opens by default.
- Explorer (1 row): right-click on SHOP.MDB shows Open with MDB Viewer and the 4 "Zovo Pro: " entries.
- Pro tools (28 rows):
  - Export: 5 CSV files are written. Orders.csv has 240 rows and the memo is quoted. The result panel shows 911 rows.
  - Export to SQLite on the real testIndexCodesV2003.mdb: 30 tables with the npm reader's counts (checked with system sqlite3). Table1's text matches byte for byte, NUL and control characters included. The read-back check says OK.
  - Schema as SQL: the SQLite DDL runs in sqlite3, creates the 5 tables, and the Products column types are checked.
  - Compare: the tables only in A or only in B match the npm reader, Customers shows +4 rows and the Phone column, and the Markdown file is written.
  - For each tool, a second use on a different file opens the Pro panel only after the click, and no picker opens.
  - Panel buttons, in the order a user reads them: Try all Pro tools for 7 days, free, no card; Pay with GitHub Sponsors (USD 19 once); Pay USD 19 by card; See details. On macOS the gate reads the DOM order reversed and without Cancel.
  - One Sponsors click recorded exactly one URL, https://license.zovo.one/gh/zovo-pro?client_reference_id=<uuid>_trialstart_mdb, and the interceptor blocked it.
  - The Zovo Pro info tab shows the tries left, before and after the tries are used.
- End of run (10 rows): no error toast, no notification from the extension, no webview network request, no extension host socket, and no console, CSP or extension host error. The only URL of the run is the one Sponsors click.
- Restart (2 rows): after a VS Code restart with the same profile, the row shows "0 tries left" for all 4 tools, and nothing pops up.
- Trial (7 rows):
  - The trial button runs Export to SQLite at once (.db written, counts OK).
  - The status bar shows "Pro trial: 7 days left" while the viewer tab is active, and hides it on a text tab.
  - No notification, and no URL is opened.
  - At the end the window is closed and the profile is deleted.

## Defects found and fixed in this resume

- Product (dev1): a database whose only tables cannot be read (unsupported column type) showed an empty main view, and its note appeared only on hover. Now the first unreadable table is selected when no readable one exists, so its note shows (media/viewer.js).
- Product (dev1 screenshot): the "PRO" badge in the toolbar Pro row ran into the tool name ("JSONPRO"). It now has a small badge style in src/reach.js; the factory module is unchanged.
- Gate:
  - The panel button order was read in DOM order. macOS custom dialogs reverse it, so the order is now read the way a user sees it.
  - The Sponsors click did not answer VS Code's "open the external website?" question. The gate now clicks Open, and the interceptor records and blocks the URL.
  - The SQLite text check compared sqlite3 text output for values with NUL, control characters and line breaks. It now compares hex() bytes.
- Gate kit (pkg-gate.sh):
  - `timeout 2400 buildslot ...` counted the wait for a slot, and one package step timed out while it waited. Now the timeout covers only the command inside the slot.
  - The package step and the gate run in one slot hold, after queue-wait.sh.

## Known limits

- Only tables are read. Queries, forms, reports, macros, VBA, indexes, keys and relationships are not shown, and Schema as SQL does not write indexes or keys.
- Linked tables are listed by name only.
- Multi-value and version-history columns that the reader cannot decode show "(not read)". A table with a column type the reader does not support shows a note instead of rows.
- Dates are shown as stored, with no time zone. Files over 1 GB are refused with a note.
- The gate drove save dialogs through VS Code's simple file dialog (files.simpleDialog.enable), not the native macOS dialog.
- The gate ran on macOS only.
- The "Created" date of our samples is 2011-04-04: Jackcess copies it from its empty-database template.

## Gate command for verifiers

```
cd out/NEWB15-scripts/mdb
./pkg-gate.sh <path to zovo.zovo-mdb-viewer-0.1.0.vsix> <tag> no-package
```

The gate needs newb15-work/mdb/dl (the real files) and newb15-work/mdb/npm (the mdb-reader npm package that it uses as its reference). It runs queue-wait.sh, then buildslot, on port 9474, with ZOVO_PRO_FILE inside newb15-work/mdb. The VS Code profile is deleted at the end.
