/* CE 323 Lab Supplies: shared logic.
 *
 * Pure functions used by both the website (assets/app.js) and the Apps Script backend
 * (paste this file into Apps Script as Logic.gs). Nothing here touches the page or the Sheet.
 *
 * Data shape: { items, labs, usage, sessions, orders, equipment, log, settings }
 *   - item.onHand is in item.unit (pillows, mL, bottles...). null = not counted yet.
 *   - usage.kind "use"  = consumed: amount per lab section.
 *     usage.kind "keep" = must be on the shelf: at least `amount` on hand, not used up.
 *   - order.packs is in the item's orderUnit; order.qty is the same amount in item.unit.
 */
var InvLogic = (function () {
  "use strict";

  var OPEN_ORDER = { requested: true, ordered: true };
  var ADMIN_ACTIONS = { deleteItem: true, deleteLab: true, deleteEquipment: true };
  var DEFAULT_SECTIONS = 4;
  var STALE_COUNT_DAYS = 60;

  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
    return isFinite(n) ? n : null;
  }
  function round(n, d) { var f = Math.pow(10, d == null ? 2 : d); return Math.round(n * f) / f; }
  function bool(v) { return v === true || v === "TRUE" || v === "true" || v === "yes" || v === 1 || v === "1"; }

  /* ---------- dates (YYYY-MM-DD strings, no time zones) ---------- */
  function parseDay(s) { var p = String(s || "").slice(0, 10).split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function dayStr(ms) { var d = new Date(ms); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function addDays(s, n) { return dayStr(parseDay(s) + n * 86400000); }
  function daysBetween(a, b) { return Math.round((parseDay(b) - parseDay(a)) / 86400000); }
  function isDay(s) { return /^\d{4}-\d{2}-\d{2}/.test(String(s || "")); }

  function byId(list) { var m = {}; (list || []).forEach(function (x) { m[x.id] = x; }); return m; }
  function uid(prefix) { return (prefix || "x") + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36); }

  /* ---------- normalising rows that come from the Sheet ---------- */
  function normalize(data) {
    var d = {
      items: (data.items || []).map(function (i) {
        return {
          id: String(i.id), name: String(i.name || ""), group: String(i.group || "Other"), unit: String(i.unit || "each"),
          onHand: num(i.onHand), reorderAt: num(i.reorderAt) || 0, location: String(i.location || ""),
          vendor: String(i.vendor || ""), hach: String(i.hach || ""), fisher: String(i.fisher || ""), other: String(i.other || ""),
          orderUnit: String(i.orderUnit || ""), perOrderUnit: num(i.perOrderUnit), price: num(i.price),
          leadDays: num(i.leadDays), chemical: bool(i.chemical), hazard: String(i.hazard || ""),
          expires: isDay(i.expires) ? String(i.expires).slice(0, 10) : "", lastCounted: isDay(i.lastCounted) ? String(i.lastCounted).slice(0, 10) : "",
          countedBy: String(i.countedBy || ""), about: String(i.about || ""), notes: String(i.notes || ""), link: String(i.link || "")
        };
      }),
      labs: (data.labs || []).map(function (l) {
        return { id: String(l.id), name: String(l.name || ""), module: String(l.module || ""), about: String(l.about || ""), order: num(l.order) || 0 };
      }).sort(function (a, b) { return a.order - b.order; }),
      usage: (data.usage || []).map(function (u) {
        return { labId: String(u.labId), itemId: String(u.itemId), kind: u.kind === "keep" ? "keep" : "use", amount: num(u.amount) || 0, note: String(u.note || "") };
      }),
      sessions: (data.sessions || []).map(function (s) {
        return {
          id: String(s.id), labId: String(s.labId), date: String(s.date || "").slice(0, 10), sections: num(s.sections) || DEFAULT_SECTIONS,
          status: s.status === "done" ? "done" : "planned", notes: String(s.notes || ""), recordedAt: String(s.recordedAt || ""), recordedBy: String(s.recordedBy || "")
        };
      }),
      orders: (data.orders || []).map(function (o) {
        return {
          id: String(o.id), itemId: String(o.itemId), packs: num(o.packs) || 0, qty: num(o.qty) || 0, status: String(o.status || "requested"),
          vendor: String(o.vendor || ""), price: num(o.price), note: String(o.note || ""),
          requestedAt: String(o.requestedAt || ""), requestedBy: String(o.requestedBy || ""), orderedAt: String(o.orderedAt || ""),
          receivedAt: String(o.receivedAt || ""), receivedBy: String(o.receivedBy || "")
        };
      }),
      equipment: (data.equipment || []).map(function (e) {
        return { id: String(e.id), name: String(e.name || ""), count: num(e.count), working: num(e.working), status: e.status || "ok", labs: String(e.labs || ""), location: String(e.location || ""), notes: String(e.notes || "") };
      }),
      log: (data.log || []).map(function (g) {
        return { timestamp: String(g.timestamp || ""), who: String(g.who || ""), action: String(g.action || ""), itemId: String(g.itemId || ""), detail: String(g.detail || "") };
      }),
      settings: data.settings || {}
    };
    return d;
  }

  /* ---------- reading the state ---------- */
  function onOrder(data, itemId) {
    return data.orders.reduce(function (sum, o) { return o.itemId === itemId && OPEN_ORDER[o.status] ? sum + (o.qty || 0) : sum; }, 0);
  }

  function leadDays(item) {
    if (item.leadDays != null) return item.leadDays;
    var v = (item.vendor || "").toLowerCase();
    if (v.indexOf("made in lab") === 0) return 1;
    if (v.indexOf("hach") >= 0) return 35;
    if (v.indexOf("amazon") >= 0) return 5;
    return 14;
  }

  /** Walks upcoming sessions in date order, drawing stock down as each one uses it. */
  function plan(data, today) {
    var items = byId(data.items), labs = byId(data.labs);
    var stock = {}, perItem = {};
    data.items.forEach(function (i) {
      stock[i.id] = i.onHand == null ? 0 : i.onHand;
      perItem[i.id] = { use: 0, keep: 0, firstNeed: "", firstShort: "", sessions: 0 };
    });
    var upcoming = data.sessions.filter(function (s) { return s.status !== "done" && s.date >= today; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

    var sessions = upcoming.map(function (s) {
      var lines = data.usage.filter(function (u) { return u.labId === s.labId && items[u.itemId]; }).map(function (u) {
        var item = items[u.itemId];
        var need = u.kind === "use" ? round(u.amount * s.sections, 3) : u.amount;
        var have = stock[item.id];
        // Not counted yet: unknown, not short. The Orders page asks for a count first.
        var short = item.onHand != null && have < need ? round(need - have, 3) : 0;
        var p = perItem[item.id];
        if (!p.firstNeed) p.firstNeed = s.date;
        if (short && !p.firstShort) p.firstShort = s.date;
        if (u.kind === "use") { p.use += need; stock[item.id] = Math.max(0, have - need); } else { p.keep = Math.max(p.keep, need); }
        p.sessions++;
        return { item: item, kind: u.kind, need: need, have: round(have, 3), short: short, uncounted: item.onHand == null, note: u.note };
      });
      var shortLines = lines.filter(function (l) { return l.short > 0; });
      var unknown = lines.filter(function (l) { return l.uncounted && !l.short; });
      var orderBy = "";
      shortLines.forEach(function (l) { var d = addDays(s.date, -leadDays(l.item)); if (!orderBy || d < orderBy) orderBy = d; });
      var status = !lines.length ? "none" : shortLines.length ? "short" : unknown.length ? "unknown" : "ready";
      return { session: s, lab: labs[s.labId] || { id: s.labId, name: s.labId }, lines: lines, shortLines: shortLines, unknown: unknown, status: status, orderBy: orderBy, daysAway: daysBetween(today, s.date) };
    });

    var suggestions = [];
    data.items.forEach(function (i) {
      if (/^made in lab/i.test(i.vendor || "")) return; // mixed from a stock solution, not bought
      var p = perItem[i.id];
      var have = (i.onHand == null ? 0 : i.onHand) + onOrder(data, i.id);
      var floor = Math.max(i.reorderAt || 0, p.keep);
      var wanted = p.use + floor;
      var deficit = round(wanted - have, 3);
      if (deficit <= 0) return;
      var packs = i.perOrderUnit ? Math.ceil(deficit / i.perOrderUnit) : Math.ceil(deficit);
      var qty = i.perOrderUnit ? packs * i.perOrderUnit : packs;
      var neededBy = p.firstShort || p.firstNeed || "";
      suggestions.push({
        item: i, deficit: deficit, packs: packs, qty: qty, neededBy: neededBy,
        orderBy: neededBy ? addDays(neededBy, -leadDays(i)) : "",
        reason: p.use || p.keep ? (p.firstShort ? "short for a scheduled lab" : "below the reorder level after scheduled labs") : "below the reorder level",
        uncounted: i.onHand == null, cost: i.price != null ? round(i.price * packs, 2) : null
      });
    });
    suggestions.sort(function (a, b) {
      var x = a.orderBy || "9999", y = b.orderBy || "9999";
      return x < y ? -1 : x > y ? 1 : a.item.name < b.item.name ? -1 : 1;
    });
    return { sessions: sessions, suggestions: suggestions, perItem: perItem };
  }

  /** ok | low | out | uncounted, plus flags for stale counts and expiry. */
  function itemStatus(item, today, nextNeed) {
    var flags = [];
    if (item.lastCounted && daysBetween(item.lastCounted, today) > STALE_COUNT_DAYS) flags.push("stale");
    if (item.expires) {
      var left = daysBetween(today, item.expires);
      if (left < 0) flags.push("expired"); else if (left <= 60) flags.push("expiring");
    }
    var state;
    if (item.onHand == null) state = "uncounted";
    else if (item.onHand <= 0) state = "out";
    else if (item.onHand <= (item.reorderAt || 0) || (nextNeed && item.onHand < nextNeed)) state = "low";
    else state = "ok";
    return { state: state, flags: flags };
  }

  /* ---------- changes ---------- */
  function logEntry(data, now, who, action, itemId, detail) {
    data.log.push({ timestamp: now, who: who || "", action: action, itemId: itemId || "", detail: detail || "" });
  }
  function fmt(n) { return n == null ? "not counted" : String(round(n, 3)); }
  function need(cond, msg) { if (!cond) throw new Error(msg); }

  /**
   * Applies one change. Returns { touched: [table names], result }.
   * `now` is an ISO timestamp; `today` is YYYY-MM-DD.
   */
  function apply(data, action, p, who, now, today) {
    p = p || {};
    var items = byId(data.items);
    var touched = {};
    var result = {};
    function touch() { for (var i = 0; i < arguments.length; i++) touched[arguments[i]] = true; }

    switch (action) {
      case "setCounts": {
        (p.counts || []).forEach(function (c) {
          var it = items[c.id]; if (!it) return;
          var n = num(c.onHand); need(n == null || n >= 0, "Counts can't be negative.");
          var before = it.onHand;
          it.onHand = n; it.lastCounted = today; it.countedBy = who || "";
          logEntry(data, now, who, "count", it.id, fmt(before) + " → " + fmt(n) + " " + it.unit);
        });
        touch("items", "log");
        break;
      }
      case "adjust": {
        var a = items[p.id]; need(a, "That item no longer exists.");
        var delta = num(p.delta); need(delta != null && delta !== 0, "Enter an amount.");
        var b = a.onHand == null ? 0 : a.onHand;
        a.onHand = Math.max(0, round(b + delta, 3));
        logEntry(data, now, who, delta > 0 ? "add" : "use", a.id, (delta > 0 ? "+" : "") + round(delta, 3) + " " + a.unit + (p.reason ? " (" + p.reason + ")" : "") + ", now " + fmt(a.onHand));
        touch("items", "log");
        break;
      }
      case "saveItem": {
        var src = p.item || {};
        need(String(src.name || "").trim(), "Give the item a name.");
        var it2 = src.id && items[src.id];
        if (!it2) { it2 = { id: src.id || uid("item") }; data.items.push(it2); }
        var fields = ["name", "group", "unit", "location", "vendor", "hach", "fisher", "other", "orderUnit", "hazard", "about", "notes", "link"];
        fields.forEach(function (f) { if (f in src) it2[f] = String(src[f] == null ? "" : src[f]).trim(); });
        ["reorderAt", "perOrderUnit", "price", "leadDays"].forEach(function (f) { if (f in src) it2[f] = num(src[f]); });
        if ("onHand" in src && num(src.onHand) !== it2.onHand) { it2.onHand = num(src.onHand); it2.lastCounted = today; it2.countedBy = who || ""; }
        if ("chemical" in src) it2.chemical = bool(src.chemical);
        if ("expires" in src) it2.expires = isDay(src.expires) ? String(src.expires).slice(0, 10) : "";
        it2.reorderAt = it2.reorderAt || 0;
        logEntry(data, now, who, items[it2.id] ? "edit" : "new item", it2.id, it2.name);
        result.id = it2.id;
        touch("items", "log");
        break;
      }
      case "deleteItem": {
        var di = items[p.id]; need(di, "That item no longer exists.");
        data.items = data.items.filter(function (x) { return x.id !== p.id; });
        data.usage = data.usage.filter(function (x) { return x.itemId !== p.id; });
        logEntry(data, now, who, "delete item", p.id, di.name);
        touch("items", "usage", "log");
        break;
      }
      case "saveLab": {
        var l = p.lab || {};
        need(String(l.name || "").trim(), "Give the lab a name.");
        var lab = byId(data.labs)[l.id];
        if (!lab) { lab = { id: l.id || uid("lab"), order: data.labs.length + 1 }; data.labs.push(lab); }
        lab.name = String(l.name).trim(); lab.module = String(l.module || lab.module || "").trim(); lab.about = String(l.about || "").trim();
        if (l.order != null) lab.order = num(l.order) || lab.order;
        logEntry(data, now, who, "edit lab", "", lab.name);
        result.id = lab.id;
        touch("labs", "log");
        break;
      }
      case "deleteLab": {
        data.labs = data.labs.filter(function (x) { return x.id !== p.id; });
        data.usage = data.usage.filter(function (x) { return x.labId !== p.id; });
        logEntry(data, now, who, "delete lab", "", p.id);
        touch("labs", "usage", "log");
        break;
      }
      case "saveUsage": {
        need(byId(data.labs)[p.labId], "That lab no longer exists.");
        var lines = (p.lines || []).filter(function (x) { return items[x.itemId] && num(x.amount) != null; }).map(function (x) {
          return { labId: p.labId, itemId: x.itemId, kind: x.kind === "keep" ? "keep" : "use", amount: num(x.amount), note: String(x.note || "") };
        });
        data.usage = data.usage.filter(function (x) { return x.labId !== p.labId; }).concat(lines);
        logEntry(data, now, who, "edit supply list", "", p.labId + ": " + lines.length + " items");
        touch("usage", "log");
        break;
      }
      case "saveSession": {
        var s = p.session || {};
        need(byId(data.labs)[s.labId], "Pick a lab.");
        need(isDay(s.date), "Pick a date.");
        var sess = s.id && byId(data.sessions)[s.id];
        if (!sess) { sess = { id: s.id || uid("ses"), status: "planned", recordedAt: "", recordedBy: "" }; data.sessions.push(sess); }
        sess.labId = s.labId; sess.date = String(s.date).slice(0, 10); sess.sections = num(s.sections) || DEFAULT_SECTIONS; sess.notes = String(s.notes || "");
        logEntry(data, now, who, "schedule", "", sess.labId + " on " + sess.date + " (" + sess.sections + " sections)");
        result.id = sess.id;
        touch("sessions", "log");
        break;
      }
      case "deleteSession": {
        data.sessions = data.sessions.filter(function (x) { return x.id !== p.id; });
        logEntry(data, now, who, "remove session", "", p.id);
        touch("sessions", "log");
        break;
      }
      case "recordSession": {
        var rs = byId(data.sessions)[p.id]; need(rs, "That session no longer exists.");
        need(rs.status !== "done", "This session was already recorded.");
        (p.used || []).forEach(function (u) {
          var it3 = items[u.itemId]; var q = num(u.qty);
          if (!it3 || !q) return;
          var before = it3.onHand == null ? 0 : it3.onHand;
          it3.onHand = Math.max(0, round(before - q, 3));
          logEntry(data, now, who, "use", it3.id, "-" + round(q, 3) + " " + it3.unit + " in " + rs.labId + " (" + rs.date + "), now " + fmt(it3.onHand));
        });
        rs.status = "done"; rs.recordedAt = now; rs.recordedBy = who || "";
        if (p.notes) rs.notes = (rs.notes ? rs.notes + "\n" : "") + String(p.notes);
        touch("items", "sessions", "log");
        break;
      }
      case "requestOrders": {
        var made = [];
        (p.orders || []).forEach(function (o) {
          var it4 = items[o.itemId]; var packs = num(o.packs);
          if (!it4 || !packs || packs <= 0) return;
          var row = {
            id: uid("ord"), itemId: it4.id, packs: packs, qty: it4.perOrderUnit ? packs * it4.perOrderUnit : packs,
            status: "requested", vendor: it4.vendor, price: it4.price, note: String(o.note || ""),
            requestedAt: now, requestedBy: who || "", orderedAt: "", receivedAt: "", receivedBy: ""
          };
          data.orders.push(row); made.push(row.id);
          logEntry(data, now, who, "request", it4.id, packs + " × " + (it4.orderUnit || it4.unit));
        });
        need(made.length, "Nothing to request.");
        result.ids = made;
        touch("orders", "log");
        break;
      }
      case "setOrderStatus": {
        var o2 = byId(data.orders)[p.id]; need(o2, "That order no longer exists.");
        var st = String(p.status);
        need({ requested: 1, ordered: 1, received: 1, cancelled: 1 }[st], "Unknown status.");
        need(o2.status !== "received", "This order was already received.");
        var it5 = items[o2.itemId];
        if (st === "ordered") o2.orderedAt = now;
        if (st === "received") {
          var got = num(p.receivedQty); if (got == null) got = o2.qty;
          o2.receivedAt = now; o2.receivedBy = who || "";
          if (it5) {
            var b5 = it5.onHand == null ? 0 : it5.onHand;
            it5.onHand = round(b5 + got, 3);
            logEntry(data, now, who, "receive", it5.id, "+" + got + " " + it5.unit + ", now " + fmt(it5.onHand));
          }
          touch("items");
        } else {
          logEntry(data, now, who, st, o2.itemId, (it5 ? it5.name : o2.itemId));
        }
        o2.status = st;
        touch("orders", "log");
        break;
      }
      case "saveEquipment": {
        var e = p.equipment || {};
        need(String(e.name || "").trim(), "Give it a name.");
        var eq = e.id && byId(data.equipment)[e.id];
        if (!eq) { eq = { id: e.id || uid("eq") }; data.equipment.push(eq); }
        eq.name = String(e.name).trim(); eq.count = num(e.count); eq.working = num(e.working);
        eq.status = { ok: 1, "needs-service": 1, "out-of-service": 1 }[e.status] ? e.status : "ok";
        eq.labs = String(e.labs || ""); eq.location = String(e.location || ""); eq.notes = String(e.notes || "");
        logEntry(data, now, who, "equipment", "", eq.name + ": " + eq.status);
        result.id = eq.id;
        touch("equipment", "log");
        break;
      }
      case "deleteEquipment": {
        data.equipment = data.equipment.filter(function (x) { return x.id !== p.id; });
        logEntry(data, now, who, "delete equipment", "", p.id);
        touch("equipment", "log");
        break;
      }
      default:
        throw new Error("Unknown action: " + action);
    }
    return { touched: Object.keys(touched), result: result };
  }

  /** Turns seed.json into a starting data set. */
  function fromSeed(seed, today, withExamples) {
    var d = normalize({ items: seed.items, labs: seed.labs, usage: seed.usage, equipment: seed.equipment });
    d.items.forEach(function (i) { if (i.onHand != null && !i.lastCounted) i.lastCounted = "2026-07-28"; });
    if (withExamples) {
      d.sessions = (seed.exampleSessions || []).map(function (s, n) {
        return { id: "example-" + (n + 1), labId: s.labId, date: addDays(today, s.offsetDays), sections: s.sections, status: "planned", notes: s.notes || "", recordedAt: "", recordedBy: "" };
      });
    }
    return d;
  }

  return {
    num: num, round: round, bool: bool, addDays: addDays, daysBetween: daysBetween, parseDay: parseDay, dayStr: dayStr,
    byId: byId, uid: uid, normalize: normalize, plan: plan, itemStatus: itemStatus, onOrder: onOrder, leadDays: leadDays,
    apply: apply, fromSeed: fromSeed, ADMIN_ACTIONS: ADMIN_ACTIONS, OPEN_ORDER: OPEN_ORDER, DEFAULT_SECTIONS: DEFAULT_SECTIONS
  };
})();
if (typeof window !== "undefined") window.InvLogic = InvLogic;
if (typeof module !== "undefined" && module.exports) module.exports = InvLogic;
