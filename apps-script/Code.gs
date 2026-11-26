/**
 * CE 323 Lab Supplies: backend.
 *
 * Paste this file into the Apps Script editor of the "CE 323 Lab Supplies data" Google Sheet
 * (Extensions > Apps Script) as Code.gs, and paste assets/logic.js from the repository as a
 * second file named Logic.gs. Run setup() once, then importSeed(), then deploy as a web app.
 * Full steps are in README.md.
 *
 * What it does:
 *  - Serves the supplies, labs, schedule, orders and equipment in the Sheet to the website.
 *  - Saves counts, use, orders and edits back to the Sheet (one change at a time, with a lock,
 *    so two TAs saving at once can't overwrite each other).
 *  - Monday morning, emails the lab TAs a short summary: sessions that are short, and what to
 *    order before its order-by date. Nothing is sent when everything is fine.
 *
 * The rules for counting, planning and ordering live in Logic.gs, the same file the website uses.
 */

var TZ = 'America/Boise';
var TABS = {
  Items: ['id', 'name', 'group', 'unit', 'onHand', 'reorderAt', 'location', 'vendor', 'hach', 'fisher', 'other', 'orderUnit', 'perOrderUnit', 'price', 'leadDays', 'chemical', 'hazard', 'expires', 'lastCounted', 'countedBy', 'about', 'notes', 'link'],
  Labs: ['id', 'name', 'module', 'about', 'order'],
  Usage: ['labId', 'itemId', 'kind', 'amount', 'note'],
  Sessions: ['id', 'labId', 'date', 'sections', 'status', 'notes', 'recordedAt', 'recordedBy'],
  Orders: ['id', 'itemId', 'packs', 'qty', 'status', 'vendor', 'price', 'note', 'requestedAt', 'requestedBy', 'orderedAt', 'receivedAt', 'receivedBy'],
  Equipment: ['id', 'name', 'count', 'working', 'status', 'labs', 'location', 'notes'],
  Log: ['timestamp', 'who', 'action', 'itemId', 'detail'],
  Settings: ['key', 'value']
};
var SETTING_KEYS = [
  ['instructorName', 'Dr. Sondra Miller'], ['instructorEmail', ''],
  ['orderContactName', ''], ['orderContactEmail', ''],
  ['ehsContactName', ''], ['ehsContactEmail', ''],
  ['reminderEmails', ''], ['siteUrl', '']
];
var LOG_ROWS_SENT = 300;

/* ------------------------------------------------------------------ setup */

/** Run once from the editor. Creates the tabs, the access codes and the Monday email trigger. */
function setup() {
  var ss = SpreadsheetApp.getActive();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var head = TABS[name];
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.getRange(1, 1, sh.getMaxRows(), head.length).setNumberFormat('@');
    sh.setFrozenRows(1);
  });
  var settings = ss.getSheetByName('Settings');
  var have = readTable('Settings').map(function (r) { return r.key; });
  SETTING_KEYS.forEach(function (kv) { if (have.indexOf(kv[0]) < 0) settings.appendRow(kv); });
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  if (!props.getProperty('LAB_CODE')) props.setProperty('LAB_CODE', randomCode());
  if (!props.getProperty('ADMIN_CODE')) props.setProperty('ADMIN_CODE', randomCode() + '-' + randomCode());
  var handlers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (handlers.indexOf('sendWeeklySummary') < 0) {
    ScriptApp.newTrigger('sendWeeklySummary').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).inTimezone(TZ).create();
  }
  Logger.log('Setup done.');
  Logger.log('Lab code (for the TAs): ' + props.getProperty('LAB_CODE'));
  Logger.log('Admin code (only needed to delete things): ' + props.getProperty('ADMIN_CODE'));
  Logger.log('Next: put the GitHub Pages address in Settings > siteUrl, then run importSeed.');
}

/** Run once after setup. Copies the starting supply list from the website's data/seed.json into empty tabs. */
function importSeed() {
  var site = setting('siteUrl');
  if (!site) throw new Error('Put the GitHub Pages address in the Settings tab (siteUrl) first.');
  var url = site.replace(/\/?$/, '/') + 'data/seed.json';
  var seed = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: false }).getContentText());
  var data = InvLogic.fromSeed(seed, todayStr(), false);
  ['Items', 'Labs', 'Usage', 'Equipment'].forEach(function (name) {
    var key = name.toLowerCase();
    if (readTable(name).length) { Logger.log(name + ' already has rows; skipped.'); return; }
    writeTable(name, data[key]);
    Logger.log(name + ': ' + data[key].length + ' rows imported.');
  });
}

function randomCode() {
  var words = ['burette', 'pillow', 'alum', 'floc', 'titrant', 'beaker', 'boise', 'bronco', 'weir', 'venturi', 'jar', 'filter'];
  return words[Math.floor(Math.random() * words.length)] + '-' + Math.floor(1000 + Math.random() * 9000);
}

/* ------------------------------------------------------------------ web app */

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.action === 'data') {
      checkCode(p.code, 'lab');
      return json({ ok: true, data: payload(readAll()) });
    }
    return json({ ok: true, service: 'CE 323 Lab Supplies' });
  } catch (err) {
    return json({ ok: false, error: err.message, code: err.codeType || '' });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    checkCode(b.code, 'lab');
    if (InvLogic.ADMIN_ACTIONS[b.action]) checkCode(b.adminCode, 'admin');
    lock.waitLock(20000);
    var data = readAll();
    var logBefore = data.log.length;
    var who = String(b.who || '').slice(0, 40);
    var res = InvLogic.apply(data, String(b.action || ''), b.payload || {}, who, new Date().toISOString(), todayStr());
    res.touched.forEach(function (name) {
      if (name === 'log') appendRows('Log', data.log.slice(logBefore));
      else writeTable(name.charAt(0).toUpperCase() + name.slice(1), data[name]);
    });
    SpreadsheetApp.flush();
    return json({ ok: true, data: payload(data), result: res.result || {} });
  } catch (err) {
    return json({ ok: false, error: err.message, code: err.codeType || '' });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkCode(code, level) {
  var props = PropertiesService.getScriptProperties();
  var lab = props.getProperty('LAB_CODE'), admin = props.getProperty('ADMIN_CODE');
  var ok = level === 'admin' ? code && code === admin : code && (code === lab || code === admin);
  if (!ok) {
    var err = new Error(level === 'admin' ? 'That needs the admin code.' : 'That lab code is not right.');
    err.codeType = level === 'admin' ? 'admin' : 'code';
    throw err;
  }
}

function payload(data) {
  var out = {};
  Object.keys(data).forEach(function (k) { out[k] = data[k]; });
  out.log = data.log.slice(-LOG_ROWS_SENT);
  return out;
}

/* ------------------------------------------------------------------ Sheet access */

function sheet(name) {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
  return ss.getSheetByName(name);
}

function readTable(name) {
  var sh = sheet(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var head = TABS[name];
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getDisplayValues();
  return vals.filter(function (r) { return r.join('') !== ''; }).map(function (r) {
    var o = {}; head.forEach(function (h, i) { o[h] = r[i]; }); return o;
  });
}

function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'yes' : '';
  return String(v);
}

function writeTable(name, rows) {
  var sh = sheet(name), head = TABS[name];
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, head.length).clearContent();
  if (!rows.length) return;
  var vals = rows.map(function (r) { return head.map(function (h) { return cell(r[h]); }); });
  sh.getRange(2, 1, vals.length, head.length).setNumberFormat('@').setValues(vals);
}

function appendRows(name, rows) {
  if (!rows.length) return;
  var sh = sheet(name), head = TABS[name];
  var vals = rows.map(function (r) { return head.map(function (h) { return cell(r[h]); }); });
  sh.getRange(sh.getLastRow() + 1, 1, vals.length, head.length).setNumberFormat('@').setValues(vals);
}

function readAll() {
  var settings = {};
  readTable('Settings').forEach(function (r) { if (r.key) settings[r.key] = r.value; });
  return InvLogic.normalize({
    items: readTable('Items'), labs: readTable('Labs'), usage: readTable('Usage'), sessions: readTable('Sessions'),
    orders: readTable('Orders'), equipment: readTable('Equipment'), log: readTable('Log'), settings: settings
  });
}

function setting(key) {
  var row = readTable('Settings').filter(function (r) { return r.key === key; })[0];
  return row ? String(row.value || '').trim() : '';
}

function todayStr() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

/* ------------------------------------------------------------------ Monday summary */

/** Emails the people in Settings > reminderEmails, only when something needs doing. */
function sendWeeklySummary() {
  var to = setting('reminderEmails');
  if (!to) return 0;
  var data = readAll(), today = todayStr();
  var p = InvLogic.plan(data, today);
  var horizon = InvLogic.addDays(today, 42);
  var short = p.sessions.filter(function (s) { return s.status === 'short' && s.session.date <= horizon; });
  var orderNow = p.suggestions.filter(function (s) { return !s.uncounted && s.orderBy && s.orderBy <= InvLogic.addDays(today, 14); });
  var uncounted = p.sessions.filter(function (s) { return s.session.date <= InvLogic.addDays(today, 14); })
    .reduce(function (acc, s) { return acc.concat(s.unknown.map(function (l) { return l.item.name; })); }, []);
  var arrived = data.orders.filter(function (o) { return o.status === 'ordered' && o.orderedAt && InvLogic.daysBetween(o.orderedAt.slice(0, 10), today) > 21; });
  var belowReorder = p.suggestions.filter(function (s) { return !s.uncounted && !s.orderBy; });
  if (!short.length && !orderNow.length && !uncounted.length && !arrived.length && !belowReorder.length) return 0;

  var site = setting('siteUrl') || '';
  var fmt = function (d) { return Utilities.formatDate(new Date(InvLogic.parseDay(d) + 12 * 3600000), 'UTC', 'EEE MMM d'); };
  var lines = ['Good morning. Here is what the CE 323 lab supplies need this week.', ''];
  if (short.length) {
    lines.push('LABS THAT WILL BE SHORT');
    short.forEach(function (s) {
      lines.push('- ' + s.lab.name + ' on ' + fmt(s.session.date) + ': ' + s.shortLines.map(function (l) { return l.item.name + ' (short ' + InvLogic.round(l.short, 2) + ' ' + l.item.unit + ')'; }).join('; '));
    });
    lines.push('');
  }
  if (orderNow.length) {
    lines.push('ORDER IN THE NEXT TWO WEEKS');
    orderNow.forEach(function (s) {
      lines.push('- ' + s.item.name + ': ' + s.packs + ' x ' + (s.item.orderUnit || s.item.unit) + ', order by ' + fmt(s.orderBy) + (s.orderBy < today ? ' (late, order now)' : ''));
    });
    lines.push('');
  }
  if (uncounted.length) {
    lines.push('COUNT BEFORE THE NEXT LABS');
    uncounted.filter(function (v, i, a) { return a.indexOf(v) === i; }).forEach(function (n) { lines.push('- ' + n); });
    lines.push('');
  }
  if (arrived.length) {
    lines.push('ORDERED OVER 3 WEEKS AGO. DID THESE ARRIVE?');
    var items = InvLogic.byId(data.items);
    arrived.forEach(function (o) { lines.push('- ' + (items[o.itemId] ? items[o.itemId].name : o.itemId)); });
    lines.push('');
  }
  if (belowReorder.length) {
    lines.push(belowReorder.length + ' other supplies are at or below their reorder level (no scheduled lab needs them yet). They are on the Orders page.', '');
  }
  if (site) lines.push('Open the inventory: ' + site);
  MailApp.sendEmail({ to: to, subject: 'CE 323 lab supplies: this week', body: lines.join('\n') });
  return 1;
}
