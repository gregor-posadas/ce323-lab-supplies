/* CE 323 Lab Supplies: the website.
   Plain JavaScript, no build step. Data comes from the Apps Script backend (see assets/config.js),
   or, in practice mode, from data/seed.json with changes kept in this browser. */
(function () {
  "use strict";

  var BUILD = "20261126094944";
  var cfg = window.LAB_CONFIG || {};
  var L = window.InvLogic;
  var LIVE = !!cfg.apiUrl;
  var $main = document.getElementById("main");

  var store = {
    get: function (k) { try { return window.localStorage.getItem("ce323." + k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem("ce323." + k, v); } catch (e) { /* private mode */ } },
    del: function (k) { try { window.localStorage.removeItem("ce323." + k); } catch (e) { /* ignore */ } }
  };

  var state = { data: null, seed: null, loadedAt: null, planCache: null };

  /* ---------------------------------------------------------------- helpers */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function today() {
    try {
      var parts = new Intl.DateTimeFormat("en-CA", { timeZone: cfg.timeZone || "America/Boise", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
      var o = {}; parts.forEach(function (p) { o[p.type] = p.value; });
      return o.year + "-" + o.month + "-" + o.day;
    } catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function nowIso() { return new Date().toISOString(); }
  function fmtDay(s, long) {
    if (!s) return "";
    var d = new Date(L.parseDay(s));
    return d.toLocaleDateString("en-US", long ? { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" } : { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  }
  function fmtStamp(iso) {
    if (!iso) return "";
    var d = new Date(iso); if (isNaN(d)) return esc(iso);
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: cfg.timeZone || "America/Boise" });
  }
  function rel(s) {
    var n = L.daysBetween(today(), s);
    if (n === 0) return "today"; if (n === 1) return "tomorrow"; if (n === -1) return "yesterday";
    return n > 0 ? "in " + n + " days" : Math.abs(n) + " days ago";
  }
  function n(v) { if (v == null) return "–"; var r = L.round(v, 2); return r.toLocaleString("en-US"); }
  function un(v, unit) { unit = String(unit || ""); if (L.round(v, 3) !== 1) return unit; if (/(x|ch|sh)es$/.test(unit)) return unit.slice(0, -2); return /[^s]s$/.test(unit) ? unit.slice(0, -1) : unit; }
  function qty(v, unit) { return v == null ? "Not counted" : n(v) + " " + esc(un(v, unit)); }
  function money(v) { return v == null ? "" : "$" + Number(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function catalog(i) {
    var out = [];
    if (i.hach) out.push("Hach " + i.hach);
    if (i.fisher) out.push("Fisher " + i.fisher);
    if (i.other) out.push(i.other);
    return out.join(" · ");
  }
  function plan() {
    if (!state.planCache) state.planCache = L.plan(state.data, today());
    return state.planCache;
  }
  function items() { return state.data.items; }
  function itemById(id) { return L.byId(items())[id]; }
  function labById(id) { return L.byId(state.data.labs)[id]; }
  function groups() {
    var seen = {}, out = [];
    items().forEach(function (i) { if (!seen[i.group]) { seen[i.group] = 1; out.push(i.group); } });
    return out;
  }
  function nextNeed(itemId) {
    var s = plan().sessions;
    for (var k = 0; k < s.length; k++) {
      for (var j = 0; j < s[k].lines.length; j++) if (s[k].lines[j].item.id === itemId) return s[k].lines[j].need;
    }
    return 0;
  }
  function statusOf(i) { return L.itemStatus(i, today(), nextNeed(i.id)); }

  /* Status shapes: circle = OK, triangle = low, square with cross = out, dashed circle = unknown */
  var SHAPES = {
    ok: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="currentColor"/></svg>',
    low: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2 19 18H1z" fill="currentColor"/></svg>',
    out: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="1" y="1" width="18" height="18" fill="currentColor"/><path d="M6 6l8 8M14 6l-8 8" stroke="var(--paper)" stroke-width="2.5"/></svg>',
    unknown: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="3 2.5"/></svg>'
  };
  function st(kind, word) { return '<span class="st st--' + kind + '">' + SHAPES[kind] + "<span>" + esc(word) + "</span></span>"; }
  var ITEM_WORDS = { ok: ["ok", "In stock"], low: ["low", "Low"], out: ["out", "Out"], uncounted: ["unknown", "Not counted"] };
  function itemSt(i) { var s = statusOf(i), w = ITEM_WORDS[s.state]; return st(w[0], w[1]); }
  function flags(i) {
    var s = statusOf(i), out = "";
    if (s.flags.indexOf("expired") >= 0) out += '<span class="flag">Expired ' + esc(fmtDay(i.expires)) + "</span>";
    else if (s.flags.indexOf("expiring") >= 0) out += '<span class="flag">Expires ' + esc(fmtDay(i.expires)) + "</span>";
    if (s.flags.indexOf("stale") >= 0) out += '<span class="flag">Count is ' + L.daysBetween(i.lastCounted, today()) + " days old</span>";
    if (i.hazard) out += '<span class="flag">Hazard</span>';
    return out;
  }
  var SESSION_ST = {
    ready: ["ok", "Ready"], short: ["out", "Short"], unknown: ["unknown", "Check counts"], none: ["unknown", "No supply list"]
  };
  function sessionSt(p) { var w = SESSION_ST[p.status]; return st(w[0], w[1]); }

  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("is-on");
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove("is-on"); }, 3800);
  }
  function busy(on) { document.getElementById("busy").hidden = !on; $main.setAttribute("aria-busy", on ? "true" : "false"); }

  /* ---------------------------------------------------------------- data */
  function loadSeed() {
    if (state.seed) return Promise.resolve(state.seed);
    return fetch("data/seed.json?v=" + BUILD).then(function (r) { return r.json(); }).then(function (j) { state.seed = j; return j; });
  }

  function load() {
    busy(true);
    var p;
    if (LIVE) {
      var code = store.get("code");
      if (!code) { busy(false); return Promise.resolve("gate"); }
      p = fetch(cfg.apiUrl + "?action=data&code=" + encodeURIComponent(code), { redirect: "follow" })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) { if (j.code === "code") { store.del("code"); return "gate"; } throw new Error(j.error || "The Sheet didn't answer."); }
          setData(j.data); return "ok";
        });
    } else {
      var saved = store.get("practice");
      p = saved ? Promise.resolve(setData(JSON.parse(saved))).then(function () { return "ok"; })
        : loadSeed().then(function (seed) { setData(L.fromSeed(seed, today(), true)); savePractice(); return "ok"; });
    }
    return p.then(function (r) { busy(false); return r; }, function (e) { busy(false); throw e; });
  }
  function setData(d) { state.data = L.normalize(d); state.planCache = null; state.loadedAt = new Date(); }
  function savePractice() { if (!LIVE) store.set("practice", JSON.stringify(state.data)); }

  function who() { return store.get("who") || ""; }

  /** Sends one change. In practice mode the same logic runs in the browser. */
  function act(action, payload) {
    var go = function () {
      if (!LIVE) {
        var copy = L.normalize(JSON.parse(JSON.stringify(state.data)));
        var r = L.apply(copy, action, payload, who(), nowIso(), today());
        state.data = copy; state.planCache = null; savePractice();
        return Promise.resolve(r.result || {});
      }
      var body = { action: action, payload: payload, code: store.get("code"), who: who() };
      if (L.ADMIN_ACTIONS[action]) body.adminCode = store.get("adminCode") || "";
      busy(true);
      return fetch(cfg.apiUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          busy(false);
          if (!j.ok) {
            if (j.code === "admin") { store.del("adminCode"); throw new Error("That needs the admin code. Add it under Settings."); }
            if (j.code === "code") { store.del("code"); throw new Error("The lab code changed. Enter the new one under Settings."); }
            throw new Error(j.error || "The change wasn't saved.");
          }
          setData(j.data);
          return j.result || {};
        }, function (e) { busy(false); throw new Error("Couldn't reach the Sheet. Check your connection and try again."); });
    };
    if (!who()) return askName().then(go);
    return go();
  }

  function askName() {
    return new Promise(function (resolve, reject) {
      openDialog(
        '<h2 id="dlg-title">Who is making changes?</h2>' +
        '<form class="form" data-dlg="name"><p>Your first name goes in the activity history so the other TA knows who counted or ordered what. This browser remembers it.</p>' +
        '<div class="field"><label for="who-in">First name</label><input type="text" id="who-in" autocomplete="given-name" required></div>' +
        '<div class="actions"><button class="btn btn--solid" type="submit">Save</button><button class="btn btn--quiet" type="button" data-close>Cancel</button></div></form>',
        function (form) { var v = form.querySelector("#who-in").value.trim(); if (!v) return false; store.set("who", v); resolve(); },
        function () { reject(new Error("cancelled")); }
      );
    });
  }

  /* ---------------------------------------------------------------- dialog */
  var dlg = document.getElementById("dlg");
  var dlgSubmit = null, dlgCancel = null, dlgReturn = null;
  function openDialog(html, onSubmit, onCancel) {
    dlgReturn = document.activeElement;
    dlg.innerHTML = html; dlgSubmit = onSubmit; dlgCancel = onCancel || null;
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    var f = dlg.querySelector("input, select, textarea, button"); if (f) f.focus();
  }
  function closeDialog(cancelled) {
    if (dlg.open) { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); }
    if (cancelled && dlgCancel) dlgCancel();
    dlgSubmit = dlgCancel = null;
    if (dlgReturn && dlgReturn.focus) try { dlgReturn.focus(); } catch (e) { /* gone */ }
  }
  dlg.addEventListener("submit", function (e) {
    e.preventDefault();
    if (dlgSubmit && dlgSubmit(e.target) === false) return;
    closeDialog(false);
  });
  dlg.addEventListener("click", function (e) { if (e.target.closest("[data-close]")) closeDialog(true); });
  dlg.addEventListener("cancel", function (e) { e.preventDefault(); closeDialog(true); });

  /* ---------------------------------------------------------------- router */
  var routes = [
    [/^$/, "home", viewHome],
    [/^supplies$/, "supplies", viewSupplies],
    [/^item\/new$/, "supplies", function () { return viewItemEdit(null); }],
    [/^item\/([^/]+)\/edit$/, "supplies", function (m) { return viewItemEdit(m[1]); }],
    [/^item\/([^/]+)$/, "supplies", function (m) { return viewItem(m[1]); }],
    [/^labs$/, "labs", viewLabs],
    [/^lab\/new$/, "labs", function () { return viewLabEdit(null); }],
    [/^lab\/([^/]+)\/edit$/, "labs", function (m) { return viewLabEdit(m[1]); }],
    [/^lab\/([^/]+)$/, "labs", function (m) { return viewLab(m[1]); }],
    [/^schedule$/, "schedule", viewSchedule],
    [/^session\/([^/]+)$/, "schedule", function (m) { return viewSession(m[1]); }],
    [/^count$/, "count", viewCount],
    [/^orders$/, "orders", viewOrders],
    [/^equipment$/, "equipment", viewEquipment],
    [/^guide$/, "guide", viewGuide],
    [/^settings$/, "settings", viewSettings]
  ];
  var lastPath = null;
  function route() {
    var raw = decodeURIComponent((location.hash || "#/").slice(2));
    var path = raw.split("?")[0];
    var query = {}; (raw.split("?")[1] || "").split("&").forEach(function (kv) { if (kv) { var a = kv.split("="); query[a[0]] = a[1] || ""; } });
    route.query = query;
    if (!state.data) return;
    var hit = null;
    for (var i = 0; i < routes.length; i++) { var m = path.match(routes[i][0]); if (m) { hit = [routes[i], m]; break; } }
    document.querySelectorAll("[data-nav]").forEach(function (a) {
      if (hit && a.getAttribute("data-nav") === hit[0][1]) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    var html = hit ? hit[0][2](hit[1]) : notFound();
    var keepScroll = path === lastPath;
    var y = window.scrollY;
    $main.innerHTML = html;
    var h1 = $main.querySelector("h1");
    if (!keepScroll) {
      window.scrollTo(0, 0);
      if (h1 && lastPath !== null) { h1.setAttribute("tabindex", "-1"); h1.focus({ preventScroll: true }); }
    } else window.scrollTo(0, y);
    document.title = (h1 ? h1.textContent + " · " : "") + "CE 323 Lab Supplies";
    lastPath = path;
    if (afterRender[path.split("/")[0]]) afterRender[path.split("/")[0]]();
    footer();
  }
  var afterRender = {};
  function rerender() { lastPath = (location.hash || "#/").slice(2).split("?")[0]; route(); }
  function notFound() { return '<div class="wrap"><div class="head"><h1>Page not found</h1><p><a href="#/">Go to This week</a></p></div></div>'; }
  function wrap(inner) { return '<div class="wrap">' + inner + "</div>"; }
  function footer() {
    var f = document.getElementById("foot-status");
    f.textContent = (LIVE ? "Connected to the lab Sheet" : "Practice mode: changes stay in this browser") +
      (state.loadedAt ? " · loaded " + state.loadedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "") +
      (who() ? " · signed changes as " + who() : "");
  }

  /* ---------------------------------------------------------------- views: this week */
  function viewHome() {
    var p = plan(), t = today();
    var counts = { out: 0, low: 0, uncounted: 0, stale: 0 };
    items().forEach(function (i) { var s = statusOf(i); counts[s.state] = (counts[s.state] || 0) + 1; if (s.flags.indexOf("stale") >= 0) counts.stale++; });
    var open = state.data.orders.filter(function (o) { return L.OPEN_ORDER[o.status]; });
    var html = '<div class="head"><h1>This week</h1><p>' + esc(fmtDay(t, true)) + ". What the next labs need, what's short, and what to order before it's too late.</p></div>";
    html += '<div class="stats">' +
      '<a class="stat" href="#/supplies?status=out"><b>' + counts.out + "</b>" + st("out", "Out of stock") + "</a>" +
      '<a class="stat" href="#/supplies?status=low"><b>' + counts.low + "</b>" + st("low", "Running low") + "</a>" +
      '<a class="stat" href="#/count"><b>' + (counts.uncounted + counts.stale) + "</b>" + st("unknown", "Need a count") + "</a>" +
      '<a class="stat" href="#/orders"><b>' + open.length + "</b><span>Orders open</span></a></div>";

    html += '<section class="section" aria-labelledby="h-next"><h2 id="h-next">Next lab sessions <a class="small" href="#/schedule">Full schedule</a></h2>';
    var next = p.sessions.slice(0, 4);
    if (!next.length) {
      html += '<p class="empty">No lab sessions are scheduled. Add the semester\'s lab dates so the site can check supplies ahead of time.</p><p><a class="btn btn--solid" href="#/schedule">Add the lab schedule</a></p>';
    } else {
      html += '<div class="cards">' + next.map(sessionCard).join("") + "</div>";
    }
    html += "</section>";

    var soon = p.suggestions.filter(function (s) { return !s.uncounted && (!s.orderBy || L.daysBetween(t, s.orderBy) <= 14); });
    html += '<section class="section" aria-labelledby="h-order"><h2 id="h-order">Order soon <a class="small" href="#/orders">All orders</a></h2>';
    if (!soon.length) html += '<p class="empty">Nothing needs ordering in the next two weeks.</p>';
    else {
      html += '<ul class="rows">' + soon.slice(0, 6).map(function (s) {
        var late = s.orderBy && s.orderBy < t;
        return '<li class="row"><a href="#/item/' + esc(s.item.id) + '"><span class="row__main"><span class="row__title">' + esc(s.item.name) + '</span><span class="row__meta">' +
          esc(s.item.vendor) + (s.neededBy ? " · needed " + esc(fmtDay(s.neededBy)) : "") + " · " + esc(s.reason) + '</span></span><span class="row__side"><span class="row__qty">' +
          s.packs + " × " + esc(s.item.orderUnit || s.item.unit) + "</span>" + (s.orderBy ? (late ? st("out", "Order now") : '<span class="small">Order by ' + esc(fmtDay(s.orderBy)) + "</span>") : "") + "</span></a></li>";
      }).join("") + "</ul>";
      if (soon.length > 6) html += '<p class="section__note">' + (soon.length - 6) + ' more on the <a href="#/orders">Orders</a> page.</p>';
    }
    html += "</section>";

    html += '<section class="section" aria-labelledby="h-act"><h2 id="h-act">Recent activity</h2>' + logList(state.data.log.slice(-8).reverse(), true) + "</section>";
    return wrap(html);
  }

  function sessionCard(sp) {
    var s = sp.session, t = today();
    var html = '<article class="card' + (sp.status === "short" ? " card--short" : "") + '"><h3><a href="#/session/' + esc(s.id) + '">' + esc(sp.lab.name) + "</a></h3>" +
      '<p class="card__when">' + esc(fmtDay(s.date)) + " · " + esc(rel(s.date)) + " · " + s.sections + " sections</p><p>" + sessionSt(sp) + "</p>";
    if (sp.status === "short") {
      html += "<ul>" + sp.shortLines.slice(0, 5).map(function (l) {
        return "<li>" + esc(l.item.name) + ": short " + n(l.short) + " " + esc(un(l.short, l.item.unit)) + "</li>";
      }).join("") + (sp.shortLines.length > 5 ? "<li>and " + (sp.shortLines.length - 5) + " more</li>" : "") + "</ul>";
      html += sp.orderBy < t ? '<p class="small"><b>The usual lead time has passed.</b> Order today and ask about faster shipping, or borrow from another lab.</p>'
        : '<p class="small">Order by <b>' + esc(fmtDay(sp.orderBy)) + "</b> to have it in time.</p>";
    }
    if (sp.unknown.length) {
      html += '<p class="small">' + (sp.status === "short" ? "Also not counted yet: " : "Not counted yet: ") + sp.unknown.slice(0, 4).map(function (l) { return esc(l.item.name); }).join("; ") +
        (sp.unknown.length > 4 ? "; and " + (sp.unknown.length - 4) + " more" : "") + '. <a href="#/count">Count them</a> to confirm.</p>';
    }
    html += '<div class="card__foot"><a class="btn btn--sm" href="#/session/' + esc(s.id) + '">Open pick list</a></div></article>';
    return html;
  }

  function logList(entries, withItem) {
    if (!entries.length) return '<p class="empty">Nothing yet. Counts, use, orders and edits show up here.</p>';
    var map = L.byId(items());
    return '<ul class="log">' + entries.map(function (g) {
      var it = map[g.itemId];
      return "<li><span class=\"muted\">" + esc(fmtStamp(g.timestamp)) + (g.who ? " · " + esc(g.who) : "") + "</span><span><b>" + esc(g.action) + "</b> " +
        (withItem && it ? '<a href="#/item/' + esc(it.id) + '">' + esc(it.name) + "</a>: " : "") + esc(g.detail) + "</span></li>";
    }).join("") + "</ul>";
  }

  /* ---------------------------------------------------------------- views: supplies */
  function viewSupplies() {
    var q = route.query;
    var html = '<div class="head"><h1>Supplies</h1><p>Everything the lab keeps on the shelf. Tap a supply to update its count, see what it\'s for, or add it to the order list.</p></div>';
    html += '<form class="toolbar no-print" role="search" data-form="filter" onsubmit="return false">' +
      '<div class="field field--grow"><label for="f-q">Search</label><input type="search" id="f-q" placeholder="Name or catalog number" value="' + esc(q.q || "") + '"></div>' +
      '<div class="field"><label for="f-group">Lab</label><select id="f-group"><option value="">All labs</option>' +
      groups().map(function (g) { return "<option" + (q.group === g ? " selected" : "") + ">" + esc(g) + "</option>"; }).join("") + "</select></div>" +
      '<div class="field"><label for="f-status">Status</label><select id="f-status">' +
      [["", "Any status"], ["out", "Out"], ["low", "Low"], ["uncounted", "Not counted"], ["ok", "In stock"], ["expiring", "Expiring or expired"], ["hazard", "Has a hazard note"]].map(function (o) {
        return '<option value="' + o[0] + '"' + ((q.status || "") === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
      }).join("") + "</select></div>" +
      '<a class="btn" href="#/item/new">Add a supply</a></form><div id="supply-list" aria-live="polite"></div>';
    afterRender.supplies = function () {
      var f = $main.querySelector('[data-form="filter"]');
      var draw = function () {
        var term = f.querySelector("#f-q").value.trim().toLowerCase(), g = f.querySelector("#f-group").value, s = f.querySelector("#f-status").value;
        var list = items().filter(function (i) {
          if (g && i.group !== g) return false;
          var stt = statusOf(i);
          if (s === "expiring" && !(stt.flags.indexOf("expiring") >= 0 || stt.flags.indexOf("expired") >= 0)) return false;
          if (s === "hazard" && !i.hazard) return false;
          if (s && s !== "expiring" && s !== "hazard" && stt.state !== s) return false;
          if (term && (i.name + " " + i.hach + " " + i.fisher + " " + i.other + " " + i.location + " " + i.vendor).toLowerCase().indexOf(term) < 0) return false;
          return true;
        });
        var out = '<p class="small muted">' + list.length + " of " + items().length + " supplies</p>";
        var gs = groups().filter(function (x) { return list.some(function (i) { return i.group === x; }); });
        if (!list.length) out += '<p class="empty">No supplies match. Clear the search or pick "All labs".</p>';
        gs.forEach(function (x) {
          out += '<h2 class="group-h">' + esc(x) + '</h2><ul class="rows">' + list.filter(function (i) { return i.group === x; }).map(itemRow).join("") + "</ul>";
        });
        document.getElementById("supply-list").innerHTML = out;
      };
      f.addEventListener("input", draw);
      draw();
    };
    return wrap(html);
  }
  function itemRow(i) {
    return '<li class="row"><a href="#/item/' + esc(i.id) + '"><span class="row__main"><span class="row__title">' + esc(i.name) + '</span><span class="row__meta">' +
      (i.location ? "<span>" + esc(i.location) + "</span>" : "") + "<span>" + esc(i.vendor) + (catalog(i) ? " · " + esc(catalog(i)) : "") + "</span>" + flags(i) +
      '</span></span><span class="row__side"><span class="row__qty">' + qty(i.onHand, i.unit) + "</span>" + itemSt(i) + "</span></a></li>";
  }

  function viewItem(id) {
    var i = itemById(id);
    if (!i) return notFound();
    var stt = statusOf(i);
    var uses = state.data.usage.filter(function (u) { return u.itemId === id; });
    var open = state.data.orders.filter(function (o) { return o.itemId === id && L.OPEN_ORDER[o.status]; });
    var html = '<div class="detail"><a class="crumb" href="#/supplies">Supplies</a><h1>' + esc(i.name) + '</h1><p class="muted">' + esc(i.group) + "</p>";
    if (i.hazard) html += '<div class="callout"><b>Safety:</b> ' + esc(i.hazard) + "</div>";
    html += '<div class="big"><div class="big__qty"><div class="big__label">On the shelf</div><div class="big__num">' + (i.onHand == null ? "?" : n(i.onHand)) + '</div><div>' + esc(i.unit) +
      (i.lastCounted ? ' · counted ' + esc(fmtDay(i.lastCounted)) + (i.countedBy ? " by " + esc(i.countedBy) : "") : " · never counted here") + '</div></div><div class="big__side">' + itemSt(i) +
      '<span class="small">Reorder at ' + n(i.reorderAt) + " " + esc(un(i.reorderAt, i.unit)) + "</span>" + (open.length ? '<span class="small">' + open.length + " order" + (open.length > 1 ? "s" : "") + " open</span>" : "") + flags(i) + "</div></div>";

    html += '<form class="form" data-form="count" data-id="' + esc(i.id) + '"><fieldset><legend>Count what\'s on the shelf</legend>' +
      '<div class="toolbar" style="margin:0"><div class="field"><label for="c-n">How many ' + esc(i.unit) + ' are there now?</label><input type="number" id="c-n" min="0" step="any" inputmode="decimal" value="' + (i.onHand == null ? "" : i.onHand) + '" required></div>' +
      '<button class="btn btn--solid" type="submit">Save count</button></div><p class="small muted" style="margin-top:8px">Count unopened packs and estimate opened ones. For powder pillows, count the pillows, not the boxes.</p></fieldset></form>';
    html += '<form class="form" data-form="adjust" data-id="' + esc(i.id) + '" style="margin-top:16px"><fieldset><legend>Took some out, or put some back?</legend>' +
      '<div class="toolbar" style="margin:0"><div class="field"><label for="a-n">Amount (' + esc(i.unit) + ')</label><input type="number" id="a-n" min="0" step="any" inputmode="decimal" required></div>' +
      '<div class="field"><label for="a-why">Why</label><select id="a-why"><option>Used in lab</option><option>Made a dilution</option><option>Spilled or broken</option><option>Expired, thrown out</option><option>Received</option><option>Borrowed or returned</option><option>Other</option></select></div>' +
      '<button class="btn" type="submit" name="dir" value="-1">Take out</button><button class="btn" type="submit" name="dir" value="1">Add</button></div></fieldset></form>';

    if (i.about) html += "<h2>What it's for</h2><p class=\"prose\">" + esc(i.about) + "</p>";
    html += "<h2>Used in</h2>";
    html += uses.length ? '<ul class="rows">' + uses.map(function (u) {
      var lab = labById(u.labId);
      return '<li class="row"><a href="#/lab/' + esc(u.labId) + '"><span class="row__main"><span class="row__title">' + esc(lab ? lab.name : u.labId) + "</span>" + (u.note ? '<span class="row__meta">' + esc(u.note) + "</span>" : "") + '</span><span class="row__side">' +
        (u.kind === "use" ? "<b>" + n(u.amount) + " " + esc(un(u.amount, i.unit)) + "</b><span class=\"small\">used per section</span>" : "<b>keep " + n(u.amount) + " " + esc(un(u.amount, i.unit)) + "</b><span class=\"small\">on the shelf</span>") + "</span></a></li>";
    }).join("") + "</ul>" : '<p class="empty">Not on any lab\'s supply list. Add it from a lab page if a lab uses it.</p>';

    html += "<h2>Ordering</h2><dl class=\"kv\"><dt>Vendor</dt><dd>" + esc(i.vendor || "Not set") + "</dd>" +
      (catalog(i) ? "<dt>Catalog numbers</dt><dd class=\"mono\">" + esc(catalog(i)) + "</dd>" : "") +
      "<dt>Comes as</dt><dd>" + esc(i.orderUnit || i.unit) + (i.perOrderUnit ? " (" + n(i.perOrderUnit) + " " + esc(un(i.perOrderUnit, i.unit)) + ")" : "") + "</dd>" +
      "<dt>Price</dt><dd>" + (i.price != null ? money(i.price) + " per " + esc(i.orderUnit || i.unit) : "Not listed") + "</dd>" +
      "<dt>Lead time</dt><dd>About " + L.leadDays(i) + " days</dd>" +
      (i.link ? '<dt>Product page</dt><dd><a href="' + esc(i.link) + '" target="_blank" rel="noopener">Open</a></dd>' : "") + "</dl>";
    if (open.length) html += '<p style="margin-top:12px">' + open.map(function (o) { return o.packs + " × " + esc(i.orderUnit || i.unit) + " " + (o.status === "ordered" ? "ordered " + esc(fmtStamp(o.orderedAt)) : "requested " + esc(fmtStamp(o.requestedAt))); }).join("; ") + ' · <a href="#/orders">Orders</a></p>';
    html += '<div class="actions"><button class="btn" type="button" data-act="order-item" data-id="' + esc(i.id) + '">Add to the order list</button></div>';

    html += "<h2>Details</h2><dl class=\"kv\"><dt>Where it's kept</dt><dd>" + esc(i.location || "Not set yet") + "</dd>" +
      "<dt>Expires</dt><dd>" + (i.expires ? esc(fmtDay(i.expires, true)) : "Not recorded") + "</dd>" +
      "<dt>Chemical</dt><dd>" + (i.chemical ? "Yes. New bottles get an EHS barcode before they go on the shelf." : "No") + "</dd>" +
      (i.notes ? "<dt>Notes</dt><dd>" + esc(i.notes) + "</dd>" : "") + "</dl>";
    html += '<div class="actions"><a class="btn" href="#/item/' + esc(i.id) + '/edit">Edit details</a></div>';
    html += "<h2>History</h2>" + logList(state.data.log.filter(function (g) { return g.itemId === id; }).slice(-15).reverse(), false);
    return wrap(html + "</div>");
  }

  function viewItemEdit(id) {
    var i = id ? itemById(id) : { id: "", name: "", group: route.query.group || "", unit: "", onHand: null, reorderAt: 0, location: "", vendor: "", hach: "", fisher: "", other: "", orderUnit: "", perOrderUnit: null, price: null, leadDays: null, chemical: false, hazard: "", expires: "", about: "", notes: "", link: "" };
    if (!i) return notFound();
    function f(name, label, val, type, hint, extra) {
      return '<div class="field' + (extra || "") + '"><label for="e-' + name + '">' + label + "</label>" +
        (type === "textarea" ? '<textarea id="e-' + name + '" name="' + name + '">' + esc(val) + "</textarea>"
          : '<input type="' + (type || "text") + '" id="e-' + name + '" name="' + name + '" value="' + esc(val == null ? "" : val) + '"' + (type === "number" ? ' step="any" min="0" inputmode="decimal"' : "") + ">") +
        (hint ? "<small>" + hint + "</small>" : "") + "</div>";
    }
    var html = '<div class="detail"><a class="crumb" href="' + (id ? "#/item/" + esc(id) : "#/supplies") + '">' + (id ? esc(i.name) : "Supplies") + "</a><h1>" + (id ? "Edit " + esc(i.name) : "Add a supply") + "</h1>";
    html += '<form class="form" data-form="item" data-id="' + esc(id || "") + '" style="margin-top:20px"><div class="form__grid">' +
      f("name", "Name", i.name, "text", "", " span2") +
      '<div class="field"><label for="e-group">Lab group</label><input type="text" id="e-group" name="group" list="group-list" value="' + esc(i.group) + '"><datalist id="group-list">' + groups().map(function (g) { return "<option>" + esc(g) + "</option>"; }).join("") + "</datalist></div>" +
      f("unit", "Counted in", i.unit, "text", "pillows, mL, bottles, boxes…") +
      (id ? "" : f("onHand", "How many now", i.onHand, "number", "Leave empty if you haven't counted.")) +
      f("reorderAt", "Reorder when at or below", i.reorderAt, "number") +
      f("location", "Where it's kept", i.location, "text", "Cabinet, shelf or room") +
      f("expires", "Expires", i.expires, "date") +
      f("vendor", "Vendor", i.vendor, "text", "Hach, Fisher, Amazon…") +
      f("leadDays", "Lead time (days)", i.leadDays, "number", "Hach often takes 3 to 5 weeks.") +
      f("hach", "Hach catalog number", i.hach) + f("fisher", "Fisher catalog number", i.fisher) +
      f("other", "Other catalog number", i.other) + f("link", "Product page link", i.link, "url") +
      f("orderUnit", "Comes as", i.orderUnit, "text", "e.g. pack of 100, 1 L bottle") +
      f("perOrderUnit", "How many in one", i.perOrderUnit, "number", "In the counted unit. Empty if unknown.") +
      f("price", "Price for one (USD)", i.price, "number") +
      '<div class="field"><span>Chemical</span><label class="check"><input type="checkbox" name="chemical"' + (i.chemical ? " checked" : "") + "> Yes, needs an EHS barcode</label></div>" +
      f("hazard", "Safety note", i.hazard, "textarea", "Shown at the top of the supply page.", " span2") +
      f("about", "What it's for", i.about, "textarea", "One or two plain sentences for a new TA.", " span2") +
      f("notes", "Notes", i.notes, "textarea", "", " span2") +
      '</div><div class="actions"><button class="btn btn--solid" type="submit">' + (id ? "Save changes" : "Add supply") + "</button>" +
      '<a class="btn btn--quiet" href="' + (id ? "#/item/" + esc(id) : "#/supplies") + '">Cancel</a>' +
      (id ? '<button class="btn btn--danger" type="button" data-act="delete-item" data-id="' + esc(id) + '" style="margin-left:auto">Delete supply</button>' : "") + "</div></form>";
    return wrap(html + "</div>");
  }

  /* ---------------------------------------------------------------- views: labs */
  function viewLabs() {
    var p = plan();
    var html = '<div class="head"><h1>Labs</h1><p>Each lab has a supply list: what gets used up per section, and what just has to be on the shelf. Open a lab to check supplies for any number of sections.</p></div>';
    var mods = [];
    state.data.labs.forEach(function (l) { if (mods.indexOf(l.module) < 0) mods.push(l.module); });
    mods.forEach(function (m) {
      html += '<h2 class="group-h">' + esc(m || "Other") + '</h2><ul class="rows">' + state.data.labs.filter(function (l) { return l.module === m; }).map(function (l) {
        var nextS = p.sessions.filter(function (s) { return s.session.labId === l.id; })[0];
        var count = state.data.usage.filter(function (u) { return u.labId === l.id; }).length;
        return '<li class="row"><a href="#/lab/' + esc(l.id) + '"><span class="row__main"><span class="row__title">' + esc(l.name) + '</span><span class="row__meta">' + count + " supplies on the list</span></span>" +
          '<span class="row__side">' + (nextS ? "<span>" + esc(fmtDay(nextS.session.date)) + "</span>" + sessionSt(nextS) : '<span class="small muted">Not scheduled</span>') + "</span></a></li>";
      }).join("") + "</ul>";
    });
    html += '<div class="actions"><a class="btn" href="#/lab/new">Add a lab</a></div>';
    return wrap(html);
  }

  function viewLab(id) {
    var l = labById(id); if (!l) return notFound();
    var sections = Math.max(1, parseInt(route.query.sections, 10) || L.DEFAULT_SECTIONS);
    var lines = state.data.usage.filter(function (u) { return u.labId === id; });
    var upcoming = plan().sessions.filter(function (s) { return s.session.labId === id; });
    var html = '<div class="detail"><a class="crumb" href="#/labs">Labs</a><h1>' + esc(l.name) + '</h1><p class="muted">' + esc(l.module) + "</p>" + (l.about ? '<p class="prose" style="margin-top:12px">' + esc(l.about) + "</p>" : "");
    html += '<h2>Supply check</h2><form class="toolbar" data-form="lab-sections" data-id="' + esc(id) + '" style="margin-top:12px"><div class="field" style="max-width:12rem"><label for="ls-n">Sections</label><input type="number" id="ls-n" min="1" step="1" value="' + sections + '"></div><button class="btn" type="submit">Check</button></form>';
    if (!lines.length) html += '<p class="empty">No supplies on this lab\'s list yet.</p>';
    else {
      html += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">Supply</th><th scope="col" class="num">Per section</th><th scope="col" class="num">Needed for ' + sections + '</th><th scope="col" class="num">On the shelf</th><th scope="col">Status</th></tr></thead><tbody>' +
        lines.map(function (u) {
          var it = itemById(u.itemId); if (!it) return "";
          var needed = u.kind === "use" ? u.amount * sections : u.amount;
          var have = it.onHand;
          var s = have == null ? st("unknown", "Not counted") : have >= needed ? st("ok", "Enough") : st("out", "Short " + n(needed - have));
          return '<tr><td><a href="#/item/' + esc(it.id) + '">' + esc(it.name) + "</a>" + (u.note ? '<br><span class="small muted">' + esc(u.note) + "</span>" : "") + '</td><td class="num">' +
            (u.kind === "use" ? n(u.amount) + " " + esc(un(u.amount, it.unit)) : '<span class="small">keep on shelf</span>') + '</td><td class="num">' + n(needed) + " " + esc(un(needed, it.unit)) + '</td><td class="num">' + qty(have, it.unit) + "</td><td>" + s + "</td></tr>";
        }).join("") + "</tbody></table></div>";
      html += '<p class="section__note">This checks one session against today\'s shelf. The Schedule also counts earlier labs that use the same supplies.</p>';
    }
    html += '<div class="actions"><a class="btn" href="#/lab/' + esc(id) + '/edit">Edit supply list</a><a class="btn" href="#/schedule?lab=' + esc(id) + '">Schedule this lab</a></div>';
    html += "<h2>Coming up</h2>" + (upcoming.length ? '<ul class="rows">' + upcoming.map(sessionRow).join("") + "</ul>" : '<p class="empty">Not scheduled.</p>');
    return wrap(html + "</div>");
  }

  function viewLabEdit(id) {
    var l = id ? labById(id) : { id: "", name: "", module: "", about: "" };
    if (!l) return notFound();
    var lines = id ? state.data.usage.filter(function (u) { return u.labId === id; }) : [];
    var opts = function (sel) {
      return '<option value="">Pick a supply</option>' + groups().map(function (g) {
        return '<optgroup label="' + esc(g) + '">' + items().filter(function (i) { return i.group === g; }).map(function (i) {
          return '<option value="' + esc(i.id) + '"' + (sel === i.id ? " selected" : "") + ">" + esc(i.name) + " (" + esc(i.unit) + ")</option>";
        }).join("") + "</optgroup>";
      }).join("");
    };
    var row = function (u, k) {
      return '<tr data-line><td><label class="sr" for="u-i' + k + '">Supply</label><select id="u-i' + k + '" name="itemId">' + opts(u.itemId) + "</select></td>" +
        '<td><label class="sr" for="u-k' + k + '">How it\'s used</label><select id="u-k' + k + '" name="kind"><option value="use"' + (u.kind === "use" ? " selected" : "") + '>Used up, per section</option><option value="keep"' + (u.kind === "keep" ? " selected" : "") + ">Must be on the shelf</option></select></td>" +
        '<td><label class="sr" for="u-a' + k + '">Amount</label><input type="number" id="u-a' + k + '" name="amount" step="any" min="0" value="' + (u.amount == null ? "" : u.amount) + '"></td>' +
        '<td><label class="sr" for="u-n' + k + '">Note</label><input type="text" id="u-n' + k + '" name="note" value="' + esc(u.note || "") + '"></td>' +
        '<td><button class="btn btn--quiet btn--sm" type="button" data-act="drop-line">Remove</button></td></tr>';
    };
    afterRender.lab = function () {
      var tb = $main.querySelector("#lines");
      if (tb) tb.setAttribute("data-next", String(lines.length + 1));
      afterRender.lab.row = row;
    };
    var html = '<div class="detail" style="max-width:none"><a class="crumb" href="' + (id ? "#/lab/" + esc(id) : "#/labs") + '">' + (id ? esc(l.name) : "Labs") + "</a><h1>" + (id ? "Edit " + esc(l.name) : "Add a lab") + "</h1>";
    html += '<form class="form" data-form="lab" data-id="' + esc(id || "") + '" style="margin-top:20px;max-width:none"><div class="form__grid" style="max-width:46rem">' +
      '<div class="field"><label for="l-name">Lab name</label><input type="text" id="l-name" name="name" value="' + esc(l.name) + '" required></div>' +
      '<div class="field"><label for="l-mod">Module</label><input type="text" id="l-mod" name="module" value="' + esc(l.module) + '"></div>' +
      '<div class="field span2"><label for="l-about">What students do</label><textarea id="l-about" name="about">' + esc(l.about) + "</textarea></div></div>" +
      '<h2>Supply list</h2><p class="section__note">"Used up, per section" amounts are multiplied by the number of sections. "Must be on the shelf" means the lab can\'t run without at least that much, like an opened titrator cartridge or an indicator bottle.</p>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">Supply</th><th scope="col">How it\'s used</th><th scope="col">Amount</th><th scope="col">Note</th><th scope="col"><span class="sr">Remove</span></th></tr></thead><tbody id="lines">' +
      lines.map(row).join("") + "</tbody></table></div>" +
      '<div class="actions"><button class="btn" type="button" data-act="add-line">Add a supply to the list</button></div>' +
      '<div class="actions"><button class="btn btn--solid" type="submit">Save lab</button><a class="btn btn--quiet" href="' + (id ? "#/lab/" + esc(id) : "#/labs") + '">Cancel</a>' +
      (id ? '<button class="btn btn--danger" type="button" data-act="delete-lab" data-id="' + esc(id) + '" style="margin-left:auto">Delete lab</button>' : "") + "</div></form>";
    return wrap(html + "</div>");
  }

  /* ---------------------------------------------------------------- views: schedule */
  function sessionRow(sp) {
    var s = sp.session;
    return '<li class="row"><a href="#/session/' + esc(s.id) + '"><span class="row__main"><span class="row__title">' + esc(sp.lab.name) + '</span><span class="row__meta">' +
      esc(fmtDay(s.date)) + " · " + esc(rel(s.date)) + " · " + s.sections + " sections" + (sp.status === "short" ? " · short " + sp.shortLines.length + " supplies" : "") +
      '</span></span><span class="row__side">' + sessionSt(sp) + "</span></a></li>";
  }
  function viewSchedule() {
    var p = plan(), t = today();
    var past = state.data.sessions.filter(function (s) { return s.status === "done" || s.date < t; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var html = '<div class="head"><h1>Schedule</h1><p>Add every lab session for the semester. The site walks through them in order, uses up stock as each one runs, and shows which session will come up short.</p></div>';
    html += '<section class="section" aria-labelledby="h-add"><h2 id="h-add">Add a session</h2><form class="toolbar" data-form="session" style="margin-top:12px">' +
      '<div class="field"><label for="s-lab">Lab</label><select id="s-lab" name="labId" required><option value="">Pick a lab</option>' +
      state.data.labs.map(function (l) { return '<option value="' + esc(l.id) + '"' + (route.query.lab === l.id ? " selected" : "") + ">" + esc(l.name) + "</option>"; }).join("") + "</select></div>" +
      '<div class="field"><label for="s-date">Date</label><input type="date" id="s-date" name="date" required min="' + L.addDays(t, -60) + '"></div>' +
      '<div class="field" style="max-width:10rem"><label for="s-sec">Sections</label><input type="number" id="s-sec" name="sections" min="1" step="1" value="' + L.DEFAULT_SECTIONS + '"></div>' +
      '<div class="field field--grow"><label for="s-notes">Notes (optional)</label><input type="text" id="s-notes" name="notes"></div>' +
      '<button class="btn btn--solid" type="submit">Add session</button></form>' +
      '<p class="section__note">If a lab runs over several days in one week, add it once with the total number of sections.</p></section>';
    html += '<section class="section" aria-labelledby="h-up"><h2 id="h-up">Coming up</h2>' + (p.sessions.length ? '<ul class="rows">' + p.sessions.map(sessionRow).join("") + "</ul>" : '<p class="empty">Nothing scheduled yet.</p>') + "</section>";
    if (past.length) {
      html += '<section class="section" aria-labelledby="h-past"><h2 id="h-past">Past sessions</h2><ul class="rows">' + past.slice(0, 30).map(function (s) {
        var l = labById(s.labId);
        return '<li class="row"><a href="#/session/' + esc(s.id) + '"><span class="row__main"><span class="row__title">' + esc(l ? l.name : s.labId) + '</span><span class="row__meta">' + esc(fmtDay(s.date)) + " · " + s.sections + " sections</span></span>" +
          '<span class="row__side">' + (s.status === "done" ? st("ok", "Use recorded") : st("low", "Use not recorded")) + "</span></a></li>";
      }).join("") + "</ul></section>";
    }
    return wrap(html);
  }

  function viewSession(id) {
    var s = L.byId(state.data.sessions)[id]; if (!s) return notFound();
    var lab = labById(s.labId) || { name: s.labId };
    var sp = plan().sessions.filter(function (x) { return x.session.id === id; })[0];
    var lines = state.data.usage.filter(function (u) { return u.labId === s.labId && itemById(u.itemId); });
    var html = '<div class="detail"><a class="crumb" href="#/schedule">Schedule</a><h1>' + esc(lab.name) + '</h1><p class="muted">' + esc(fmtDay(s.date, true)) + " · " + esc(rel(s.date)) + " · " + s.sections + " sections</p>";
    if (s.notes) html += '<p class="prose" style="margin-top:8px">' + esc(s.notes).replace(/\n/g, "<br>") + "</p>";
    if (sp) {
      html += '<p style="margin-top:12px">' + sessionSt(sp) + "</p>";
      if (sp.shortLines.length) {
        html += '<div class="callout"><b>Short for this session</b> (after earlier sessions use their share):<ul>' + sp.shortLines.map(function (l) {
          return '<li><a href="#/item/' + esc(l.item.id) + '">' + esc(l.item.name) + "</a>: need " + n(l.need) + ", will have " + n(l.have) + " " + esc(un(l.have, l.item.unit)) + "</li>";
        }).join("") + "</ul>" + (sp.orderBy < today() ? "<p><b>The usual lead time has passed.</b> Order today and ask about faster shipping.</p>" : "<p>Order by <b>" + esc(fmtDay(sp.orderBy)) + "</b>.</p>") +
          '<div class="actions"><button class="btn btn--solid" type="button" data-act="order-short" data-id="' + esc(id) + '">Add the missing supplies to the order list</button></div></div>';
      }
    }
    html += '<h2>Pick list</h2><p class="section__note">Before the lab, pull these from the shelf and tick them off. The ticks are only on this device.</p>';
    html += lines.length ? '<ul class="pick">' + lines.map(function (u, k) {
      var it = itemById(u.itemId);
      var amt = u.kind === "use" ? n(u.amount * s.sections) + " " + esc(un(u.amount * s.sections, it.unit)) + ' <span class="small muted">(' + n(u.amount) + " per section)</span>" : "at least " + n(u.amount) + " " + esc(un(u.amount, it.unit));
      return '<li><label><input type="checkbox" data-pick="' + esc(id + ":" + it.id) + '"' + (store.get("pick." + id + ":" + it.id) ? " checked" : "") + '><span class="pick__name"><b>' + esc(it.name) + "</b>" + (it.location ? '<br><span class="small muted">' + esc(it.location) + "</span>" : "") + "</span><span>" + amt + "</span></label></li>";
    }).join("") + "</ul>" : '<p class="empty">This lab has no supply list. <a href="#/lab/' + esc(s.labId) + '/edit">Add one</a>.</p>';

    if (s.status === "done") {
      html += "<h2>After the lab</h2><p>" + st("ok", "Use recorded") + " " + esc(fmtStamp(s.recordedAt)) + (s.recordedBy ? " by " + esc(s.recordedBy) : "") + "</p>";
    } else {
      var useLines = lines.filter(function (u) { return u.kind === "use"; });
      html += '<h2>After the lab: record what was used</h2><p class="section__note">The amounts are filled in from the plan. Change any that were different, then save. This takes them off the shelf counts.</p>';
      html += '<form class="form" data-form="record" data-id="' + esc(id) + '" style="max-width:none">';
      html += useLines.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">Supply</th><th scope="col" class="num">Planned</th><th scope="col">Actually used</th></tr></thead><tbody>' + useLines.map(function (u, k) {
        var it = itemById(u.itemId);
        return '<tr><td><label for="r-' + k + '">' + esc(it.name) + '</label></td><td class="num">' + n(u.amount * s.sections) + " " + esc(un(u.amount * s.sections, it.unit)) + '</td><td><input type="number" id="r-' + k + '" data-item="' + esc(it.id) + '" min="0" step="any" inputmode="decimal" value="' + L.round(u.amount * s.sections, 3) + '"> <span class="small">' + esc(it.unit) + "</span></td></tr>";
      }).join("") + "</tbody></table></div>" : '<p class="empty">Nothing on this lab\'s list gets used up.</p>';
      html += '<div class="field" style="max-width:46rem"><label for="r-notes">Anything to remember for next time? (optional)</label><textarea id="r-notes" placeholder="e.g. Section 3 spilled a bottle of buffer; ran out of delivery tubes"></textarea></div>' +
        '<div class="actions"><button class="btn btn--solid" type="submit">Save what was used</button></div></form>';
    }
    html += '<h2>Change this session</h2><form class="toolbar" data-form="session" data-id="' + esc(id) + '" style="margin-top:12px"><input type="hidden" name="labId" value="' + esc(s.labId) + '">' +
      '<div class="field"><label for="se-date">Date</label><input type="date" id="se-date" name="date" value="' + esc(s.date) + '" required></div>' +
      '<div class="field" style="max-width:10rem"><label for="se-sec">Sections</label><input type="number" id="se-sec" name="sections" min="1" step="1" value="' + s.sections + '"></div>' +
      '<div class="field field--grow"><label for="se-notes">Notes</label><input type="text" id="se-notes" name="notes" value="' + esc(s.notes) + '"></div>' +
      '<button class="btn" type="submit">Save</button><button class="btn btn--danger" type="button" data-act="delete-session" data-id="' + esc(id) + '">Remove session</button></form>';
    return wrap(html + "</div>");
  }

  /* ---------------------------------------------------------------- views: count */
  function viewCount() {
    var g = route.query.group || "";
    var list = items().filter(function (i) { return !g || i.group === g; });
    var html = '<div class="head"><h1>Count the shelf</h1><p>Walk the shelves with a phone or tablet and type what\'s there. Only the boxes you change are saved. Count unopened packs and estimate opened ones.</p></div>';
    html += '<form class="toolbar no-print" data-form="count-group" onsubmit="return false"><div class="field"><label for="cg">Lab group</label><select id="cg"><option value="">Everything</option>' +
      groups().map(function (x) { return "<option" + (x === g ? " selected" : "") + ">" + esc(x) + "</option>"; }).join("") + '</select></div><button class="btn" type="button" data-act="print">Print a count sheet</button></form>';
    html += '<form data-form="counts">';
    groups().forEach(function (x) {
      var rows = list.filter(function (i) { return i.group === x; });
      if (!rows.length) return;
      html += '<div class="tbl-wrap"><table class="tbl"><caption>' + esc(x) + '</caption><thead><tr><th scope="col">Supply</th><th scope="col">Last count</th><th scope="col">Count now</th></tr></thead><tbody>' +
        rows.map(function (i) {
          return '<tr><td><label for="cnt-' + esc(i.id) + '"><b>' + esc(i.name) + "</b></label>" + (i.location ? '<br><span class="small muted">' + esc(i.location) + "</span>" : "") + "</td>" +
            '<td><span class="small">' + qty(i.onHand, i.unit) + (i.lastCounted ? "<br>" + esc(fmtDay(i.lastCounted)) : "") + "</span></td>" +
            '<td style="white-space:nowrap"><input type="number" id="cnt-' + esc(i.id) + '" data-item="' + esc(i.id) + '" data-was="' + (i.onHand == null ? "" : i.onHand) + '" min="0" step="any" inputmode="decimal" placeholder="' + (i.onHand == null ? "?" : esc(i.onHand)) + '" style="max-width:8rem"> <span class="small">' + esc(i.unit) + "</span></td></tr>";
        }).join("") + "</tbody></table></div>";
    });
    html += '<div class="actions" style="position:sticky;bottom:0;background:var(--paper);padding:12px 0;border-top:2px solid var(--rule-strong)"><button class="btn btn--solid" type="submit">Save counts</button><span id="count-changed" class="small muted" aria-live="polite">No changes yet</span></div></form>';
    afterRender.count = function () {
      var sel = $main.querySelector("#cg");
      sel.addEventListener("change", function () { location.hash = "#/count" + (sel.value ? "?group=" + encodeURIComponent(sel.value) : ""); });
      var form = $main.querySelector('[data-form="counts"]');
      form.addEventListener("input", function () {
        var c = changedCounts(form).length;
        document.getElementById("count-changed").textContent = c ? c + " to save" : "No changes yet";
      });
    };
    return wrap(html);
  }
  /** Every box with a number in it. Typing the same number as before still confirms the count. */
  function changedCounts(form) {
    var out = [];
    form.querySelectorAll("input[data-item]").forEach(function (inp) {
      if (inp.value === "") return;
      var v = parseFloat(inp.value);
      if (isFinite(v) && v >= 0) out.push({ id: inp.getAttribute("data-item"), onHand: v });
    });
    return out;
  }

  /* ---------------------------------------------------------------- views: orders */
  function viewOrders() {
    var p = plan(), t = today();
    var orders = state.data.orders;
    var openIds = {}; orders.forEach(function (o) { if (L.OPEN_ORDER[o.status]) openIds[o.itemId] = true; });
    var sug = p.suggestions.filter(function (s) { return !s.uncounted; });
    var countFirst = p.suggestions.filter(function (s) { return s.uncounted; });
    var html = '<div class="head"><h1>Orders</h1><p>The department orders for the lab. Build the list here, copy it into an email, then mark each item ordered and received so the counts stay right.</p></div>';

    html += '<section class="section" aria-labelledby="h-sug"><h2 id="h-sug">Suggested <span class="small">from the schedule and reorder levels</span></h2>';
    if (!sug.length) html += '<p class="empty">Nothing suggested. Everything scheduled is covered, counting what\'s already on order.</p>';
    else {
      html += '<form data-form="suggest"><div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col"><span class="sr">Pick</span></th><th scope="col">Supply</th><th scope="col">Why</th><th scope="col">Order by</th><th scope="col">How many</th><th scope="col" class="num">Est. cost</th></tr></thead><tbody>' +
        sug.map(function (s, k) {
          var late = s.orderBy && s.orderBy < t;
          return '<tr><td><input type="checkbox" id="sg-' + k + '" data-item="' + esc(s.item.id) + '" checked aria-label="Order ' + esc(s.item.name) + '"></td>' +
            '<td><label for="sg-' + k + '"><a href="#/item/' + esc(s.item.id) + '">' + esc(s.item.name) + '</a></label><br><span class="small muted">' + esc(s.item.vendor) + (catalog(s.item) ? " · " + esc(catalog(s.item)) : "") + "</span></td>" +
            '<td class="small">' + esc(s.reason) + (s.neededBy ? "; needed " + esc(fmtDay(s.neededBy)) : "") + (openIds[s.item.id] ? "; some already on order" : "") + "</td>" +
            "<td>" + (s.orderBy ? (late ? st("out", "Now") : esc(fmtDay(s.orderBy))) : '<span class="small muted">When convenient</span>') + "</td>" +
            '<td style="white-space:nowrap"><input type="number" min="1" step="1" value="' + s.packs + '" data-packs="' + esc(s.item.id) + '" aria-label="How many ' + esc(s.item.orderUnit || s.item.unit) + '" style="max-width:6rem"> <span class="small">× ' + esc(s.item.orderUnit || s.item.unit) + "</span></td>" +
            '<td class="num">' + (s.cost != null ? money(s.cost) : '<span class="small muted">no price</span>') + "</td></tr>";
        }).join("") + '</tbody></table></div><div class="actions"><button class="btn btn--solid" type="submit">Add ticked items to the order list</button></div></form>';
    }
    if (countFirst.length) {
      html += '<h3 class="group-h">Count these first</h3><p class="section__note">These look like they may be needed, but nobody has counted them. Count them before ordering.</p><ul class="rows">' +
        countFirst.map(function (s) { return itemRow(s.item); }).join("") + "</ul>";
    }
    html += "</section>";

    var requested = orders.filter(function (o) { return o.status === "requested"; });
    html += '<section class="section" aria-labelledby="h-req"><h2 id="h-req">Order list <span class="small">ready to send to the department</span></h2>';
    if (!requested.length) html += '<p class="empty">The order list is empty.</p>';
    else {
      html += vendorTables(requested, function (o) {
        return '<button class="btn btn--sm" type="button" data-act="order-status" data-status="ordered" data-id="' + esc(o.id) + '">Mark ordered</button> <button class="btn btn--quiet btn--sm" type="button" data-act="order-status" data-status="cancelled" data-id="' + esc(o.id) + '">Remove</button>';
      });
      html += '<div class="actions"><button class="btn btn--solid" type="button" data-act="copy-email">Copy as an email</button><button class="btn" type="button" data-act="order-all">Mark all ordered</button><button class="btn" type="button" data-act="print">Print</button></div>';
    }
    html += '<div class="actions no-print"><button class="btn" type="button" data-act="order-item">Add something else</button></div></section>';

    var ordered = orders.filter(function (o) { return o.status === "ordered"; });
    html += '<section class="section" aria-labelledby="h-way"><h2 id="h-way">On the way</h2>';
    html += ordered.length ? vendorTables(ordered, function (o) {
      return '<button class="btn btn--sm" type="button" data-act="receive" data-id="' + esc(o.id) + '">Mark received</button>';
    }, true) : '<p class="empty">Nothing on the way.</p>';
    html += "</section>";

    var done = orders.filter(function (o) { return o.status === "received"; }).sort(function (a, b) { return a.receivedAt < b.receivedAt ? 1 : -1; }).slice(0, 12);
    if (done.length) {
      html += '<section class="section" aria-labelledby="h-rec"><h2 id="h-rec">Received recently</h2><ul class="rows">' + done.map(function (o) {
        var it = itemById(o.itemId);
        return '<li class="row"><div class="row__body"><span class="row__main"><span class="row__title">' + esc(it ? it.name : o.itemId) + '</span><span class="row__meta">' + o.packs + " × " + esc(it ? it.orderUnit || it.unit : "") + '</span></span><span class="row__side small">' + esc(fmtStamp(o.receivedAt)) + (o.receivedBy ? " · " + esc(o.receivedBy) : "") + "</span></div></li>";
      }).join("") + "</ul></section>";
    }
    return wrap(html);
  }
  function vendorTables(list, actions, showWhen) {
    var byV = {};
    list.forEach(function (o) { var it = itemById(o.itemId); var v = (it && it.vendor) || o.vendor || "Other"; (byV[v] = byV[v] || []).push(o); });
    return Object.keys(byV).sort().map(function (v) {
      var total = 0, unknown = false;
      var rows = byV[v].map(function (o) {
        var it = itemById(o.itemId) || { name: o.itemId, unit: "" };
        var cost = it.price != null ? it.price * o.packs : null;
        if (cost == null) unknown = true; else total += cost;
        return "<tr><td>" + (it.id ? '<a href="#/item/' + esc(it.id) + '">' + esc(it.name) + "</a>" : esc(it.name)) + (o.note ? '<br><span class="small muted">' + esc(o.note) + "</span>" : "") +
          (showWhen ? '<br><span class="small muted">ordered ' + esc(fmtStamp(o.orderedAt)) + "</span>" : "") + '</td><td class="mono small">' + esc(catalog(it)) + '</td><td class="num">' + o.packs + " × " + esc(it.orderUnit || it.unit) +
          '</td><td class="num">' + (cost != null ? money(cost) : "–") + '</td><td class="no-print" style="white-space:nowrap">' + actions(o) + "</td></tr>";
      }).join("");
      return '<div class="tbl-wrap"><table class="tbl"><caption>' + esc(v) + '</caption><thead><tr><th scope="col">Supply</th><th scope="col">Catalog</th><th scope="col" class="num">Quantity</th><th scope="col" class="num">Est. cost</th><th scope="col" class="no-print"><span class="sr">Actions</span></th></tr></thead><tbody>' + rows +
        '</tbody><tfoot><tr><td colspan="3">Estimated total' + (unknown ? " (some prices missing)" : "") + '</td><td class="num">' + money(total) + '</td><td class="no-print"></td></tr></tfoot></table></div>';
    }).join("");
  }
  function orderEmailText() {
    var requested = state.data.orders.filter(function (o) { return o.status === "requested"; });
    var byV = {}, grand = 0;
    requested.forEach(function (o) { var it = itemById(o.itemId); var v = (it && it.vendor) || "Other"; (byV[v] = byV[v] || []).push(o); });
    var s = state.data.settings || {};
    var lines = ["Hi" + (s.orderContactName ? " " + s.orderContactName : "") + ",", "", "Could you please order the following for the CE 323 lab?", ""];
    Object.keys(byV).sort().forEach(function (v) {
      lines.push(v.toUpperCase());
      byV[v].forEach(function (o) {
        var it = itemById(o.itemId) || { name: o.itemId };
        var cost = it.price != null ? it.price * o.packs : null; if (cost) grand += cost;
        lines.push("- " + o.packs + " x " + (it.orderUnit || it.unit || "") + ": " + it.name + (catalog(it) ? " (" + catalog(it) + ")" : "") + (cost != null ? ", about " + money(cost) : "") + (it.link ? " " + it.link : ""));
      });
      lines.push("");
    });
    lines.push("Estimated total: about " + money(grand) + " before shipping.", "", "Chemicals will go to EHS for barcoding when they arrive.", "", "Thank you,", who() || "");
    return lines.join("\n");
  }

  /* ---------------------------------------------------------------- views: equipment */
  var EQ = { ok: ["ok", "Working"], "needs-service": ["low", "Needs service"], "out-of-service": ["out", "Out of service"] };
  function viewEquipment() {
    var html = '<div class="head"><h1>Equipment</h1><p>Instruments and gear the labs depend on. Note anything that needs calibration or repair so it gets fixed before the lab that uses it.</p></div>';
    html += '<ul class="rows">' + state.data.equipment.map(function (e) {
      var w = EQ[e.status] || EQ.ok;
      return '<li class="row"><div class="row__body"><span class="row__main"><span class="row__title">' + esc(e.name) + '</span><span class="row__meta">' +
        (e.count != null ? "<span>" + (e.working != null && e.working !== e.count ? e.working + " of " + e.count + " working" : e.count + " total") + "</span>" : "<span>Count not recorded</span>") +
        (e.location ? "<span>" + esc(e.location) + "</span>" : "") + (e.labs ? "<span>Labs: " + esc(e.labs.split(",").map(function (x) { var l = labById(x.trim()); return l ? l.name : x.trim(); }).join(", ")) + "</span>" : "") +
        "</span>" + (e.notes ? '<span class="small">' + esc(e.notes) + "</span>" : "") + '</span><span class="row__side">' + st(w[0], w[1]) +
        '<button class="btn btn--sm" type="button" data-act="edit-eq" data-id="' + esc(e.id) + '">Update</button></span></div></li>';
    }).join("") + "</ul>";
    html += '<div class="actions"><button class="btn" type="button" data-act="edit-eq">Add equipment</button></div>';
    return wrap(html);
  }
  function eqDialog(e) {
    e = e || { id: "", name: "", count: null, working: null, status: "ok", labs: "", location: "", notes: "" };
    openDialog('<h2 id="dlg-title">' + (e.id ? "Update " + esc(e.name) : "Add equipment") + '</h2><form class="form" data-dlg="eq">' +
      '<div class="field"><label for="q-name">Name</label><input type="text" id="q-name" value="' + esc(e.name) + '" required></div>' +
      '<div class="form__grid"><div class="field"><label for="q-count">How many</label><input type="number" id="q-count" min="0" step="1" value="' + (e.count == null ? "" : e.count) + '"></div>' +
      '<div class="field"><label for="q-work">How many work</label><input type="number" id="q-work" min="0" step="1" value="' + (e.working == null ? "" : e.working) + '"></div></div>' +
      '<div class="field"><label for="q-st">Status</label><select id="q-st">' + Object.keys(EQ).map(function (k) { return '<option value="' + k + '"' + (e.status === k ? " selected" : "") + ">" + EQ[k][1] + "</option>"; }).join("") + "</select></div>" +
      '<div class="field"><label for="q-loc">Where it is</label><input type="text" id="q-loc" value="' + esc(e.location) + '"></div>' +
      '<div class="field"><label for="q-labs">Lab IDs that use it</label><input type="text" id="q-labs" value="' + esc(e.labs) + '"><small>Comma separated, e.g. alk, acid</small></div>' +
      '<div class="field"><label for="q-notes">Notes</label><textarea id="q-notes">' + esc(e.notes) + "</textarea></div>" +
      '<div class="actions"><button class="btn btn--solid" type="submit">Save</button><button class="btn btn--quiet" type="button" data-close>Cancel</button>' +
      (e.id ? '<button class="btn btn--danger" type="button" data-act="delete-eq" data-id="' + esc(e.id) + '" style="margin-left:auto">Delete</button>' : "") + "</div></form>",
      function (f) {
        var v = function (s) { return f.querySelector(s).value; };
        run(act("saveEquipment", { equipment: { id: e.id, name: v("#q-name"), count: v("#q-count"), working: v("#q-work"), status: v("#q-st"), location: v("#q-loc"), labs: v("#q-labs"), notes: v("#q-notes") } }), "Saved.");
      });
  }

  /* ---------------------------------------------------------------- views: guide and settings */
  function viewGuide() {
    var s = state.data.settings || {};
    var contact = function (name, email, fallback) {
      if (!name && !email) return esc(fallback);
      return esc(name || email) + (email ? ' (<a href="mailto:' + esc(email) + '">' + esc(email) + "</a>)" : "");
    };
    var html = '<div class="head"><h1>Guide for lab TAs</h1><p>How to keep every section supplied, in about ten minutes a week.</p></div><div class="prose">';
    html += "<h2>The weekly routine</h2><ol>" +
      "<li><b>Monday:</b> open <a href=\"#/\">This week</a>. Every session in the next few weeks shows <i>Ready</i>, <i>Short</i> or <i>Check counts</i>.</li>" +
      "<li><b>Anything short:</b> open the session and press <i>Add the missing supplies to the order list</i>. Then go to <a href=\"#/orders\">Orders</a>, press <i>Copy as an email</i> and send it to the department's ordering contact. Mark the items <i>ordered</i> once they confirm.</li>" +
      "<li><b>Before each lab:</b> open the session's pick list and pull everything from the shelf.</li>" +
      "<li><b>After each lab:</b> on the same page, record what was used. This keeps the counts honest without recounting.</li>" +
      "<li><b>When a box arrives:</b> mark it <i>received</i> on the Orders page. Chemicals go to EHS for a barcode before they go on the shelf.</li>" +
      "<li><b>Once a month, and at the start of each semester:</b> do a full <a href=\"#/count\">count</a>. Counts older than 60 days get flagged.</li></ol>";
    html += "<h2>Why order early</h2><p>Hach orders often take 3 to 5 weeks. Fisher is usually 1 to 2 weeks, Amazon a few days. The site works backwards from each lab date using these lead times, so <i>Order by</i> dates are the last safe day, not a suggestion to wait.</p>";
    html += "<h2>What the statuses mean</h2><ul>" +
      "<li>" + st("ok", "In stock") + " above the reorder level and enough for the next lab.</li>" +
      "<li>" + st("low", "Low") + " at or below the reorder level, or not enough for the next lab.</li>" +
      "<li>" + st("out", "Out") + " none left.</li>" +
      "<li>" + st("unknown", "Not counted") + " nobody has counted it here yet. The site can't promise a lab is ready until it's counted.</li>" +
      "<li>For a lab session, " + st("ok", "Ready") + " means every supply is covered after earlier sessions take their share, and " + st("out", "Short") + " means at least one isn't.</li></ul>";
    html += "<h2>Words you'll see</h2><dl class=\"kv\">" +
      "<dt>Powder pillow</dt><dd>A small foil packet with a pre-measured dose of dry reagent. Tear it open and pour it into the sample. One pillow is one test.</dd>" +
      "<dt>Digital titrator</dt><dd>A Hach hand-held titrator. A cartridge of titrant clicks in; turning the knob pushes out titrant, and the counter shows <i>digits</i> instead of mL.</dd>" +
      "<dt>Delivery tube</dt><dd>The bent clear tube on the end of a titrator cartridge. Replace it when it's cracked or cloudy.</dd>" +
      "<dt>Titrant</dt><dd>The solution you add little by little until the reaction is complete (the <i>endpoint</i>).</dd>" +
      "<dt>Indicator</dt><dd>A dye that changes color at the endpoint.</dd>" +
      "<dt>N and M</dt><dd>Concentration. N is normality, M is molarity. 0.2 N and 5.0 N are very different. Always check the label.</dd>" +
      "<dt>MDB, SCDB</dt><dd>Hach dropper bottles (marked dropping bottle, self-contained dropping bottle).</dd>" +
      "<dt>Spectrophotometer</dt><dd>The DR3900. It reads how much light a colored sample absorbs, which tells you the concentration.</dd>" +
      "<dt>Turbidity, NTU</dt><dd>How cloudy water is, measured with the turbidimeter in NTU.</dd>" +
      "<dt>SDS</dt><dd>Safety data sheet. Every chemical has one; read it before handling something new.</dd></dl>";
    html += "<h2>Safety basics</h2><ul><li>Gloves and goggles for every chemical. Find the SDS before using anything new.</li>" +
      "<li>Chloride waste contains mercury and goes in its labeled container, never down the drain.</li>" +
      "<li>The manganese method uses alkaline cyanide. Keep it away from acids.</li>" +
      "<li>Don't make dilutions of the concentrated acids and bases without Dr. Miller's OK. When you do, add acid to water, never water to acid.</li></ul>";
    html += "<h2>Who to ask</h2><ul><li>Lab questions: " + contact(s.instructorName, s.instructorEmail, "Dr. Sondra Miller") + "</li>" +
      "<li>Placing orders: " + contact(s.orderContactName, s.orderContactEmail, "the Civil Engineering department office") + "</li>" +
      "<li>Chemical barcodes and inventory: " + contact(s.ehsContactName, s.ehsContactEmail, "Boise State EHS") + "</li></ul>";
    html += "<h2>Where the numbers came from</h2><p>The starting list comes from the lab's 2022, 2023 and Fall 2026 inventory sheets and the resupply lists. Per-section amounts are the semester totals in those sheets (3 tests per lab, 4 lab sections) divided by 4. If a lab uses more or less than that, change its supply list. The site gets better as you correct it.</p></div>";
    return wrap(html);
  }

  function viewSettings() {
    var html = '<div class="detail"><div class="head" style="padding-bottom:0"><h1>Settings</h1><p>These are saved in this browser only.</p></div>';
    html += '<form class="form" data-form="settings" style="margin-top:20px"><div class="field"><label for="st-who">Your first name</label><input type="text" id="st-who" value="' + esc(who()) + '" autocomplete="given-name"><small>Shown in the activity history.</small></div>';
    if (LIVE) {
      html += '<div class="field"><label for="st-code">Lab code</label><input type="password" id="st-code" value="' + esc(store.get("code") || "") + '" autocomplete="off"><small>Everyone who runs the lab uses this code.</small></div>' +
        '<div class="field"><label for="st-admin">Admin code (optional)</label><input type="password" id="st-admin" value="' + esc(store.get("adminCode") || "") + '" autocomplete="off"><small>Only needed to delete supplies, labs or equipment.</small></div>';
    }
    html += '<div class="actions"><button class="btn btn--solid" type="submit">Save settings</button></div></form>';
    html += "<h2>Back up</h2><p>Download the supply list as a spreadsheet file.</p><div class=\"actions\"><button class=\"btn\" type=\"button\" data-act=\"export-csv\">Download supplies (CSV)</button></div>";
    if (!LIVE) {
      html += '<h2>Practice mode</h2><p>The site isn\'t connected to the lab Sheet yet, so changes stay in this browser. Try anything. When you\'re done, start over with the original data.</p><div class="actions"><button class="btn btn--danger" type="button" data-act="reset-practice">Start the practice data over</button></div>';
    } else {
      html += '<h2>Sign out</h2><div class="actions"><button class="btn" type="button" data-act="forget">Forget the codes on this device</button></div>';
    }
    return wrap(html + "</div>");
  }

  function viewGate(msg) {
    $main.innerHTML = wrap('<div class="detail" style="max-width:30rem;padding-top:48px"><h1>Enter the lab code</h1><p style="margin-top:8px">Dr. Miller or the lab TAs can give it to you.</p>' +
      (msg ? '<p class="field-error" role="alert" style="margin-top:8px">' + esc(msg) + "</p>" : "") +
      '<form class="form" data-form="gate" style="margin-top:16px"><div class="field"><label for="g-code">Lab code</label><input type="password" id="g-code" required autocomplete="off"></div>' +
      '<button class="btn btn--solid" type="submit">Open the inventory</button></form></div>');
    $main.setAttribute("aria-busy", "false");
    var i = document.getElementById("g-code"); if (i) i.focus();
  }

  /* ---------------------------------------------------------------- actions */
  function run(promise, okMsg, then) {
    return promise.then(function (r) { if (okMsg) toast(okMsg); if (then) then(r); else rerender(); return r; }, function (e) {
      if (e && e.message === "cancelled") return;
      toast(e.message || "That didn't work."); rerender();
    });
  }
  function working(btn) { if (btn) { btn.classList.add("is-working"); btn.disabled = true; } }

  function orderItemDialog(itemId) {
    var it = itemId ? itemById(itemId) : null;
    var options = items().map(function (i) { return '<option value="' + esc(i.id) + '"' + (it && it.id === i.id ? " selected" : "") + ">" + esc(i.name) + "</option>"; }).join("");
    openDialog('<h2 id="dlg-title">Add to the order list</h2><form class="form" data-dlg="order">' +
      '<div class="field"><label for="o-item">Supply</label><select id="o-item" required><option value="">Pick a supply</option>' + options + "</select></div>" +
      '<div class="field"><label for="o-packs">How many</label><input type="number" id="o-packs" min="1" step="1" value="1" required><small id="o-unit">' + (it ? "× " + esc(it.orderUnit || it.unit) : "") + "</small></div>" +
      '<div class="field"><label for="o-note">Note (optional)</label><input type="text" id="o-note"></div>' +
      '<div class="actions"><button class="btn btn--solid" type="submit">Add</button><button class="btn btn--quiet" type="button" data-close>Cancel</button></div></form>',
      function (f) {
        var id = f.querySelector("#o-item").value; if (!id) return false;
        run(act("requestOrders", { orders: [{ itemId: id, packs: f.querySelector("#o-packs").value, note: f.querySelector("#o-note").value }] }), "Added to the order list.");
      });
    var sel = document.getElementById("o-item");
    sel.addEventListener("change", function () { var x = itemById(sel.value); document.getElementById("o-unit").textContent = x ? "× " + (x.orderUnit || x.unit) : ""; });
  }

  function receiveDialog(orderId) {
    var o = L.byId(state.data.orders)[orderId]; var it = o && itemById(o.itemId); if (!o) return;
    openDialog('<h2 id="dlg-title">Received ' + esc(it ? it.name : "") + '</h2><form class="form" data-dlg="recv">' +
      '<div class="field"><label for="rv-q">How many ' + esc(it ? it.unit : "") + ' arrived?</label><input type="number" id="rv-q" min="0" step="any" value="' + o.qty + '" required><small>Ordered ' + o.packs + " × " + esc(it ? it.orderUnit || it.unit : "") + ". Change this if part of the order is missing.</small></div>" +
      (it && it.chemical ? '<p class="callout callout--info">This is a chemical. Take it to EHS for a barcode before it goes on the shelf.</p>' : "") +
      '<div class="actions"><button class="btn btn--solid" type="submit">Add to the shelf count</button><button class="btn btn--quiet" type="button" data-close>Cancel</button></div></form>',
      function (f) { run(act("setOrderStatus", { id: orderId, status: "received", receivedQty: f.querySelector("#rv-q").value }), "Received. The count went up."); });
  }

  function confirmDialog(title, body, btn, onYes) {
    openDialog('<h2 id="dlg-title">' + esc(title) + '</h2><form class="form" data-dlg="confirm"><p>' + body + '</p><div class="actions"><button class="btn btn--danger" type="submit">' + esc(btn) + '</button><button class="btn btn--quiet" type="button" data-close>Keep it</button></div></form>', function () { onYes(); });
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]"); if (!b) return;
    var a = b.getAttribute("data-act"), id = b.getAttribute("data-id");
    switch (a) {
      case "order-item": orderItemDialog(id); break;
      case "order-short": {
        var sp = plan().sessions.filter(function (x) { return x.session.id === id; })[0]; if (!sp) return;
        var want = sp.shortLines.filter(function (l) { return !/^made in lab/i.test(l.item.vendor || ""); }).map(function (l) {
          var already = L.onOrder(state.data, l.item.id);
          var gap = l.short - already; if (gap <= 0) return null;
          return { itemId: l.item.id, packs: l.item.perOrderUnit ? Math.ceil(gap / l.item.perOrderUnit) : Math.ceil(gap), note: "For " + sp.lab.name + " on " + fmtDay(sp.session.date) };
        }).filter(Boolean);
        if (!want.length) { toast("Everything short is already on order."); return; }
        working(b); run(act("requestOrders", { orders: want }), want.length + " added to the order list.", function () { location.hash = "#/orders"; });
        break;
      }
      case "order-status": working(b); run(act("setOrderStatus", { id: id, status: b.getAttribute("data-status") }), b.getAttribute("data-status") === "ordered" ? "Marked ordered." : "Removed from the list."); break;
      case "order-all": {
        var ids = state.data.orders.filter(function (o) { return o.status === "requested"; }).map(function (o) { return o.id; });
        working(b);
        ids.reduce(function (pr, oid) { return pr.then(function () { return act("setOrderStatus", { id: oid, status: "ordered" }); }); }, Promise.resolve())
          .then(function () { toast(ids.length + " marked ordered."); rerender(); }, function (er) { toast(er.message); rerender(); });
        break;
      }
      case "receive": receiveDialog(id); break;
      case "copy-email": {
        var text = orderEmailText();
        var s = state.data.settings || {};
        var done = function (ok) {
          toast(ok ? "Copied. Paste it into an email." : "Couldn't copy. Select the text below instead.");
          if (!ok || s.orderContactEmail) {
            openDialog('<h2 id="dlg-title">Order email</h2><form class="form" data-dlg="mail"><div class="field"><label for="m-t">Email text</label><textarea id="m-t" style="min-height:280px">' + esc(text) + "</textarea></div>" +
              '<div class="actions">' + (s.orderContactEmail ? '<a class="btn btn--solid" href="mailto:' + esc(s.orderContactEmail) + "?subject=" + encodeURIComponent("CE 323 lab supply order") + "&body=" + encodeURIComponent(text) + '">Open in email</a>' : "") + '<button class="btn" type="button" data-close>Close</button></div></form>', function () {});
          }
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
        else done(false);
        break;
      }
      case "print": window.print(); break;
      case "edit-eq": eqDialog(id ? L.byId(state.data.equipment)[id] : null); break;
      case "delete-eq": closeDialog(false); confirmDialog("Delete this equipment?", "It will be removed from the list. The history keeps a note.", "Delete", function () { run(act("deleteEquipment", { id: id }), "Deleted."); }); break;
      case "delete-item": confirmDialog("Delete this supply?", "It comes off every lab's supply list too. If you just ran out, set the count to 0 instead.", "Delete supply", function () { run(act("deleteItem", { id: id }), "Deleted.", function () { location.hash = "#/supplies"; }); }); break;
      case "delete-lab": confirmDialog("Delete this lab?", "Its supply list goes too. Scheduled sessions stay but won't check any supplies.", "Delete lab", function () { run(act("deleteLab", { id: id }), "Deleted.", function () { location.hash = "#/labs"; }); }); break;
      case "delete-session": confirmDialog("Remove this session?", "It comes off the schedule. Supplies already recorded as used stay used.", "Remove", function () { run(act("deleteSession", { id: id }), "Removed.", function () { location.hash = "#/schedule"; }); }); break;
      case "add-line": {
        var tb = document.getElementById("lines"); var k = +(tb.getAttribute("data-next") || 1);
        tb.insertAdjacentHTML("beforeend", afterRender.lab.row({ itemId: "", kind: "use", amount: "", note: "" }, k));
        tb.setAttribute("data-next", String(k + 1));
        tb.lastElementChild.querySelector("select").focus();
        break;
      }
      case "drop-line": { var tr = b.closest("tr"); var nxt = tr.nextElementSibling || tr.previousElementSibling; tr.remove(); var focusTo = nxt ? nxt.querySelector("select") : $main.querySelector('[data-act="add-line"]'); if (focusTo) focusTo.focus(); break; }
      case "export-csv": exportCsv(); break;
      case "reset-practice": confirmDialog("Start the practice data over?", "Everything you changed in practice mode on this browser is cleared.", "Start over", function () { store.del("practice"); load().then(function () { toast("Practice data reset."); rerender(); }); }); break;
      case "forget": store.del("code"); store.del("adminCode"); toast("Codes forgotten on this device."); location.reload(); break;
    }
  });

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.matches && t.matches("[data-pick]")) { if (t.checked) store.set("pick." + t.getAttribute("data-pick"), "1"); else store.del("pick." + t.getAttribute("data-pick")); }
  });

  document.addEventListener("submit", function (e) {
    var f = e.target; var kind = f.getAttribute("data-form"); if (!kind) return;
    e.preventDefault();
    var id = f.getAttribute("data-id");
    var btn = e.submitter || f.querySelector('[type="submit"]');
    var val = function (name) { var el = f.querySelector('[name="' + name + '"]'); return el ? (el.type === "checkbox" ? el.checked : el.value) : undefined; };
    switch (kind) {
      case "count":
        working(btn); run(act("setCounts", { counts: [{ id: id, onHand: f.querySelector("#c-n").value }] }), "Count saved."); break;
      case "adjust": {
        var amt = parseFloat(f.querySelector("#a-n").value); if (!(amt > 0)) { toast("Enter an amount above zero."); return; }
        var dir = btn && btn.value === "1" ? 1 : -1;
        working(btn); run(act("adjust", { id: id, delta: dir * amt, reason: f.querySelector("#a-why").value }), dir > 0 ? "Added." : "Taken out."); break;
      }
      case "item": {
        var obj = { id: id || undefined };
        ["name", "group", "unit", "onHand", "reorderAt", "location", "expires", "vendor", "leadDays", "hach", "fisher", "other", "link", "orderUnit", "perOrderUnit", "price", "hazard", "about", "notes"].forEach(function (k) { var v = val(k); if (v !== undefined) obj[k] = v; });
        obj.chemical = val("chemical");
        if (!obj.group) obj.group = "Other";
        if (!obj.unit) obj.unit = "each";
        working(btn); run(act("saveItem", { item: obj }), id ? "Saved." : "Supply added.", function (r) { location.hash = "#/item/" + (r.id || id); }); break;
      }
      case "lab": {
        var labObj = { id: id || undefined, name: val("name"), module: val("module"), about: val("about") };
        var lines = [];
        f.querySelectorAll("tr[data-line]").forEach(function (tr) {
          var item = tr.querySelector('[name="itemId"]').value, amount = tr.querySelector('[name="amount"]').value;
          if (item && amount !== "") lines.push({ itemId: item, kind: tr.querySelector('[name="kind"]').value, amount: amount, note: tr.querySelector('[name="note"]').value });
        });
        working(btn);
        run(act("saveLab", { lab: labObj }).then(function (r) { var lid = r.id || id; return act("saveUsage", { labId: lid, lines: lines }).then(function () { return { id: lid }; }); }), "Lab saved.", function (r) { location.hash = "#/lab/" + r.id; });
        break;
      }
      case "lab-sections": location.hash = "#/lab/" + id + "?sections=" + (parseInt(f.querySelector("#ls-n").value, 10) || L.DEFAULT_SECTIONS); break;
      case "session": {
        var ses = { id: id || undefined, labId: val("labId"), date: val("date"), sections: val("sections"), notes: val("notes") };
        working(btn); run(act("saveSession", { session: ses }), id ? "Session saved." : "Session added.", id ? null : function () { rerender(); });
        break;
      }
      case "record": {
        var used = [];
        f.querySelectorAll("input[data-item]").forEach(function (inp) { used.push({ itemId: inp.getAttribute("data-item"), qty: inp.value }); });
        working(btn); run(act("recordSession", { id: id, used: used, notes: f.querySelector("#r-notes").value }), "Recorded. The shelf counts went down."); break;
      }
      case "counts": {
        var all = changedCounts(f);
        if (!all.length) { toast("Type at least one count first."); return; }
        working(btn); run(act("setCounts", { counts: all }), all.length + " count" + (all.length > 1 ? "s" : "") + " saved."); break;
      }
      case "suggest": {
        var orders = [];
        f.querySelectorAll("input[type=checkbox][data-item]").forEach(function (cb) {
          if (!cb.checked) return;
          var iid = cb.getAttribute("data-item");
          orders.push({ itemId: iid, packs: f.querySelector('[data-packs="' + iid + '"]').value });
        });
        if (!orders.length) { toast("Tick at least one supply."); return; }
        working(btn); run(act("requestOrders", { orders: orders }), orders.length + " added to the order list."); break;
      }
      case "settings": {
        var w = f.querySelector("#st-who").value.trim(); if (w) store.set("who", w); else store.del("who");
        if (LIVE) {
          var c = f.querySelector("#st-code").value.trim(), ad = f.querySelector("#st-admin").value.trim();
          if (c) store.set("code", c); if (ad) store.set("adminCode", ad); else store.del("adminCode");
        }
        toast("Settings saved."); footer(); break;
      }
      case "gate": {
        store.set("code", f.querySelector("#g-code").value.trim());
        state.triedCode = true;
        start(); break;
      }
    }
  });

  function exportCsv() {
    var cols = ["id", "name", "group", "unit", "onHand", "reorderAt", "location", "vendor", "hach", "fisher", "other", "orderUnit", "perOrderUnit", "price", "leadDays", "chemical", "expires", "lastCounted", "countedBy", "notes"];
    var q = function (v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var csv = cols.join(",") + "\n" + items().map(function (i) { return cols.map(function (c) { return q(i[c]); }).join(","); }).join("\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "ce323-supplies-" + today() + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------------------------------------------------------------- theme and start */
  var tbtn = document.getElementById("theme-toggle");
  function isDark() {
    var t = document.documentElement.getAttribute("data-theme");
    return t ? t === "dark" : window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function themeLabel() { tbtn.textContent = isDark() ? "Light mode" : "Dark mode"; }
  tbtn.addEventListener("click", function () {
    var next = isDark() ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next); store.set("theme", next); themeLabel();
  });
  themeLabel();

  function notice() {
    var el = document.getElementById("notice");
    if (!LIVE) { el.innerHTML = '<p><b>Practice mode.</b> This copy isn\'t connected to the lab Sheet yet, so changes stay in this browser. The counts are from the July 2026 inventory.</p>'; el.hidden = false; }
    else el.hidden = true;
  }

  function start() {
    notice();
    load().then(function (r) {
      if (r === "gate") { viewGate(state.triedCode ? "That code didn't work. Check it with Dr. Miller or the other TA." : ""); state.triedCode = false; return; }
      route();
    }, function (e) {
      $main.setAttribute("aria-busy", "false");
      $main.innerHTML = wrap('<div class="head"><h1>Couldn\'t load the inventory</h1><p>' + esc(e.message) + '</p><div class="actions"><button class="btn btn--solid" type="button" onclick="location.reload()">Try again</button></div></div>');
    });
  }
  window.addEventListener("hashchange", route);
  // Pick up changes made by the other TA when coming back to the tab.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && LIVE && state.loadedAt && Date.now() - state.loadedAt > 60000 && !dlg.open) load().then(function (r) { if (r === "ok") rerender(); }).catch(function () {});
  });
  start();
})();
