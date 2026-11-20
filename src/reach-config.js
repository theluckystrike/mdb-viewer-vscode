'use strict';
// REACH1: this listing's Pro tools for the viewer toolbar row and the Explorer entries (src/reach.js).
module.exports = {
  prefix: 'mdbViewer',
  triesKey: 'mdbViewer.proTrial',
  slot: '#toolbar',
  tools: [
    { id: 'exportData', title: 'Export to CSV and JSON', command: 'mdbViewer.exportData' },
    { id: 'exportSqlite', title: 'Export to SQLite', command: 'mdbViewer.exportSqlite' },
    { id: 'schemaSql', title: 'Schema as SQL', command: 'mdbViewer.schemaSql' },
    { id: 'compare', title: 'Compare two Access files', command: 'mdbViewer.compare' },
  ],
};
