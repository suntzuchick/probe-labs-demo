(function () {
  "use strict";


  var API = window.location.protocol === "file:" ? "http://localhost:5050" : "";
  var sessionId = null;
  var REQUIRED_DOMAINS = ["DM", "EX", "AE", "RS", "DS"];
  var pendingTraces = [];
  var cellCounter = 0;
  var _provenanceMeta = null;
  var _notebookVars = [];


  var _probeToken = null;


  (function () {
    var params = new URLSearchParams(window.location.search);
    var urlToken = params.get("probe_token");
    if (urlToken) {
      localStorage.setItem("probe_token", urlToken);

      var clean = window.location.pathname + window.location.hash;
      window.history.replaceState({}, document.title, clean);
    }
    _probeToken = localStorage.getItem("probe_token");
  })();


  (function () {
    var _origFetch = window.fetch.bind(window);
    window.fetch = function (url, opts) {
      var isApi = typeof url === "string" && url.includes("/api/") && !url.includes("/api/auth/");
      if (isApi && _probeToken) {
        opts = opts ? Object.assign({}, opts) : {};
        opts.headers = Object.assign({}, opts.headers || {}, { "X-Probe-Token": _probeToken });
      }
      return _origFetch(url, opts).then(function (res) {
        if (res.status === 401 && isApi) {
          _probeToken = null;
          localStorage.removeItem("probe_token");
          showAuthOverlay();
        }
        return res;
      });
    };
  })();


  function showAuthOverlay() {
    document.getElementById("auth-overlay").style.display = "flex";
    document.querySelector(".masthead").style.display = "none";
    document.querySelector(".shell").style.display = "none";
  }

  function hideAuthOverlay() {
    document.getElementById("auth-overlay").style.display = "none";
    document.querySelector(".masthead").style.display = "";
    document.querySelector(".shell").style.display = "";
  }

  async function checkAuth() {
    try {
      var res = await fetch(API + "/api/auth/status", {
        headers: _probeToken ? { "X-Probe-Token": _probeToken } : {},
      });
      var data = await res.json();
      if (data.auth_enabled && !data.authenticated) {

        showAuthOverlay();
        return false;
      }
      if (data.authenticated && data.email) {

        var mu = document.getElementById("masthead-user");
        if (mu && !mu.textContent) mu.textContent = data.email;
      }
      return true;
    } catch (e) {

      return true;
    }
  }


  var authForm = document.getElementById("auth-form");
  if (authForm) {
    authForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var email = (document.getElementById("auth-email").value || "").trim();
      var errEl = document.getElementById("auth-error");
      errEl.textContent = "";
      if (!email || !email.includes("@")) {
        errEl.textContent = "Enter a valid email address.";
        return;
      }
      var btn = authForm.querySelector("button[type=submit]");
      btn.disabled = true;
      btn.textContent = "Sending…";
      try {
        var res = await fetch(API + "/api/auth/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email }),
        });
        var data = await res.json();
        if (data.status === "not_allowed") {
          errEl.textContent = "This email isn't on the access list. Contact sera@thingblinglabs.io.";
          btn.disabled = false;
          btn.textContent = "Send access link →";
        } else if (data.link) {
          document.getElementById("auth-sent-email").textContent = email;
          document.getElementById("auth-magic-link").value = data.link;
          document.getElementById("auth-request-section").style.display = "none";
          document.getElementById("auth-sent-section").style.display = "block";
        } else if (data.error) {
          errEl.textContent = data.error;
          btn.disabled = false;
          btn.textContent = "Send access link →";
        }
      } catch (err) {
        errEl.textContent = "Could not reach the server. Try again in a moment.";
        btn.disabled = false;
        btn.textContent = "Send access link →";
      }
    });
  }

  var authCopyBtn = document.getElementById("auth-copy-btn");
  if (authCopyBtn) {
    authCopyBtn.addEventListener("click", function () {
      var linkInput = document.getElementById("auth-magic-link");
      linkInput.select();
      navigator.clipboard.writeText(linkInput.value).then(function () {
        authCopyBtn.textContent = "Copied!";
        setTimeout(function () { authCopyBtn.textContent = "Copy"; }, 2000);
      });
    });
  }

  var authTryAgain = document.getElementById("auth-try-again");
  if (authTryAgain) {
    authTryAgain.addEventListener("click", function () {
      document.getElementById("auth-request-section").style.display = "block";
      document.getElementById("auth-sent-section").style.display = "none";
      document.getElementById("auth-error").textContent = "";
      document.querySelector(".auth-email-input").value = "";
      authForm.querySelector("button[type=submit]").disabled = false;
      authForm.querySelector("button[type=submit]").textContent = "Send access link →";
    });
  }


  var screens = ["screen-0", "screen-1", "screen-2", "screen-3", "screen-4", "screen-5", "screen-6", "screen-7", "screen-8", "screen-9",
    "screen-10", "screen-11", "screen-12", "screen-13", "screen-oracles"];
  var railStages = document.querySelectorAll(".rail-stage");
  var railOriginalHtml = document.querySelector(".rail").innerHTML;

  // Act 2 and Act 3 share three screens (Analysis/Evidence/Narratives —
  // screen-7/8/9) with Act 1 and with each other, so a single numeric
  // "stageNum < N" rail can't represent either of them honestly — Act 2 and
  // Act 3 each get their own stage list instead, distinct from each other:
  // Act 2 ends with Oracles shown but locked (that's Act 3's move, not
  // yet available); Act 3 opens on Oracles active, with Ingest/Understanding
  // /Notebook carried over from Act 2 as already-done, not re-walked.
  var RAIL_ACT2 = [
    { screen: "screen-10", name: "Ingest" },
    { screen: "screen-13", name: "Quality" },
    { screen: "screen-11", name: "Understanding" },
    { screen: "screen-12", name: "Notebook" },
    { screen: "screen-7",  name: "Analysis" },
    { screen: "screen-8",  name: "Evidence" },
    { screen: "screen-9",  name: "Narratives" },
    { screen: null,        name: "Oracles", locked: true },
  ];
  var RAIL_ACT3 = [
    { screen: "screen-10",      name: "Ingest",         inherited: true },
    { screen: "screen-13",      name: "Quality",        inherited: true },
    { screen: "screen-11",      name: "Understanding",  inherited: true },
    { screen: "screen-12",      name: "Notebook",       inherited: true },
    { screen: "screen-oracles", name: "Oracles" },
    { screen: "screen-8",       name: "Evidence" },
    { screen: "screen-9",       name: "Narratives" },
  ];
  var currentAct = 1;

  function _renderDynamicRail(items, activeScreenId) {
    var rail = document.querySelector(".rail");
    var activeIdx = items.findIndex(function (it) { return it.screen === activeScreenId; });
    var html = '<div class="rail-label">Act ' + currentAct + '</div>';
    items.forEach(function (it, i) {
      var cls = "rail-stage";
      if (it.locked) cls += " locked";
      else if (it.inherited || i < activeIdx) cls += " done";
      else if (i === activeIdx) cls += " active";
      html += '<div class="' + cls + '">' +
        '<div class="rail-dot">' + (it.locked ? "🔒" : (i + 1)) + '</div>' +
        '<div class="rail-stage-text">' +
          '<div class="rail-stage-name">' + it.name + '</div>' +
          '<div class="rail-stage-meta">' + (it.locked ? "unlocks in Act 3" : "") + '</div>' +
        '</div></div>';
    });
    rail.innerHTML = html;
    rail.style.display = "";
  }

  function goTo(screenId, stageNum) {
    screens.forEach(function (id) {
      document.getElementById(id).classList.toggle("active", id === screenId);
    });
    if (currentAct === 1) {
      var rail = document.querySelector(".rail");
      if (rail.innerHTML !== railOriginalHtml) {
        rail.innerHTML = railOriginalHtml;
        railStages = document.querySelectorAll(".rail-stage");
      }
      railStages.forEach(function (el) {
        var n = parseInt(el.dataset.stage, 10);
        el.classList.remove("active", "done");
        if (n < stageNum) el.classList.add("done");
        if (n === stageNum) el.classList.add("active");
      });
    } else {
      _renderDynamicRail(currentAct === 2 ? RAIL_ACT2 : RAIL_ACT3, screenId);
    }
    document.body.classList.toggle("is-info",     screenId === "screen-0");
    document.body.classList.toggle("is-notebook", screenId === "screen-6" || screenId === "screen-12");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setRailMeta(stage, text) {
    var el = document.getElementById("rail-meta-" + stage);
    if (el) el.textContent = text;
  }


  var logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async function () {
      await fetch(API + "/api/auth/logout", { method: "POST" });
      _probeToken = null;
      localStorage.removeItem("probe_token");
      showAuthOverlay();
    });
  }


  checkAuth().then(function (ok) {
    if (ok) {
      fetch(API + "/api/auth/status").then(function (r) {
        return r.json();
      }).then(function (d) {
        if (d.authenticated && logoutBtn) logoutBtn.style.display = "inline-block";
      }).catch(function () {});
    }
  });


  async function _completeInfoGate(name, org, email, project) {
    await ensureSession();
    await fetch(API + "/api/session/info", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, name: name, organization: org, email: email, project: project }),
    });

    var userEl = document.getElementById("masthead-user");
    if (userEl) userEl.textContent = name + (org ? " · " + org : "") + " — ";

    goTo("screen-1", 1);
  }

  document.getElementById("info-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var name    = document.getElementById("info-name").value.trim();
    var org     = document.getElementById("info-org").value.trim();
    var email   = document.getElementById("info-email").value.trim();
    var project = document.getElementById("info-project").value.trim();
    var errorEl = document.getElementById("info-error");

    errorEl.textContent = "";
    if (!name || !org || !email) {
      errorEl.textContent = "Please fill in your name, organization, and email.";
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorEl.textContent = "Please enter a valid email address.";
      return;
    }

    var submitBtn = this.querySelector(".info-submit");
    submitBtn.disabled = true;
    submitBtn.textContent = "Setting up…";

    try {
      await _completeInfoGate(name, org, email, project);
    } catch (err) {
      errorEl.textContent = "Could not connect — make sure the backend is running.";
      submitBtn.disabled = false;
      submitBtn.textContent = "Get started →";
    }
  });

  var infoSkipBtn = document.getElementById("info-skip-btn");
  if (infoSkipBtn) {
    infoSkipBtn.addEventListener("click", async function () {
      infoSkipBtn.disabled = true;
      infoSkipBtn.textContent = "Skipping…";
      try {
        await _completeInfoGate("Demo User", "Demo", "demo@probe.local", "");
      } catch (err) {
        document.getElementById("info-error").textContent = "Could not connect — make sure the backend is running.";
        infoSkipBtn.disabled = false;
        infoSkipBtn.textContent = "Skip for this demo →";
      }
    });
  }


  async function ensureSession() {
    if (sessionId) return sessionId;
    var res = await fetch(API + "/api/session", { method: "POST" });
    var data = await res.json();
    sessionId = data.session_id;
    document.getElementById("session-id").textContent = sessionId;
    return sessionId;
  }


  var dropzone = document.getElementById("dropzone");
  var fileInput = document.getElementById("file-input");

  document.getElementById("browse-btn").addEventListener("click", function (e) {
    e.stopPropagation();
    fileInput.click();
  });
  dropzone.addEventListener("click", function () { fileInput.click(); });
  ["dragenter", "dragover"].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) { e.preventDefault(); dropzone.classList.add("dragover"); });
  });
  ["dragleave", "drop"].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) { e.preventDefault(); dropzone.classList.remove("dragover"); });
  });
  dropzone.addEventListener("drop", function (e) { handleFiles(e.dataTransfer.files); });
  fileInput.addEventListener("change", function () { handleFiles(fileInput.files); });

  async function handleFiles(fileList) {
    await ensureSession();
    for (var i = 0; i < fileList.length; i++) {
      await uploadFile(fileList[i]);
    }
  }

  // Renders straight into the (already-in-DOM) extraction terminal the
  // moment a file's real trace data comes back \u2014 live, per file, as each
  // upload actually completes, not a replayed/delayed reveal on a later
  // screen of results that were already known.
  function _renderTraceBlock(filename, lines, terminalId) {
    var terminal = document.getElementById(terminalId || "terminal");
    terminal.style.display = "block";
    var header = document.createElement("div");
    header.className = "term-line term-file-header";
    header.textContent = filename;
    terminal.appendChild(header);
    (lines || []).forEach(function (l) {
      var el = document.createElement("div");
      el.className = "term-line " + l.level;
      el.textContent = l.text;
      terminal.appendChild(el);
    });
    terminal.scrollTop = terminal.scrollHeight;
  }

  async function uploadFile(file) {
    var formData = new FormData();
    formData.append("session_id", sessionId);
    formData.append("file", file);
    try {
      var res = await fetch(API + "/api/upload", { method: "POST", body: formData });
      var data = await res.json();
      pendingTraces.push({ filename: file.name, domain: null, trace: data.trace, extraction: data.extraction });
      _renderTraceBlock(file.name, data.trace);
      document.getElementById("btn-to-trace").disabled = false;
      setRailMeta(1, pendingTraces.length + " file(s) read");
    } catch (err) {
      var errLine = [{ level: "error", text: "Could not reach Probe backend at " + API }];
      pendingTraces.push({ filename: file.name, domain: null, trace: errLine });
      _renderTraceBlock(file.name, errLine);
      document.getElementById("btn-to-trace").disabled = false;
    }
  }

  document.getElementById("load-sample-btn").addEventListener("click", async function () {
    await ensureSession();
    var btn = document.getElementById("load-sample-btn");
    btn.disabled = true;
    btn.textContent = "Loading\u2026";
    var res = await fetch(API + "/api/load-sample", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    });
    var data = await res.json();
    btn.textContent = "RASolute 302 (simulated) \u2014 loaded \u2713";

    pendingTraces = pendingTraces.concat(data.traces);
    (data.traces || []).forEach(function (t) { _renderTraceBlock(t.filename, t.trace); });

    Object.keys(data.loaded || {}).forEach(function (domain) {
      var info = data.loaded[domain];
      var cell = document.querySelector('.domain-card[data-domain="' + domain + '"]');
      cell.classList.add("received");
      cell.querySelector(".stat").textContent = info.n_rows + " rows";
    });

    setRailMeta(1, Object.keys(data.loaded || {}).length + " domains loaded");
    document.getElementById("btn-to-trace").disabled = false;
  });

  document.getElementById("btn-to-trace").addEventListener("click", function () {
    goTo("screen-2", 2);
    runTerminalScreen();
  });


  // The terminal is already fully populated by the time this screen is
  // reached — each file's real trace was rendered live as its upload
  // actually completed (see _renderTraceBlock), not replayed here.
  var terminalStarted = false;

  function runTerminalScreen() {
    if (terminalStarted) return;
    terminalStarted = true;

    var nLines = pendingTraces.reduce(function (n, t) { return n + (t.trace || []).length; }, 0);
    setRailMeta(2, nLines + " trace lines");
    document.getElementById("btn-to-quality").disabled = false;
  }

  document.getElementById("btn-back-1").addEventListener("click", function () { goTo("screen-1", 1); });
  document.getElementById("btn-to-quality").addEventListener("click", function () {
    goTo("screen-3", 3);
    _qualityRunner.run();
  });


  var SEVERITY_LABEL = { high: "High", medium: "Medium", low: "Low" };
  var ISSUE_TYPE_LABEL = {
    missing:                 "Missing values",
    outlier:                 "Outliers",
    mixed_case:              "Mixed case",
    duplicates:              "Duplicate rows",
    type_mismatch:           "Type mismatch",
    missing_required_field:  "Missing required column",
    missing_required_value:  "Missing required value",
    duplicate_key:           "Duplicate subject ID",
    ct_violation:            "Controlled terminology violation",
    implausible_value:       "Implausible value",
    date_order_violation:    "Date ordering error",
    orphaned_subject:        "Orphaned subject (referential integrity)",
  };

  // Same real quality-check machinery (generic checks + clinical-domain
  // checks, both act on every var actually in the session dir) behind both
  // Act 1's single-trial quality screen and Act 2/3's three-trial one — see
  // cfg.onContinue for where each goes next.
  function _makeQualityRunner(cfg) {
    var ran = false;
    var issues = [];

    async function run() {
      if (ran) return;
      ran = true;

      var listEl = document.getElementById(cfg.listId);
      var descEl = document.getElementById(cfg.descId);
      listEl.innerHTML = '<div class="quality-scanning">Scanning variables…</div>';

      try {
        var res = await fetch(API + "/api/quality/check?session_id=" + encodeURIComponent(sessionId));
        var data = await res.json();
        issues = data.issues || [];

        if (issues.length === 0) {
          listEl.innerHTML = '<div class="quality-clean"><span class="quality-clean-icon">✓</span> No issues detected — all variables passed quality checks.</div>';
          descEl.textContent = "All ingested variables passed quality checks. Proceed.";
          if (cfg.railStage) setRailMeta(cfg.railStage, "0 issues");
        } else {
          descEl.textContent = issues.length + " issue" + (issues.length > 1 ? "s" : "") + " detected across " +
            [...new Set(issues.map(function(i){ return i.var; }))].length + " variable(s). Select fixes to apply before continuing.";
          if (cfg.railStage) setRailMeta(cfg.railStage, issues.length + " issues");

          listEl.innerHTML = "";
          issues.forEach(function (issue, idx) {
            var card = document.createElement("div");
            card.className = "quality-card severity-" + issue.severity;
            card.innerHTML =
              '<div class="quality-card-header">' +
                '<label class="quality-checkbox-label">' +
                  '<input type="checkbox" class="quality-fix-cb-' + cfg.listId + '" data-idx="' + idx + '" ' + (issue.severity === "high" && issue.fix_label ? "checked" : "") + (issue.fix_label ? "" : " disabled") + '>' +
                  '<span class="quality-issue-type">' + escapeHtml(ISSUE_TYPE_LABEL[issue.type] || issue.type) + '</span>' +
                '</label>' +
                '<span class="quality-severity severity-' + issue.severity + '">' + escapeHtml(SEVERITY_LABEL[issue.severity] || issue.severity) + '</span>' +
              '</div>' +
              '<div class="quality-card-location"><code>' + escapeHtml(issue.var) + (issue.col ? '.' + escapeHtml(issue.col) : '') + '</code></div>' +
              '<div class="quality-card-desc">' + escapeHtml(issue.description) + '</div>' +
              (issue.fix_label
                ? '<div class="quality-fix-row"><span class="quality-fix-label">Proposed fix:</span> <span class="quality-fix-action">' + escapeHtml(issue.fix_label) + '</span></div>'
                : '<div class="quality-fix-row quality-fix-manual"><span class="quality-fix-label">Action required:</span> <span class="quality-fix-action quality-no-autofix">Manual correction needed in source data</span></div>'
              );
            listEl.appendChild(card);
          });
        }
      } catch (e) {
        listEl.innerHTML = '<div class="quality-scanning">Quality check unavailable — proceed.</div>';
        if (cfg.railStage) setRailMeta(cfg.railStage, "skipped");
      }
    }

    async function apply() {
      var selected = [];
      document.querySelectorAll(".quality-fix-cb-" + cfg.listId + ":checked").forEach(function (cb) {
        var idx = parseInt(cb.dataset.idx, 10);
        if (issues[idx]) selected.push(issues[idx]);
      });

      if (selected.length > 0) {
        try {
          await fetch(API + "/api/quality/apply", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId, fixes: selected }),
          });
        } catch (e) {  }
      }

      cfg.onContinue();
    }

    return { run: run, apply: apply };
  }

  var _qualityRunner = _makeQualityRunner({
    listId: "quality-issue-list", descId: "quality-desc", railStage: 3,
    onContinue: function () { goTo("screen-4", 4); runDerivationScreen(); },
  });

  document.getElementById("btn-apply-quality").addEventListener("click", function () { _qualityRunner.apply(); });


  var derivationRan = false;
  var _derivePlan = null;

  async function runDerivationScreen() {
    if (derivationRan) return;
    derivationRan = true;


    var planRes = await fetch(API + "/api/derive/plan?session_id=" + encodeURIComponent(sessionId));
    _derivePlan = await planRes.json();


    document.getElementById("context-badge").textContent = _derivePlan.context_label;
    document.getElementById("derive-desc").textContent = _derivePlan.description;


    var track = document.getElementById("run-track");
    track.innerHTML = "";
    _derivePlan.steps.forEach(function (step) {
      var el = document.createElement("div");
      el.className = "run-step";
      el.dataset.step = step.key;
      el.innerHTML =
        '<div class="run-step-icon">\u25cb</div>' +
        '<div class="run-step-body">' +
          '<div class="run-step-name">' + escapeHtml(step.label) + '</div>' +
          '<div class="run-step-meta"></div>' +
        '</div>';
      track.appendChild(el);
    });


    var stepKeys = _derivePlan.steps.map(function (s) { return s.key; });
    var idx = 0;
    function advance() {
      if (idx > 0) {
        var prev = document.querySelector('.run-step[data-step="' + stepKeys[idx - 1] + '"]');
        if (prev) { prev.classList.remove("active"); prev.classList.add("done"); prev.querySelector(".run-step-icon").textContent = "\u2713"; }
      }
      if (idx < stepKeys.length) {
        var cur = document.querySelector('.run-step[data-step="' + stepKeys[idx] + '"]');
        if (cur) { cur.classList.add("active"); cur.querySelector(".run-step-icon").textContent = "\u25cc"; }
        idx++;
        setTimeout(advance, 650);
      }
    }
    advance();


    var res = await fetch(API + "/api/derive", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    });
    var data = await res.json();

    setTimeout(function () {
      if (data.status === "ok") {
        var datasets = data.datasets || {};
        var n = Object.keys(datasets).length;
        stepKeys.forEach(function (key) {
          var el = document.querySelector('.run-step[data-step="' + key + '"]');
          if (!el) return;
          el.classList.remove("active"); el.classList.add("done");
          el.querySelector(".run-step-icon").textContent = "\u2713";
          if (datasets[key]) {
            el.querySelector(".run-step-meta").textContent =
              datasets[key].rows + " rows, " + datasets[key].columns.length + " columns";
          }
        });
        setRailMeta(4, n + "/" + n + " datasets derived");
        document.getElementById("btn-to-understanding").disabled = false;

      } else if (data.status === "incomplete") {
        var missing = data.missing_domains || [];
        window._missingDomains = missing;

        var DOMAIN_META = {
          DM: { label: "Demographics",  needed_by: ["ADSL","ADAE","ADTTE"] },
          EX: { label: "Exposure",       needed_by: ["ADSL"] },
          AE: { label: "Adverse Events", needed_by: ["ADAE"] },
          RS: { label: "Tumor Response", needed_by: ["ADTTE"] },
          DS: { label: "Disposition",    needed_by: ["ADSL","ADTTE"] },
        };
        var DATASET_NEEDS = { ADSL:["DM","EX","DS"], ADAE:["DM","AE"], ADTTE:["DM","DS","RS"] };

        var missingRows = missing.map(function (code) {
          var meta = DOMAIN_META[code] || { label: code, needed_by: [] };
          return '<tr><td><code>' + escapeHtml(code) + '</code></td><td>' + escapeHtml(meta.label) + '</td><td>' +
            (meta.needed_by.length ? meta.needed_by.map(function(d){ return '<span class="impact-tag">'+d+'</span>'; }).join(' ') : '\u2014') +
            '</td></tr>';
        }).join('');

        var datasetRows = stepKeys.map(function (key) {
          var DS = key.toUpperCase();
          var needed = DATASET_NEEDS[DS] || [];
          var blocked = needed.filter(function (d) { return missing.indexOf(d) !== -1; });
          return '<tr><td><code>' + DS + '</code></td><td>' +
            (blocked.length === 0 ? '<span class="status-ok">derived</span>'
              : '<span class="status-blocked">blocked \u2014 needs ' + blocked.join(', ') + '</span>') +
            '</td></tr>';
        }).join('');

        track.insertAdjacentHTML("beforeend",
          '<div class="derive-warning">' +
            '<div class="derive-warning-title">Derivation incomplete \u2014 missing source domains</div>' +
            '<table class="derive-table"><thead><tr><th>Domain</th><th>Name</th><th>Impacts</th></tr></thead><tbody>' + missingRows + '</tbody></table>' +
            '<div class="derive-warning-title" style="margin-top:14px;">Derived dataset status</div>' +
            '<table class="derive-table"><thead><tr><th>Dataset</th><th>Status</th></tr></thead><tbody>' + datasetRows + '</tbody></table>' +
            '<p style="margin:12px 0 0;font-size:13px;">You can continue to the notebook with whatever data was derived, or go back and upload the missing files.</p>' +
          '</div>');
        var btn = document.getElementById("btn-to-understanding");
        btn.disabled = false; btn.textContent = "Proceed with manual review \u2192"; btn.classList.add("btn-warn");

      } else {
        track.insertAdjacentHTML("beforeend",
          '<div class="derive-warning"><div class="derive-warning-title">Derivation error</div>' +
          '<p style="font-family:var(--mono);font-size:12.5px;color:var(--alert-amber-deep);">' + escapeHtml(data.error || "Unknown error") + '</p>' +
          '<p style="margin:10px 0 0;font-size:13px;">You can still open the notebook to work with raw uploaded data.</p></div>');
        var btn = document.getElementById("btn-to-understanding");
        btn.disabled = false; btn.textContent = "Proceed with manual review \u2192"; btn.classList.add("btn-warn");
      }
    }, stepKeys.length * 650 + 200);
  }

  document.getElementById("btn-back-2").addEventListener("click", function () { goTo("screen-2", 2); });
  document.getElementById("btn-back-3").addEventListener("click", function () { goTo("screen-3", 3); });

  var NOTEBOOK_TEMPLATES = {
    clinical_trial: [
      { label: "demographics by arm",
        code: "adsl.groupby('ARMCD').agg(n=('USUBJID','count'), mean_age=('AGE','mean'), pct_female=('SEX', lambda x: (x=='F').mean()*100)).round(1)" },
      { label: "KM curve by arm",
        code: "import matplotlib.pyplot as plt\nfig, ax = plt.subplots(figsize=(7,5))\nfor arm in adtte['ARMCD'].unique():\n    sub = adtte[adtte['ARMCD']==arm].copy()\n    sub['AVAL'] = sub['AVAL'].astype(float)\n    sub['CNSR'] = sub['CNSR'].astype(int)\n    kmf = KaplanMeierFitter()\n    kmf.fit(sub['AVAL'], event_observed=(sub['CNSR']==0), label=arm)\n    kmf.plot_survival_function(ax=ax)\nplt.title('Overall survival by arm')\nplt.xlabel('Days')" },
      { label: "Cox PH hazard ratio",
        code: "adtte2 = adtte.copy()\nadtte2['AVAL'] = adtte2['AVAL'].astype(float)\nadtte2['CNSR'] = adtte2['CNSR'].astype(int)\nadtte2['ARM_BIN'] = (adtte2['ARMCD']=='DARA').astype(int)\ncox = CoxPHFitter()\ncox.fit(adtte2[['AVAL','CNSR','ARM_BIN']], duration_col='AVAL', event_col='CNSR')\ncox.print_summary()" },
      { label: "grade 3+ AEs",
        code: "teae = adae[(adae['TRTEMFL']=='Y') & (adae['AETOXGR'].astype(float)>=3)]\nteae.groupby(['AEBODSYS','AEDECOD'])['USUBJID'].nunique().sort_values(ascending=False).head(20)" },
      { label: "AE rate by arm",
        code: "n_subj = adsl.groupby('ARMCD')['USUBJID'].nunique()\nae_subj = adae[adae['TRTEMFL']=='Y'].groupby('ARMCD')['USUBJID'].nunique()\n(ae_subj / n_subj * 100).round(1).rename('TEAE %').reset_index()" },
      { label: "exposure duration",
        code: "import matplotlib.pyplot as plt\nadsl['TRTDURD'] = adsl['TRTDURD'].astype(float)\nfig, ax = plt.subplots(figsize=(7,4))\nfor arm, grp in adsl.groupby('ARMCD'):\n    ax.hist(grp['TRTDURD'].dropna(), bins=20, alpha=0.6, label=arm)\nax.set_xlabel('Treatment duration (days)')\nax.set_ylabel('Subjects')\nax.legend()\nplt.title('Exposure duration by arm')" },
      { label: "response waterfall",
        code: "import matplotlib.pyplot as plt\nif 'RS' in dir() or 'rs' in dir():\n    pass\nrs2 = adsl[['USUBJID','ARMCD']].copy()\nfig, ax = plt.subplots(figsize=(9,4))\ncolors = {'CR':'#2a7a3b','PR':'#6cc87c','SD':'#f0c040','PD':'#d64a3b'}\nif 'RSORRES' in adsl.columns:\n    rs2['RESP'] = adsl['RSORRES']\n    rs2 = rs2.sort_values('RESP')\n    ax.bar(range(len(rs2)), rs2['RESP'].map({'CR':100,'PR':50,'SD':5,'PD':-30}).fillna(0),\n           color=rs2['RESP'].map(colors).fillna('#aaa'))\n    ax.axhline(0, color='black', linewidth=0.8)\n    ax.set_ylabel('Best response (%)')\n    ax.set_xlabel('Subjects')\n    plt.title('Waterfall plot')\nelse:\n    print('RSORRES not in adsl \u2014 check adrs or rs variable')" },
      { label: "logrank test",
        code: "arm_a = adtte[adtte['ARMCD']==adtte['ARMCD'].unique()[0]]\narm_b = adtte[adtte['ARMCD']==adtte['ARMCD'].unique()[1]]\nresult = logrank_test(arm_a['AVAL'].astype(float), arm_b['AVAL'].astype(float),\n                      event_observed_A=(arm_a['CNSR'].astype(int)==0),\n                      event_observed_B=(arm_b['CNSR'].astype(int)==0))\nresult.print_summary()" },
    ],
    plate_assay: [
      { label: "dose-response table",
        code: "dose_response" },
      { label: "viability curves",
        code: "import matplotlib.pyplot as plt\nfig, ax = plt.subplots(figsize=(7,5))\nfor cl, grp in plate_assay[plate_assay['CONTROL_TYPE']=='treated'].groupby('CELL_LINE'):\n    mn = grp.groupby('CONCENTRATION')['VIABILITY_PCT'].mean()\n    ax.plot(mn.index, mn.values, marker='o', label=cl)\nax.set_xscale('log')\nax.axhline(50, color='grey', linestyle='--', linewidth=0.8)\nax.set_xlabel('Concentration (\u00b5M)')\nax.set_ylabel('Viability (%)')\nax.legend()\nplt.title('Dose-response by cell line')" },
      { label: "plate QC summary",
        code: "plate_qc" },
      { label: "control well values",
        code: "plate_assay[plate_assay['CONTROL_TYPE'].isin(['blank','dmso'])].groupby(['CELL_LINE','CONTROL_TYPE'])['SIGNAL'].agg(['mean','std','count']).round(1)" },
    ],
    lab_assay: [
      { label: "lab summary",
        code: "lb_summary" },
      { label: "abnormal flags",
        code: "lb_flags[lb_flags['HIGH_FLAG'] | lb_flags['LOW_FLAG']].sort_values('PARAM')" },
      { label: "shift table",
        code: "lb_shifts.pivot_table(index='PARAM', columns='SHIFT', values='n', fill_value=0)" },
    ],
    generic: [
      { label: "profile",
        code: "profile" },
      { label: "numeric summary",
        code: "numeric_summary" },
    ],
  };

  var NOTEBOOK_PLACEHOLDERS = {
    clinical_trial: "e.g. \u201cshow OS by KRAS subtype\u201d or \u201cfit a Cox model for PFS\u201d",
    plate_assay: "e.g. \u201cIC50 for each cell line\u201d or \u201cplot viability curves on log scale\u201d",
    lab_assay: "e.g. \u201cshow abnormal lab values by visit\u201d",
    generic: "e.g. \u201cshow me a histogram of the numeric columns\u201d",
  };

  var NOTEBOOK_HINTS = {
    clinical_trial: "Describe the analysis in plain English. The system understands your SDTM structure \u2014 which columns map to which clinical variables and at what confidence \u2014 and writes code against the derived ADaM datasets.",
    plate_assay: "Describe the analysis in plain English. The system knows your plate layout: signal sheet, compound labels, WELLID join, and real concentration values parsed from treatment strings.",
    lab_assay: "Describe the analysis in plain English. The system writes code against your derived lab summary, flag, and shift tables.",
    generic: "Describe the analysis in plain English. The system works from column names and types \u2014 never raw data values.",
  };

  function renderNotebookTemplates(context) {
    var container = document.getElementById("cell-templates");
    if (!container) return;
    container.innerHTML = '<span class="template-label">templates:</span>';
    var chips = NOTEBOOK_TEMPLATES[context] || NOTEBOOK_TEMPLATES.generic;
    chips.forEach(function (t) {
      var btn = document.createElement("button");
      btn.className = "template-chip";
      btn.textContent = t.label;
      btn.addEventListener("click", function () { addCell(t.code); });
      container.appendChild(btn);
    });
  }

  async function initNotebookScreen() {
    try {
      var res = await fetch(API + "/api/notebook/vars?session_id=" + sessionId);
      var data = await res.json();

      var vars = data.vars || [];
      var context = data.context || "generic";
      var contextLabel = data.context_label || "General tabular data";

      _notebookVars = vars;


      var varEl = document.getElementById("var-list");
      if (varEl) varEl.textContent = vars.length ? vars.join(", ") : "none yet";


      var inp = document.getElementById("generative-input");
      if (inp) inp.placeholder = NOTEBOOK_PLACEHOLDERS[context] || NOTEBOOK_PLACEHOLDERS.generic;
      var hint = document.getElementById("generative-hint");
      if (hint) hint.textContent = NOTEBOOK_HINTS[context] || NOTEBOOK_HINTS.generic;


      renderNotebookTemplates(context);


      setRailMeta(6, contextLabel + " \u00b7 " + vars.length + " vars");
    } catch (e) {

    }


    try {
      var provRes = await fetch(API + "/api/session/" + encodeURIComponent(sessionId) + "/provenance");
      _provenanceMeta = await provRes.json();
    } catch (e) {  }
  }

  document.getElementById("btn-to-understanding").addEventListener("click", function () {
    goTo("screen-5", 5);

    if (window._missingDomains && window._missingDomains.length) {
      var existing = document.getElementById("partial-data-banner");
      if (!existing) {
        var banner = document.createElement("div");
        banner.id = "partial-data-banner";
        banner.className = "partial-data-banner";
        banner.innerHTML =
          '<strong>Partial derivation</strong> \u2014 missing domains: <code>' + window._missingDomains.join(", ") + '</code>. ' +
          'Some variables may be undefined or incomplete. Review and fill gaps manually below.';
        var desc = document.querySelector("#screen-5 .screen-desc");
        desc.parentNode.insertBefore(banner, desc.nextSibling);
      }
    }

    initContextualUnderstandingScreen();
  });

  var understandingRan = false;

  async function initContextualUnderstandingScreen() {
    if (understandingRan) return;
    understandingRan = true;
    var descEl = document.getElementById("understanding-desc");
    try {
      var idxRes = await fetch(API + "/api/index/build", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      var idxData = await idxRes.json();
      if (idxData.status === "ok") {
        _renderIntel(idxData.understanding);
        descEl.textContent = "Indexed as " + idxData.context.replace(/_/g, " ") + " data \u2014 this is what everything downstream will reason from.";
        setRailMeta(5, idxData.understanding.dataset_type + " \u00b7 " + (idxData.understanding.supported_analyses || []).length + " analysis families supported");
      } else {
        descEl.textContent = idxData.error || "No derived data available to index yet.";
      }
    } catch (e) {
      descEl.textContent = "Could not build understanding \u2014 is the backend running?";
    }
    document.getElementById("btn-to-notebook").disabled = false;
    // Runs in the background, same as Notebook's/Analysis's autonomous
    // panels \u2014 the fast deterministic card is enough to move forward on,
    // the gen-AI pass doesn't need to block navigation.
    _runUnderstandingAgent({
      panelId: "understanding-uq-panel", listId: "understanding-uq-list", countId: "understanding-uq-count",
      logId: "understanding-uq-log", resultsId: "understanding-uq-results",
    });
  }

  document.getElementById("btn-back-5").addEventListener("click", function () { goTo("screen-4", 4); });
  document.getElementById("btn-to-notebook").addEventListener("click", function () {
    goTo("screen-6", 6);
    initNotebookScreen().then(function () {
      if (document.getElementById("notebook").children.length === 0) {
        var firstVar = (_derivePlan && _derivePlan.steps.length) ? _derivePlan.steps[0].key : "data";
        addCell(firstVar + ".head()");
      }
    });
    initNotebookAnalysisPanel();
  });

  document.getElementById("btn-notebook-continue").addEventListener("click", function () {
    goTo("screen-7", 7);
    initAnalysisScreen();
  });


  document.getElementById("add-cell-btn").addEventListener("click", function () { addCell(""); });

  document.getElementById("export-btn").addEventListener("click", async function () {
    var btn = document.getElementById("export-btn");
    btn.disabled = true;
    btn.textContent = "Preparing…";
    try {
      var url = API + "/api/export?session_id=" + encodeURIComponent(sessionId);
      var res = await fetch(url);
      if (!res.ok) { btn.textContent = "Export failed"; setTimeout(function(){ btn.disabled=false; btn.textContent="Export dataset ↓"; }, 3000); return; }
      var blob = await res.blob();
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "probe_export_" + sessionId.slice(0,8) + ".xlsx";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) {  }
    btn.disabled = false;
    btn.textContent = "Export dataset ↓";
  });

  function addCell(initialCode) {
    cellCounter++;
    var notebook = document.getElementById("notebook");
    var cellId = "cell-" + cellCounter;

    var cellEl = document.createElement("div");
    cellEl.className = "nb-cell";
    cellEl.id = cellId;
    cellEl.innerHTML =
      '<div class="nb-cell-input">' +
        '<div class="nb-cell-marker">[' + cellCounter + ']</div>' +
        '<textarea class="nb-code-area" rows="3">' + escapeHtml(initialCode) + '</textarea>' +
      '</div>' +
      '<div class="nb-cell-controls">' +
        '<button class="btn-run">Run cell \u25b6</button>' +
        '<button class="btn-remove">Remove</button>' +
        '<button class="btn-promote" style="display:none">\u2606 Promote to analysis</button>' +
      '</div>' +
      '<div class="nb-cell-output empty"></div>';
    notebook.appendChild(cellEl);

    var textarea = cellEl.querySelector(".nb-code-area");
    autoGrow(textarea);
    textarea.addEventListener("input", function () { autoGrow(textarea); });
    textarea.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        runCellEl(cellEl);
      }
    });

    cellEl.querySelector(".btn-run").addEventListener("click", function () { runCellEl(cellEl); });
    cellEl.querySelector(".btn-remove").addEventListener("click", function () { cellEl.remove(); });
    cellEl.querySelector(".btn-promote").addEventListener("click", function () { promoteCellEl(cellEl); });

    if (typeof cellEl.scrollIntoView === "function") {
      cellEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    textarea.focus();
    return cellEl;
  }

  function _stripComments(code) {


    return code
      .split("\n")
      .filter(function (line) { return !/^\s*#/.test(line); })
      .join("\n")
      .trim();
  }

  function showGenerativeError(message) {
    var row = document.querySelector(".generative-row");
    var existing = document.getElementById("generative-error");
    if (existing) existing.remove();
    var el = document.createElement("div");
    el.id = "generative-error";
    el.className = "generative-error";
    el.textContent = message;
    row.parentNode.insertBefore(el, row.nextSibling);
    setTimeout(function () { if (el.parentNode) el.remove(); }, 5000);
  }

  function _buildProvenanceFooter(cellEl, code, schemaCheck) {
    if (!_provenanceMeta) return;
    var dm = _provenanceMeta.derivation_meta || {};
    var origins = dm.variable_origins || {};
    var rawOrigins = _provenanceMeta.raw_origins || {};
    var heldForReview = _provenanceMeta.held_for_review || [];
    var lowConf = dm.low_confidence || [];
    var schemaVerified = (schemaCheck && schemaCheck.verified) || [];
    var schemaMissing  = (schemaCheck && schemaCheck.missing)  || [];

    var hasAnyContent = dm.recipe || Object.keys(origins).length || Object.keys(rawOrigins).length
                        || schemaVerified.length || schemaMissing.length;
    if (!hasAnyContent) return;


    var mentionedVars = [];
    _notebookVars.forEach(function (v) {
      var re = new RegExp("\\b" + v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
      if (re.test(code) && mentionedVars.indexOf(v) === -1) {
        mentionedVars.push(v);
      }
    });

    Object.keys(origins).forEach(function (key) {
      var v = key.split(".")[0];
      var re = new RegExp("\\b" + v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
      if (re.test(code) && mentionedVars.indexOf(v) === -1) {
        mentionedVars.push(v);
      }
    });


    var relevantOrigins = Object.keys(origins).filter(function (key) {
      return mentionedVars.indexOf(key.split(".")[0]) !== -1;
    });


    var relevantLowConf = lowConf.filter(function (k) {
      return mentionedVars.indexOf(k.split(".")[0]) !== -1;
    });
    var relevantHeld = heldForReview.filter(function (h) {
      return mentionedVars.indexOf(h.var) !== -1 || code.indexOf(h.var) !== -1;
    });


    var relevantRawOrigins = Object.keys(rawOrigins).filter(function (key) {
      return mentionedVars.indexOf(key.split(".")[0]) !== -1
          && !relevantOrigins.includes(key);
    });

    var hasAnything = relevantOrigins.length || relevantRawOrigins.length
                      || dm.recipe || schemaMissing.length || schemaVerified.length;
    if (!hasAnything) return;

    var footer = document.createElement("div");
    footer.className = "prov-footer";

    var hasFlags = relevantLowConf.length > 0 || relevantHeld.length > 0 || schemaMissing.length > 0;
    var toggleLabel = "↳ view provenance" + (hasFlags ? " ⚠" : "");
    var toggleBtn = document.createElement("button");
    toggleBtn.className = "prov-toggle";
    toggleBtn.textContent = toggleLabel;
    footer.appendChild(toggleBtn);

    var panels = document.createElement("div");
    panels.className = "prov-panels";
    panels.hidden = true;


    if (relevantOrigins.length) {
      var origPanel = document.createElement("div");
      var origTitle = document.createElement("div");
      origTitle.className = "prov-panel-title";
      origTitle.textContent = "Derivation origins";
      origPanel.appendChild(origTitle);
      relevantOrigins.forEach(function (key) {
        var info = origins[key];
        var conf = Math.round(info.confidence * 100);
        var row = document.createElement("div");
        row.className = "prov-row";
        row.innerHTML =
          "<strong>" + escapeHtml(key) + "</strong>" +
          " ← <span class=\"prov-source\">" + escapeHtml(info.source) + "</span>" +
          " — " + escapeHtml(info.transform) +
          " <span class=\"prov-conf\">(" + conf + "%)</span>";
        origPanel.appendChild(row);
      });
      panels.appendChild(origPanel);
    }


    if (relevantRawOrigins.length) {
      var rawPanel = document.createElement("div");
      var rawTitle = document.createElement("div");
      rawTitle.className = "prov-panel-title";
      rawTitle.textContent = "Extraction origins";
      rawPanel.appendChild(rawTitle);
      relevantRawOrigins.forEach(function (key) {
        var info = rawOrigins[key];
        var conf = Math.round(info.confidence * 100);
        var row = document.createElement("div");
        row.className = "prov-row";
        row.innerHTML =
          "<strong>" + escapeHtml(key) + "</strong>" +
          " ← <span class=\"prov-source\">" + escapeHtml(info.source_file) + " col '" + escapeHtml(info.source_col) + "'</span>" +
          " <span class=\"prov-conf\">(" + conf + "% confidence, " + escapeHtml(info.action) + ")</span>";
        rawPanel.appendChild(row);
      });
      panels.appendChild(rawPanel);
    }


    if (schemaVerified.length || schemaMissing.length) {
      var schemaPanel = document.createElement("div");
      var schemaTitle = document.createElement("div");
      schemaTitle.className = "prov-panel-title" + (schemaMissing.length ? " prov-title-warn" : "");
      schemaTitle.textContent = "Schema verification";
      schemaPanel.appendChild(schemaTitle);

      schemaVerified.forEach(function (ref) {
        var row = document.createElement("div");
        row.className = "prov-row prov-row-ok";
        row.innerHTML = "<span class=\"prov-check\">✓</span> <strong>" + escapeHtml(ref) + "</strong> — column confirmed in session data";
        schemaPanel.appendChild(row);
      });
      schemaMissing.forEach(function (ref) {
        var row = document.createElement("div");
        row.className = "prov-row-warn";
        row.innerHTML = "<span class=\"prov-check-fail\">✗</span> <strong>" + escapeHtml(ref) + "</strong> — column NOT FOUND in session data";
        schemaPanel.appendChild(row);
      });
      panels.appendChild(schemaPanel);
    }


    if (hasFlags) {
      var flagPanel = document.createElement("div");
      var flagTitle = document.createElement("div");
      flagTitle.className = "prov-panel-title prov-title-warn";
      flagTitle.textContent = "Flags";
      flagPanel.appendChild(flagTitle);
      relevantLowConf.forEach(function (k) {
        var info = origins[k];
        var row = document.createElement("div");
        row.className = "prov-row-warn";
        row.textContent = k + " — confidence " + Math.round(info.confidence * 100) + "% (below threshold; verify normalisation)";
        flagPanel.appendChild(row);
      });
      relevantHeld.forEach(function (h) {
        var row = document.createElement("div");
        row.className = "prov-row-warn";
        row.textContent = h.var + "." + h.col + " ← source col '" + h.source_col + "' — held for review ("
          + Math.round(h.confidence * 100) + "% confidence; confirm mapping before analysis)";
        flagPanel.appendChild(row);
      });
      panels.appendChild(flagPanel);
    }


    if (dm.recipe) {
      var recipePanel = document.createElement("div");
      var recipeTitle = document.createElement("div");
      recipeTitle.className = "prov-panel-title";
      recipeTitle.textContent = "Derivation recipe";
      recipePanel.appendChild(recipeTitle);
      var recipeEl = document.createElement("div");
      recipeEl.className = "prov-recipe";
      recipeEl.innerHTML =
        "<strong>" + escapeHtml(dm.recipe) + "</strong> — " +
        escapeHtml(dm.fired_because || "");
      recipePanel.appendChild(recipeEl);
      panels.appendChild(recipePanel);
    }

    footer.appendChild(panels);

    toggleBtn.addEventListener("click", function () {
      panels.hidden = !panels.hidden;
      toggleBtn.classList.toggle("open", !panels.hidden);
      toggleBtn.textContent = panels.hidden ? toggleLabel : "↳ hide provenance";
    });

    cellEl.appendChild(footer);
  }

  function addGeneratedCell(requestText, code, result, schemaCheck, serverId) {
    cellCounter++;
    var notebook = document.getElementById("notebook");

    var cleanCode = _stripComments(code);

    var cellEl = document.createElement("div");
    cellEl.className = "nb-cell";
    if (serverId) cellEl.dataset.serverId = serverId;
    cellEl.innerHTML =
      '<div class="nb-cell-input">' +
        '<div class="nb-cell-marker">[' + cellCounter + ']</div>' +
        '<textarea class="nb-code-area" rows="3">' + escapeHtml(cleanCode) + '</textarea>' +
      '</div>' +
      '<div class="nb-cell-controls">' +
        '<button class="btn-run">Run cell \u25b6</button>' +
        '<button class="btn-remove">Remove</button>' +
        '<button class="btn-promote" style="display:none">\u2606 Promote to analysis</button>' +
      '</div>' +
      '<div class="nb-cell-output empty"></div>';
    notebook.appendChild(cellEl);

    var textarea = cellEl.querySelector(".nb-code-area");
    autoGrow(textarea);
    textarea.addEventListener("input", function () { autoGrow(textarea); });
    cellEl.querySelector(".btn-run").addEventListener("click", function () { runCellEl(cellEl); });
    cellEl.querySelector(".btn-remove").addEventListener("click", function () { cellEl.remove(); });
    cellEl.querySelector(".btn-promote").addEventListener("click", function () { promoteCellEl(cellEl); });

    var outputEl = cellEl.querySelector(".nb-cell-output");
    renderCellOutput(outputEl, result);
    _togglePromoteButton(cellEl, result);

    _buildProvenanceFooter(cellEl, cleanCode, schemaCheck);

    if (typeof cellEl.scrollIntoView === "function") {
      cellEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return cellEl;
  }

  function _togglePromoteButton(cellEl, result) {
    var btn = cellEl.querySelector(".btn-promote");
    if (!btn) return;
    var hasFigure = result && result.figures && result.figures.length > 0 && cellEl.dataset.serverId;
    btn.style.display = hasFigure ? "inline-block" : "none";
  }

  async function promoteCellEl(cellEl) {
    var serverId = parseInt(cellEl.dataset.serverId, 10);
    if (!serverId) return;
    var btn = cellEl.querySelector(".btn-promote");
    btn.disabled = true;
    btn.textContent = "Promoting\u2026";
    try {
      var res = await fetch(API + "/api/dashboards/promote", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, cell_id: serverId }),
      });
      var data = await res.json();
      if (data.status === "ok") {
        btn.textContent = "\u2713 Promoted \u2014 view in Analysis";
      } else {
        btn.disabled = false;
        btn.textContent = "\u2606 Promote to analysis";
        showGenerativeError(data.error || "Could not promote this cell.");
      }
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "\u2606 Promote to analysis";
    }
  }

  var generativeInput = document.getElementById("generative-input");
  var generativeBtn = document.getElementById("generative-submit-btn");

  generativeBtn.addEventListener("click", submitGenerative);
  generativeInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") submitGenerative();
  });

  async function submitGenerative() {
    var text = generativeInput.value.trim();
    if (!text) return;

    generativeBtn.disabled = true;
    generativeBtn.textContent = "Working\u2026";
    generativeInput.disabled = true;

    try {
      var res = await fetch(API + "/api/notebook/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, text: text }),
      });
      var cell = await res.json();

      var REASON_MESSAGES = {
        "cannot_write_files": "This notebook analyses existing data — it can't create files or generate new records.",
        "no_data":            "No derived data yet — complete the Derivation step first.",
        "api_key":            "API key not configured — set ANTHROPIC_API_KEY and restart the backend.",
        "general":            "Analysis unavailable — try rephrasing or narrowing your request.",
      };

      if (cell.status === "error") {
        showGenerativeError(REASON_MESSAGES[cell.reason] || REASON_MESSAGES["general"]);
      } else {
        var cleanCode = _stripComments(cell.code || "");
        if (!cleanCode) {
          showGenerativeError("That analysis isn't possible with this dataset — try a different question.");
        } else {
          addGeneratedCell(text, cell.code, cell.result, cell.schema_check, cell.id);
        }
      }
    } catch (err) {
      showGenerativeError("Could not connect — make sure the backend is running and try again.");
    }

    generativeBtn.disabled = false;
    generativeBtn.textContent = "Analyse \u2192";
    generativeInput.disabled = false;
    generativeInput.value = "";
    generativeInput.focus();
  }


  function autoGrow(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = Math.max(60, textarea.scrollHeight) + "px";
  }

  async function runCellEl(cellEl) {
    var textarea = cellEl.querySelector(".nb-code-area");
    var runBtn = cellEl.querySelector(".btn-run");
    var outputEl = cellEl.querySelector(".nb-cell-output");
    var code = textarea.value;

    runBtn.disabled = true;
    runBtn.textContent = "Running\u2026";
    outputEl.className = "nb-cell-output";
    outputEl.textContent = "";

    try {
      var res = await fetch(API + "/api/notebook/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, code: code }),
      });
      var cell = await res.json();
      if (cell.id) cellEl.dataset.serverId = cell.id;
      renderCellOutput(outputEl, cell.result);
      _togglePromoteButton(cellEl, cell.result);
    } catch (err) {
      outputEl.className = "nb-cell-output error";
      outputEl.textContent = "Could not reach Probe backend at " + API + ".";
    }

    runBtn.disabled = false;
    runBtn.textContent = "Run cell \u25b6";
  }

  function renderCellOutput(outputEl, result) {
    if (!result || result.status === "error") {
      outputEl.className = "nb-cell-output error";
      outputEl.textContent = (result && result.error) ? result.error : "Execution failed.";
      return;
    }

    outputEl.className = "nb-cell-output";
    outputEl.innerHTML = "";

    if (result.stdout) {
      var stdoutEl = document.createElement("div");
      stdoutEl.className = "nb-stdout";
      stdoutEl.textContent = result.stdout;
      outputEl.appendChild(stdoutEl);
    }
    if (result.result_repr) {
      var reprEl = document.createElement("div");
      reprEl.className = "nb-result-repr";
      reprEl.textContent = result.result_repr;
      outputEl.appendChild(reprEl);
    }
    (result.figures || []).forEach(function (b64) {
      var img = document.createElement("img");
      img.src = "data:image/png;base64," + b64;
      outputEl.appendChild(img);
    });

    if (!result.stdout && !result.result_repr && (!result.figures || result.figures.length === 0)) {
      outputEl.className = "nb-cell-output empty";
    }
  }

  // ───────────────────────── Oracles (dormant in this act — see Phase 3) ─────

  var _oracleTypes = {};
  var _oracleInstances = [];
  var oraclesScreenInited = false;

  document.getElementById("btn-back-oracles").addEventListener("click", function () { goTo("screen-9", 9); });
  document.getElementById("btn-oracles-to-analysis").addEventListener("click", async function () {
    var btn = document.getElementById("btn-oracles-to-analysis");
    btn.disabled = true;
    try {
      await fetch(API + "/api/act/enable-oracles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
    } catch (e) {  }
    btn.disabled = false;
    goTo("screen-8", 8);
    initEvidenceScreen();
  });

  async function initOraclesScreen() {
    var descEl = document.getElementById("oracle-desc");
    if (oraclesScreenInited) return;
    oraclesScreenInited = true;

    try {
      var typesRes = await fetch(API + "/api/oracle/types");
      var typesData = await typesRes.json();
      _oracleTypes = typesData.types || {};
      var sel = document.getElementById("oracle-type-select");
      sel.innerHTML = Object.keys(_oracleTypes).map(function (k) {
        return '<option value="' + k + '">' + escapeHtml(_oracleTypes[k].label) + "</option>";
      }).join("");
    } catch (e) {  }

    try {
      var normsRes = await fetch(API + "/api/norms");
      var normsData = await normsRes.json();
      var norms = normsData.norms || [];
      descEl.textContent = norms.length
        ? norms.length + " reference norm(s) already on file from prior resolutions. Resolve a new one below, scoped to this dataset's population."
        : "Nothing resolved yet. Pick an oracle type and describe the population below — the Oracle Agent recalls published sources and computes a consensus range.";
      _oracleInstances = norms.map(function (n) {
        return {
          id: n.id, oracle_type: n.oracle_type || "population_norms", from_norm: true,
          population_args: n.population || {}, sources: n.sources || [],
          consensus: { value: n.value, ci_low: n.ci_low, ci_high: n.ci_high, method: n.method || "" },
          metric: n.metric,
        };
      });
      _renderOracleList();
    } catch (e) {
      descEl.textContent = "Pick an oracle type and describe the population below — the Oracle Agent recalls published sources and computes a consensus range.";
    }
    setRailMeta(6, _oracleInstances.length + " on file");
  }

  function _renderOracleList() {
    var list = document.getElementById("oracle-list");
    if (!_oracleInstances.length) {
      list.innerHTML = '<div class="dash-empty">No oracles resolved yet.</div>';
      return;
    }
    list.innerHTML = "";
    _oracleInstances.slice().reverse().forEach(function (inst) {
      var typeLabel = (_oracleTypes[inst.oracle_type] || {}).label || inst.oracle_type;
      var popBits = Object.keys(inst.population_args || {}).map(function (k) {
        return inst.population_args[k] ? k + ": " + inst.population_args[k] : null;
      }).filter(Boolean).join(" · ") || inst.metric || "";
      var sourcesHtml = (inst.sources || []).map(function (s) {
        return '<div class="oracle-source-row">' +
          '<span class="oracle-source-name">' + escapeHtml(s.source) + (s.pub_year ? " (" + s.pub_year + ")" : "") + '</span>' +
          '<span class="oracle-source-val">' + escapeHtml(s.value) + (s.n ? " · N=" + s.n : "") + '</span>' +
          '</div>';
      }).join("");
      var card = document.createElement("div");
      card.className = "quality-card oracle-card";
      card.innerHTML =
        '<div class="quality-card-header">' +
          '<span class="quality-issue-type">' + escapeHtml(typeLabel) + '</span>' +
          (inst.pinned ? '<span class="dash-status dash-status-publish">Pinned</span>' :
            inst.from_norm ? '<span class="dash-status dash-status-caveats">On file</span>' :
            '<span class="dash-status dash-status-review">Unpinned</span>') +
        '</div>' +
        '<div class="quality-card-location">' + escapeHtml(popBits) + '</div>' +
        '<div class="oracle-consensus">Consensus: <strong>' + escapeHtml(inst.consensus.value) + '</strong>' +
          ' (' + escapeHtml(inst.consensus.ci_low) + '–' + escapeHtml(inst.consensus.ci_high) + ')' +
          (inst.consensus.method ? ' <span class="oracle-method">' + escapeHtml(inst.consensus.method) + '</span>' : '') + '</div>' +
        (sourcesHtml ? '<div class="oracle-sources">' + sourcesHtml + '</div>' : '') +
        (!inst.pinned && !inst.from_norm ? '<button class="btn-mini oracle-pin-btn">Pin this value</button>' : '');
      var pinBtn = card.querySelector(".oracle-pin-btn");
      if (pinBtn) {
        pinBtn.addEventListener("click", async function () {
          pinBtn.disabled = true;
          pinBtn.textContent = "Pinning…";
          try {
            var res = await fetch(API + "/api/oracle/" + encodeURIComponent(inst.id) + "/pin", { method: "POST" });
            var data = await res.json();
            if (data.status === "ok") {
              inst.pinned = data.lockfile;
              _renderOracleList();
            }
          } catch (e) {  }
        });
      }
      list.appendChild(card);
    });
  }

  document.getElementById("oracle-resolve-btn").addEventListener("click", async function () {
    var btn = document.getElementById("oracle-resolve-btn");
    var oracleType = document.getElementById("oracle-type-select").value;
    var metric = document.getElementById("oracle-metric-input").value.trim();
    var population = document.getElementById("oracle-population-input").value.trim();
    var condition = document.getElementById("oracle-condition-input").value.trim();
    if (!oracleType || !metric) return;
    btn.disabled = true;
    btn.textContent = "Oracle Agent recalling sources…";
    try {
      var res = await fetch(API + "/api/oracle/resolve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oracle_type: oracleType,
          population_args: { metric: metric, population: population, condition: condition, entity: population },
        }),
      });
      var data = await res.json();
      if (data.status === "ok") {
        _oracleInstances.push(data.instance);
        _renderOracleList();
        setRailMeta(6, _oracleInstances.length + " on file");
        document.getElementById("oracle-metric-input").value = "";
      } else {
        document.getElementById("oracle-desc").textContent = data.error || "Could not resolve that oracle.";
      }
    } catch (e) {
      document.getElementById("oracle-desc").textContent = "Could not reach the backend.";
    }
    btn.disabled = false;
    btn.textContent = "Resolve oracle →";
  });

  // ───────────────────────── Notebook/Analysis shared chart helpers ─────────

  var STATUS_LABEL = { publish: "Published", caveats: "Caveats", review: "Needs review", reject: "Rejected" };
  var _dashboardCache = {};

  document.getElementById("btn-back-7").addEventListener("click", function () {
    // Analysis (screen-7) is shared across every act, but "back to notebook"
    // means a different screen depending which act got you here — Act 1's
    // single-trial notebook is screen-6, Act 2/3's cross-trial notebook is
    // screen-12. Hardcoding screen-6 here sent Act 2/3 users to the wrong
    // (unpopulated, for this act) notebook screen while the rail still
    // claimed to be in Act 2/3 — exactly the "doesn't stay in the same act" bug.
    goTo(currentAct === 1 ? "screen-6" : "screen-12", 6);
  });
  document.getElementById("btn-to-evidence").addEventListener("click", function () {
    goTo("screen-8", 8);
    initEvidenceScreen();
  });

  function _renderIntel(understanding) {
    var el = document.getElementById("dash-intel");
    if (!understanding) { el.style.display = "none"; return; }
    var risks = (understanding.risks || []);
    el.innerHTML =
      '<div class="dash-intel-row"><span class="dash-intel-label">Dataset type</span>' +
        '<span class="dash-intel-val">' + escapeHtml(understanding.dataset_type) + '</span></div>' +
      '<div class="dash-intel-row"><span class="dash-intel-label">Entities</span>' +
        '<span class="dash-intel-val">' + escapeHtml((understanding.entities || []).join(", ")) + '</span></div>' +
      '<div class="dash-intel-row"><span class="dash-intel-label">Metrics available</span>' +
        '<span class="dash-intel-val">' + escapeHtml((understanding.available_metrics || []).join(", ") || "—") + '</span></div>' +
      (risks.length
        ? '<div class="dash-intel-row dash-intel-risks"><span class="dash-intel-label">Risks</span>' +
            '<span class="dash-intel-val">' + risks.map(escapeHtml).join(" · ") + '</span></div>'
        : '');
    el.style.display = "block";
  }

  function _mountTable(container, rows) {
    if (!rows || !rows.length) {
      container.innerHTML = '<div class="dash-table-empty">No underlying rows returned.</div>';
      return { highlight: function () {}, clear: function () {} };
    }
    var cols = Object.keys(rows[0]);
    var sortCol = null, sortDir = 1, highlightSet = null;

    function render() {
      var indexed = rows.map(function (r, i) { return { r: r, i: i }; });
      if (sortCol) {
        indexed.sort(function (a, b) {
          var av = a.r[sortCol], bv = b.r[sortCol];
          if (av === bv) return 0;
          if (typeof av === "number" && typeof bv === "number") return (av - bv) * sortDir;
          return String(av).localeCompare(String(bv)) * sortDir;
        });
      }
      var html = '<div class="dash-table-wrap"><table class="dash-table"><thead><tr>' +
        cols.map(function (c) {
          var arrow = sortCol === c ? (sortDir === 1 ? " ▲" : " ▼") : "";
          return '<th data-col="' + escapeHtml(c) + '">' + escapeHtml(c) + arrow + '</th>';
        }).join("") + '</tr></thead><tbody>' +
        indexed.map(function (item) {
          var hl = highlightSet && highlightSet.has(item.i) ? " dash-row-highlight" : "";
          return '<tr class="' + hl + '">' + cols.map(function (c) {
            var v = item.r[c];
            return "<td>" + escapeHtml(v === null || v === undefined ? "" : v) + "</td>";
          }).join("") + "</tr>";
        }).join("") + "</tbody></table></div>" +
        '<div class="dash-table-count">' + rows.length + " row(s)" +
        (highlightSet ? " · " + highlightSet.size + " highlighted from your click" : "") + "</div>";
      container.innerHTML = html;
      container.querySelectorAll("th").forEach(function (th) {
        th.addEventListener("click", function () {
          var col = th.dataset.col;
          if (sortCol === col) sortDir = -sortDir; else { sortCol = col; sortDir = 1; }
          render();
        });
      });
      if (highlightSet && highlightSet.size) {
        var firstHl = container.querySelector(".dash-row-highlight");
        if (firstHl) firstHl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    render();

    return {
      highlight: function (matchFn) {
        highlightSet = new Set();
        rows.forEach(function (r, i) { if (matchFn(r)) highlightSet.add(i); });
        render();
      },
      clear: function () { highlightSet = null; render(); },
    };
  }

  function _rowMatchesDatum(dashboard, row, datum) {
    var idField = dashboard.encoding && dashboard.encoding.id;
    if (idField && datum[idField] !== undefined) {
      return row[idField] === datum[idField];
    }
    var keys = Object.keys(datum).filter(function (k) { return k.indexOf("_") !== 0 && (k in row); });
    if (!keys.length) return false;
    return keys.every(function (k) { return row[k] === datum[k]; });
  }

  function _embedResponsive(container, spec, opts) {
    var width = container.clientWidth ||
      (container.parentElement && container.parentElement.clientWidth) || 600;
    var sizedSpec = Object.assign({}, spec, { width: Math.max(width - 4, 200) });
    return window.vegaEmbed(container, sizedSpec, opts);
  }

  function _renderDashLibrary(dashboards, libId, viewId) {
    libId = libId || "notebook-dash-library";
    viewId = viewId || "notebook-dash-view";
    var lib = document.getElementById(libId);
    if (!dashboards.length) {
      lib.innerHTML = '<div class="dash-empty">No analyses yet — generate an Autopilot pack, or ask a question below.</div>';
      return;
    }
    lib.innerHTML = "";
    dashboards.forEach(function (d) {
      _dashboardCache[d.dashboard_id] = d;
      var thumbId = "dash-thumb-" + d.dashboard_id;
      var card = document.createElement("div");
      card.className = "dash-card";
      card.innerHTML =
        '<div class="dash-card-thumb" id="' + thumbId + '"></div>' +
        '<div class="dash-card-body">' +
          '<div class="dash-card-title-row">' +
            '<span class="dash-card-title">' + escapeHtml(d.title) + '</span>' +
            '<span class="dash-status dash-status-' + d.status + '">' + (STATUS_LABEL[d.status] || d.status) + '</span>' +
          '</div>' +
          '<div class="dash-card-prov">' + escapeHtml(d.source) + (d.chart_type ? ' · ' + escapeHtml(d.chart_type) : '') + '</div>' +
        '</div>';
      card.addEventListener("click", function () { _openDashboardView(d.dashboard_id, viewId); });
      lib.appendChild(card);

      var thumbEl = document.getElementById(thumbId);
      if (d.vega_spec && window.vegaEmbed) {
        var thumbSpec = Object.assign({}, d.vega_spec, { height: 110, title: null });
        _embedResponsive(thumbEl, thumbSpec, { actions: false, renderer: "svg" }).catch(function () {
          thumbEl.innerHTML = '<div class="dash-thumb-fallback">' + escapeHtml(d.chart_type || "") + '</div>';
        });
      } else if (d.chart_png) {
        thumbEl.innerHTML = '<img src="data:image/png;base64,' + d.chart_png + '">';
      } else {
        thumbEl.innerHTML = '<div class="dash-thumb-fallback">' + escapeHtml(d.chart_type || "") +
          (d.data ? " · " + d.data.length + " rows" : "") + '</div>';
      }
    });
  }

  async function _openDashboardView(did, viewId) {
    var view = document.getElementById(viewId || "notebook-dash-view");
    view.style.display = "block";
    view.scrollIntoView({ behavior: "smooth", block: "start" });
    view.innerHTML = '<div class="dash-view-loading">Loading…</div>';

    var d = _dashboardCache[did];
    if (!d || d.data === undefined) {
      try {
        var res = await fetch(API + "/api/dashboards/" + encodeURIComponent(did) + "?session_id=" + encodeURIComponent(sessionId));
        d = await res.json();
        _dashboardCache[did] = d;
      } catch (e) {
        view.innerHTML = '<div class="dash-view-loading">Could not load dashboard.</div>';
        return;
      }
    }

    var statsRows = Object.keys(d.stats || {}).map(function (k) {
      var v = d.stats[k];
      return '<span class="dash-stat"><strong>' + escapeHtml(k) + ':</strong> ' + escapeHtml(typeof v === "object" ? JSON.stringify(v) : v) + '</span>';
    }).join("");

    var caveatsHtml = (d.caveats || []).map(function (c) {
      return '<div class="dash-caveat">⚠ ' + escapeHtml(c) + '</div>';
    }).join("");

    var hasTable = d.data && d.data.length > 0;

    view.innerHTML =
      '<div class="dash-view-header">' +
        '<span class="dash-view-title">' + escapeHtml(d.title) + '</span>' +
        '<span class="dash-status dash-status-' + d.status + '">' + (STATUS_LABEL[d.status] || d.status) + '</span>' +
        '<button class="btn dash-view-close" id="dash-view-close">✕</button>' +
      '</div>' +
      '<div class="dash-view-chart" id="dash-chart-mount"></div>' +
      (statsRows ? '<div class="dash-stat-strip">' + statsRows + '</div>' : '') +
      (caveatsHtml ? '<div class="dash-caveats">' + caveatsHtml + '</div>' : '') +
      '<div class="dash-narrative">' + escapeHtml(d.narrative || "") + '</div>' +
      (hasTable
        ? '<button class="prov-toggle" id="dash-data-toggle">↳ view underlying data (click a mark on the chart to highlight its rows)</button>' +
          '<div class="dash-data-table" id="dash-data-table" hidden></div>'
        : '') +
      '<div class="dash-view-source">Source: ' + escapeHtml(d.source) +
        (d.evaluation && d.evaluation.reason ? ' · Evaluator: ' + escapeHtml(d.evaluation.reason) : '') + '</div>' +
      '<div class="dash-view-prompted-by">Prompted by: “' + escapeHtml(d.question) + '”</div>' +
      (d.code
        ? '<button class="prov-toggle" id="dash-code-toggle">↳ view generated code</button>' +
          '<pre class="dash-code" id="dash-code-block" hidden>' + escapeHtml(d.code) + '</pre>'
        : '');

    document.getElementById("dash-view-close").addEventListener("click", function () {
      view.style.display = "none";
    });

    var chartMount = document.getElementById("dash-chart-mount");
    var tableHandle = hasTable ? _mountTable(document.getElementById("dash-data-table"), d.data) : null;

    if (d.chart_type === "static_image" && d.chart_png) {
      chartMount.innerHTML = '<img src="data:image/png;base64,' + d.chart_png + '">' +
        '<div class="dash-static-note">Static image promoted from the notebook — not an interactive/drillable dashboard chart.</div>';
    } else if (d.chart_type === "table") {
      chartMount.innerHTML = '<em>Rendered as a data table below — no separate chart for this question.</em>';
      if (tableHandle) { document.getElementById("dash-data-table").hidden = false; document.getElementById("dash-data-toggle").style.display = "none"; }
    } else if (d.vega_spec && window.vegaEmbed) {
      try {
        var result = await _embedResponsive(chartMount, d.vega_spec, {
          actions: { source: true, compiled: false, editor: false, export: true },
        });
        result.view.addEventListener("click", function (event, item) {
          if (item && item.datum && tableHandle) {
            document.getElementById("dash-data-table").hidden = false;
            document.getElementById("dash-data-toggle").textContent = "↳ hide underlying data";
            tableHandle.highlight(function (row) { return _rowMatchesDatum(d, row, item.datum); });
          }
        });
      } catch (e) {
        console.error("vega-embed failed to render dashboard", d.dashboard_id, e, d.vega_spec);
        chartMount.innerHTML = "<em>Could not render this chart (" + escapeHtml(String(e)) +
          ") — see browser console for the failing spec.</em>";
      }
    } else {
      chartMount.innerHTML = "<em>No chart available for this analysis.</em>";
    }

    var dataToggle = document.getElementById("dash-data-toggle");
    if (dataToggle) {
      dataToggle.addEventListener("click", function () {
        var tbl = document.getElementById("dash-data-table");
        tbl.hidden = !tbl.hidden;
        dataToggle.textContent = tbl.hidden
          ? "↳ view underlying data (click a mark on the chart to highlight its rows)"
          : "↳ hide underlying data";
      });
    }

    var codeToggle = document.getElementById("dash-code-toggle");
    if (codeToggle) {
      codeToggle.addEventListener("click", function () {
        var block = document.getElementById("dash-code-block");
        block.hidden = !block.hidden;
        codeToggle.textContent = block.hidden ? "↳ view generated code" : "↳ hide generated code";
      });
    }
  }

  // ─────────── Notebook's own statistical pass — tree-shaped investigation ───────────
  // Many grounded, mostly-statistical questions, answered one at a time — the
  // wide/shallow pass. Analysis (below) is the few-questions/deep pass over
  // this pass's own results.
  //
  // This used to sit next to a static, pre-baked "try asking" chip list —
  // canned questions duplicating exactly what this autonomous pass already
  // covers properly. That's gone; this IS the "try asking" now. It's also
  // not a flat list: every answered question is handed back to the same
  // Hypothesis Agent with its real result, asking what to look at next — a
  // genuine drill-down tree (bounded by MAX_TREE_DEPTH), not a fixed
  // questionnaire decided before the data was ever looked at. See
  // _makeHypothesisRunner, shared with Act 2/3's cross-trial notebook below.

  var MAX_TREE_DEPTH = 3;
  // Each question run here is an LLM call plus a kernel execution against a
  // single long-lived subprocess that never frees memory mid-session — an
  // uncapped run (previously: every grounded candidate, 10-14, each fanning
  // out up to 3 followups per level) grows that subprocess until the Render
  // instance OOMs partway through. Bound the whole run to a fixed budget:
  // at most 3 initial questions, at most 9 questions total (initials +
  // followups combined), so a session's total kernel/LLM load is predictable.
  var INITIAL_QUESTION_CAP = 3;
  var TOTAL_QUESTION_CAP = 9;

  function _makeHypothesisRunner(cfg) {
    // state: [{question, required_fields, chart_type, rationale, grounded,
    //          status, depth, _lastStats, _lastChartType}]
    var state = [];
    var started = false;
    var running = false;

    function render() {
      var list = document.getElementById(cfg.listId);
      list.innerHTML = "";
      state.forEach(function (q) {
        var row = document.createElement("div");
        row.className = "dash-preview-item" + (q.grounded ? "" : " ungrounded") +
          (q.status !== "pending" ? " q-" + q.status : "") + (q.depth ? " q-depth-" + Math.min(q.depth, 3) : "");
        var statusText = { pending: "queued", running: "running…", done: "✓ done", failed: "✗ failed" }[q.status];
        row.innerHTML =
          (q.depth ? '<span class="dash-preview-branch">↳</span>' : '') +
          '<span class="dash-preview-q">' + escapeHtml(q.question) + '</span>' +
          '<span class="dash-preview-tag">' + escapeHtml(q.chart_type || "") + '</span>' +
          (q.grounded
            ? '<span class="q-status q-status-' + q.status + '">' + statusText + '</span>'
            : '<span class="dash-preview-nogo">' + cfg.skippedLabel + '</span>');
        list.appendChild(row);
      });
    }

    async function load() {
      var panel = document.getElementById(cfg.panelId);
      var list = document.getElementById(cfg.listId);
      var countEl = document.getElementById(cfg.countId);
      panel.style.display = "block";
      list.innerHTML = '<div class="dash-empty">' + cfg.loadingLabel + '</div>';
      try {
        var res = await fetch(API + "/api/dashboards/candidates?session_id=" + encodeURIComponent(sessionId));
        var data = await res.json();
        if (data.status !== "ok") {
          list.innerHTML = '<div class="dash-empty">' + escapeHtml(data.error || "Could not generate candidate questions.") + '</div>';
          return;
        }
        state = (data.hypotheses || []).map(function (h) { return Object.assign({ status: "pending", depth: 0 }, h); });
        var grounded = state.filter(function (q) { return q.grounded; }).length;
        if (countEl) countEl.textContent = "— " + grounded + " " + cfg.groundedLabel + ", " + (state.length - grounded) + " skipped";
        render();
      } catch (e) {
        list.innerHTML = '<div class="dash-empty">Could not reach the backend.</div>';
      }
    }

    async function fetchFollowups(parent) {
      if (parent.depth >= MAX_TREE_DEPTH) return;
      try {
        var res = await fetch(API + "/api/dashboards/followups", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId, question: parent.question,
            stats: parent._lastStats || {}, chart_type: parent._lastChartType, n: 1,
          }),
        });
        var data = await res.json();
        if (data.status !== "ok") return;
        (data.followups || []).forEach(function (h) {
          if (!h.grounded) return;
          state.push(Object.assign({ status: "pending", depth: parent.depth + 1 }, h));
        });
      } catch (e) {  }
    }

    async function run() {
      if (running) return;
      running = true;
      var btn = document.getElementById(cfg.rerunBtnId);
      btn.disabled = true;
      btn.style.display = "none";

      var failed = 0;
      var ranCount = 0;
      var initialRan = 0;
      for (var i = 0; i < state.length && ranCount < TOTAL_QUESTION_CAP; i++) {
        var q = state[i];
        if (!(q.grounded && q.status === "pending")) continue;
        if (q.depth === 0 && initialRan >= INITIAL_QUESTION_CAP) continue;
        q.status = "running";
        render();
        try {
          var res = await fetch(API + "/api/dashboards/generate", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId, mode: "copilot", question: q.question }),
          });
          var data = await res.json();
          if (data.status === "ok") {
            q.status = "done";
            q._lastStats = data.dashboard.stats;
            q._lastChartType = data.dashboard.chart_type;
            ranCount++;
            if (q.depth === 0) initialRan++;
            await cfg.refreshLibrary();
            if (ranCount < TOTAL_QUESTION_CAP) await fetchFollowups(q);
          } else {
            q.status = "failed";
            failed++;
          }
        } catch (e) {
          q.status = "failed";
          failed++;
        }
        render();
      }
      btn.disabled = false;
      if (failed > 0) btn.style.display = "inline-block";
      running = false;
    }

    return {
      init: async function () {
        if (started) return;
        started = true;
        document.getElementById(cfg.controlsId).style.display = "block";
        await load();
        await run();
      },
      rerun: run,
    };
  }

  async function _refreshNotebookDashLibrary() {
    var libRes = await fetch(API + "/api/dashboards?session_id=" + encodeURIComponent(sessionId));
    var libData = await libRes.json();
    _renderDashLibrary(libData.dashboards || []);
    setRailMeta(6, libData.dashboards.length + " analysis(es)");
  }

  var _notebookHypothesisRunner = _makeHypothesisRunner({
    panelId: "notebook-questions-panel", listId: "notebook-preview-list", countId: "notebook-questions-count",
    controlsId: "notebook-analysis-controls", rerunBtnId: "notebook-analysis-rerun-btn",
    loadingLabel: "Hypothesis Agent is reading the schema…",
    groundedLabel: "grounded in the schema", skippedLabel: "ungrounded — skipped",
    refreshLibrary: _refreshNotebookDashLibrary,
  });

  async function initNotebookAnalysisPanel() { await _notebookHypothesisRunner.init(); }

  document.getElementById("notebook-analysis-rerun-btn").addEventListener("click", _notebookHypothesisRunner.rerun);


  // ─────────── Analysis: Synthesis Agent — few, deep questions ───────────
  // Reads every Notebook-stage result and asks what several of them mean
  // TOGETHER — never a single-stat question, that's the Notebook's job.

  var _synthesisQuestionState = []; // [{question, relevant_result_indices, rationale, grounded, status, el}]
  var _synthesisStarted = false;
  var _synthesisResults = [];

  async function initAnalysisScreen() {
    if (_synthesisStarted) return;
    _synthesisStarted = true;
    document.getElementById("dash-controls").style.display = "block";
    await _loadSynthesisQuestions();
    await _runAutonomousSynthesis();
  }

  async function _loadSynthesisQuestions() {
    var panel = document.getElementById("questions-panel");
    var list = document.getElementById("dash-preview-list");
    var countEl = document.getElementById("questions-count");
    var descEl = document.getElementById("dash-desc");
    panel.style.display = "block";
    list.innerHTML = '<div class="dash-empty">Synthesis Agent is reading every notebook result…</div>';
    try {
      var res = await fetch(API + "/api/analysis/candidates?session_id=" + encodeURIComponent(sessionId));
      var data = await res.json();
      if (data.status !== "ok") {
        list.innerHTML = '<div class="dash-empty">' + escapeHtml(data.error || "Could not generate synthesis questions.") + '</div>';
        descEl.textContent = data.error || "Nothing to synthesize yet — run the Notebook stage's analysis pass first.";
        return;
      }
      _synthesisQuestionState = (data.questions || []).map(function (q) { return Object.assign({ status: "pending" }, q); });
      var grounded = _synthesisQuestionState.filter(function (q) { return q.grounded; }).length;
      countEl.textContent = "— " + grounded + " connect multiple notebook findings, " + (_synthesisQuestionState.length - grounded) + " skipped";
      descEl.textContent = "Weighing " + grounded + " question(s) against everything the notebook found, together.";
      _renderSynthesisQuestionsList();
    } catch (e) {
      list.innerHTML = '<div class="dash-empty">Could not reach the backend.</div>';
    }
  }

  function _renderSynthesisQuestionsList() {
    var list = document.getElementById("dash-preview-list");
    list.innerHTML = "";
    _synthesisQuestionState.forEach(function (q) {
      var row = document.createElement("div");
      row.className = "dash-preview-item" + (q.grounded ? "" : " ungrounded") + (q.status !== "pending" ? " q-" + q.status : "");
      var statusText = { pending: "queued", running: "running…", done: "✓ done", failed: "✗ failed" }[q.status];
      var nCited = (q.relevant_result_indices || []).length;
      row.innerHTML =
        '<span class="dash-preview-q">' + escapeHtml(q.question) + '</span>' +
        '<span class="dash-preview-tag">' + nCited + ' findings</span>' +
        (q.grounded
          ? '<span class="q-status q-status-' + q.status + '">' + statusText + '</span>'
          : '<span class="dash-preview-nogo">not enough to synthesize — skipped</span>');
      q.el = row;
      list.appendChild(row);
    });
  }

  // Trace UI is ingestion-only now — no-op, see _notebookLog above.
  function _synthesisLog(msg) {}

  function _renderSynthesisLibrary() {
    var lib = document.getElementById("synthesis-library");
    if (!_synthesisResults.length) {
      lib.innerHTML = '<div class="dash-empty">No synthesis findings yet.</div>';
      return;
    }
    lib.innerHTML = "";
    _synthesisResults.forEach(function (r) {
      var card = document.createElement("div");
      card.className = "synthesis-card";
      var cites = (r.cited_results || []).map(function (c) {
        return '<span class="synthesis-cite">' + escapeHtml(c.title) + '</span>';
      }).join("");
      card.innerHTML =
        '<div class="synthesis-q">' + escapeHtml(r.question) + '</div>' +
        '<div class="synthesis-claim">' + escapeHtml(r.claim) + '</div>' +
        '<div class="synthesis-narrative">' + escapeHtml(r.narrative) + '</div>' +
        (cites ? '<div class="synthesis-cites">' + cites + '</div>' : '');
      lib.appendChild(card);
    });
  }

  var _synthesisRunning = false;

  async function _runAutonomousSynthesis() {
    if (_synthesisRunning) return;
    _synthesisRunning = true;
    var btn = document.getElementById("dash-autopilot-btn");
    btn.disabled = true;
    btn.style.display = "none";

    var grounded = _synthesisQuestionState.filter(function (q) { return q.grounded && q.status === "pending"; });
    if (!grounded.length) {
      _synthesisLog("No synthesis questions to answer.");
      btn.disabled = false;
      _synthesisRunning = false;
      _renderSynthesisLibrary();
      return;
    }
    _synthesisLog("Synthesis Agent found " + grounded.length + " question(s) worth connecting multiple notebook findings for. Answering each autonomously…");

    var done = 0, failed = 0;
    for (var i = 0; i < grounded.length; i++) {
      var q = grounded[i];
      q.status = "running";
      if (q.el) _renderSynthesisQuestionsList();
      _synthesisLog("▸ (" + (i + 1) + "/" + grounded.length + ") running…");
      try {
        var res = await fetch(API + "/api/analysis/generate", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, question: q.question, relevant_result_indices: q.relevant_result_indices }),
        });
        var data = await res.json();
        if (data.status === "ok") {
          q.status = "done";
          done++;
          _synthesisResults.push(data);
          _synthesisLog("  ✓ " + data.claim);
          _renderSynthesisLibrary();
        } else {
          q.status = "failed";
          failed++;
          _synthesisLog("  ✗ failed — " + (data.error || "unknown error"));
        }
      } catch (e) {
        q.status = "failed";
        failed++;
        _synthesisLog("  ✗ failed — could not reach the backend");
      }
      _renderSynthesisQuestionsList();
    }
    _synthesisLog("Done. " + done + " published, " + failed + " failed.");
    setRailMeta(7, done + " synthesis finding(s)");
    btn.disabled = false;
    if (failed > 0) btn.style.display = "inline-block";
    _synthesisRunning = false;
  }

  document.getElementById("dash-autopilot-btn").addEventListener("click", _runAutonomousSynthesis);


  // ───────────────────────── Stage 8 — Evidence ─────────────────────────

  var EVIDENCE_STATUS_CLASS = { unreviewed: "dash-status-review", approved: "dash-status-publish", rejected: "dash-status-reject" };
  var EVIDENCE_STATUS_LABEL = { unreviewed: "Unreviewed", approved: "Approved", rejected: "Rejected" };
  var _evidenceCache = [];

  document.getElementById("btn-back-8").addEventListener("click", function () {
    // Act 3's rail (RAIL_ACT3) deliberately skips Analysis (screen-7) — Act 3
    // goes Oracles -> Evidence -> Narratives directly (see btn-oracles-to-analysis,
    // which actually lands on screen-8). Sending "back" to screen-7 anyway
    // took users to a screen absent from their act's rail, which then couldn't
    // find an active index and rendered with nothing highlighted.
    goTo(currentAct === 3 ? "screen-oracles" : "screen-7", 7);
  });
  document.getElementById("btn-to-narratives").addEventListener("click", function () {
    goTo("screen-9", 9);
    initNarrativesScreen();
  });

  // The benchmark-progress terminal only belongs on screen while a benchmark
  // run is actually happening (see _runOracleBenchmark, which sets it
  // visible). It was never hidden again once shown, so any later visit to
  // Evidence — even with _benchmarkRan already true and no new run starting —
  // kept showing the old completed log. Called on every way of landing on
  // this screen, forward or back, so it's only ever visible during a live run.
  function _resetEvidenceTerminal() {
    var term = document.getElementById("evidence-log");
    term.style.display = "none";
    term.innerHTML = "";
  }

  async function initEvidenceScreen() {
    _resetEvidenceTerminal();

    var oraclesEnabled = false;
    try {
      var res = await fetch(API + "/api/session/" + encodeURIComponent(sessionId) + "/status");
      var data = await res.json();
      oraclesEnabled = !!data.oracles_enabled;
      document.getElementById("evidence-oracle-section").style.display = oraclesEnabled ? "block" : "none";
    } catch (e) {  }
    await _refreshEvidenceList();
    if (oraclesEnabled && !_benchmarkRan) {
      _benchmarkRan = true;
      await _runOracleBenchmark();
    }
  }

  async function _refreshEvidenceList() {
    var list = document.getElementById("evidence-list");
    try {
      var res = await fetch(API + "/api/evidence?session_id=" + encodeURIComponent(sessionId));
      var data = await res.json();
      _evidenceCache = data.evidence || [];
    } catch (e) {
      list.innerHTML = '<div class="dash-empty">Could not reach the backend.</div>';
      return;
    }
    setRailMeta(8, _evidenceCache.length + " item(s)");
    if (!_evidenceCache.length) {
      list.innerHTML = '<div class="dash-empty">No evidence yet — evidence is produced automatically as analyses run, and as oracle comparisons resolve. Run some analyses, or add your own observation above.</div>';
      return;
    }
    list.innerHTML = "";
    _evidenceCache.forEach(function (e) {
      var card = document.createElement("div");
      card.className = "quality-card evidence-card";
      var limitHtml = (e.limitations || []).length
        ? '<div class="dash-caveat">⚠ ' + escapeHtml(e.limitations[0]) + '</div>' : '';
      card.innerHTML =
        '<div class="quality-card-header">' +
          '<span class="quality-issue-type">' + escapeHtml(e.claim) + '</span>' +
          '<span class="dash-status ' + (EVIDENCE_STATUS_CLASS[e.review_status] || "dash-status-review") + '">' +
            (EVIDENCE_STATUS_LABEL[e.review_status] || e.review_status) + '</span>' +
        '</div>' +
        '<div class="quality-card-location">' + escapeHtml(e.kind || "") +
          (e.created_by ? " · " + escapeHtml(e.created_by === "agent" ? "computed" : "human") : "") +
          (e.confidence !== undefined && e.confidence !== null ? " · confidence " + escapeHtml(e.confidence) : "") + '</div>' +
        limitHtml +
        (e.review_status === "unreviewed"
          ? '<div class="evidence-review-row"><button class="btn-mini evidence-approve">Approve</button><button class="btn-mini evidence-reject">Reject</button></div>'
          : '');
      var approveBtn = card.querySelector(".evidence-approve");
      var rejectBtn = card.querySelector(".evidence-reject");
      if (approveBtn) approveBtn.addEventListener("click", function () { _reviewEvidence(e.id, "approved"); });
      if (rejectBtn) rejectBtn.addEventListener("click", function () { _reviewEvidence(e.id, "rejected"); });
      list.appendChild(card);
    });
  }

  async function _reviewEvidence(eid, decision) {
    try {
      await fetch(API + "/api/evidence/" + encodeURIComponent(eid) + "/review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: decision }),
      });
      await _refreshEvidenceList();
    } catch (e) {  }
  }

  document.getElementById("evidence-annotate-btn").addEventListener("click", async function () {
    var input = document.getElementById("evidence-annotate-input");
    var claim = input.value.trim();
    if (!claim) return;
    var btn = document.getElementById("evidence-annotate-btn");
    btn.disabled = true;
    try {
      await fetch(API + "/api/evidence/annotate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, claim: claim }),
      });
      input.value = "";
      await _refreshEvidenceList();
    } catch (e) {  }
    btn.disabled = false;
  });

  function _evidenceLog(msg) {
    var term = document.getElementById("evidence-log");
    term.style.display = "block";
    var line = document.createElement("div");
    line.className = "term-line";
    line.style.opacity = "1";
    line.textContent = msg;
    term.appendChild(line);
    term.scrollTop = term.scrollHeight;
  }

  var _benchmarkRan = false;

  async function _runOracleBenchmark() {
    var btn = document.getElementById("evidence-benchmark-btn");
    btn.disabled = true;
    var term = document.getElementById("evidence-log");
    term.innerHTML = "";
    term.style.display = "block";
    var results = document.getElementById("evidence-benchmark-results");
    results.innerHTML = "";

    var dashboards;
    try {
      var libRes = await fetch(API + "/api/dashboards?session_id=" + encodeURIComponent(sessionId));
      dashboards = (await libRes.json()).dashboards || [];
    } catch (e) {
      _evidenceLog("Could not reach the backend.");
      btn.disabled = false;
      return;
    }
    if (!dashboards.length) {
      _evidenceLog("No analyses to benchmark yet — go run some in the Analysis stage first.");
      btn.disabled = false;
      return;
    }
    _evidenceLog("Checking " + dashboards.length + " analysis(es) for a benchmarkable rate-like claim…");

    var checked = 0, benchmarked = 0, declined = 0, skipped = 0;
    for (var i = 0; i < dashboards.length; i++) {
      var d = dashboards[i];
      btn.textContent = "Checking " + (i + 1) + " of " + dashboards.length + "…";
      _evidenceLog("→ " + (d.title || d.question));
      checked++;
      try {
        var res = await fetch(API + "/api/evidence/benchmark", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, dashboard_id: d.dashboard_id }),
        });
        var data = await res.json();
        if (data.status === "ok") {
          benchmarked++;
          _evidenceLog("  ✓ " + data.metric + " = " + data.trial_value + " vs. " + data.source_count +
            " outside source(s) (" + data.consensus.value + " [" + data.consensus.ci_low + ", " + data.consensus.ci_high + "]) — " +
            (data.excess.attributable ? "attributable" : "not attributable") + " (" + (data.excess.value > 0 ? "+" : "") + data.excess.value + " pts)");
          results.appendChild(_renderBenchmarkCard(d, data));
        } else if (data.status === "declined") {
          declined++;
          _evidenceLog("  ✗ Oracle Agent declined — " + data.reason);
        } else {
          skipped++;
          _evidenceLog("  — no rate-like claim in this analysis, skipped.");
        }
      } catch (e) {
        skipped++;
        _evidenceLog("  ✗ failed — could not reach the backend.");
      }
    }
    _evidenceLog("Done. " + benchmarked + " benchmarked, " + declined + " declined, " + skipped + " had nothing to benchmark.");
    await _refreshEvidenceList();
    btn.disabled = false;
    btn.textContent = "Benchmark against outside research →";
  }

  document.getElementById("evidence-benchmark-btn").addEventListener("click", _runOracleBenchmark);

  function _renderBenchmarkCard(dashboard, data) {
    var card = document.createElement("div");
    card.className = "evidence-benchmark-card";
    var attributable = data.excess.attributable;
    card.innerHTML =
      '<div class="evidence-benchmark-q">' + escapeHtml(dashboard.title || dashboard.question) + '</div>' +
      '<div class="oracle-panel">' +
        '<span class="quality-issue-type">Oracle feed</span>' +
        '<div class="quality-card-location">' + data.source_count + ' attested source(s)</div>' +
        '<div class="oracle-consensus">Trial value — ' + escapeHtml(data.metric) + ': <strong>' + data.trial_value + '</strong></div>' +
      '</div>' +
      '<div class="excess-panel ' + (attributable ? "excess-attributable" : "excess-inconclusive") + '">' +
        '<div class="quality-issue-type">Excess vs. outside consensus</div>' +
        '<div class="excess-value">' + (data.excess.value > 0 ? "+" : "") + data.excess.value + ' pts</div>' +
        '<div class="oracle-method">[' + data.excess.ci_low + ', ' + data.excess.ci_high + ']</div>' +
        '<div class="excess-verdict">' + (attributable ? "Attributable to this dataset" : "Interval spans zero — cannot claim attribution") + '</div>' +
      '</div>';
    return card;
  }


  // ───────────────────────── Stage 9 — Narratives ─────────────────────────

  var NARR_STATUS_CLASS = { publish: "dash-status-publish", caveats: "dash-status-caveats",
    review: "dash-status-review", contradicted: "dash-status-review", reject: "dash-status-reject" };
  var NARR_STATUS_LABEL = { publish: "Confirmed", caveats: "Caveats", review: "Needs review",
    contradicted: "Contradicted", reject: "Rejected" };
  var _narrativeCache = {};

  document.getElementById("btn-back-9").addEventListener("click", function () {
    _resetEvidenceTerminal();
    goTo("screen-8", 8);
  });

  async function initNarrativesScreen() {
    await _refreshNarrativeList();
    await _renderActTransition();
  }

  async function _renderActTransition() {
    var box = document.getElementById("act-transition");
    var titleEl = document.getElementById("act-transition-title");
    var descEl = document.getElementById("act-transition-desc");
    var btn = document.getElementById("act-transition-btn");
    var act = 1;
    try {
      var res = await fetch(API + "/api/session/" + encodeURIComponent(sessionId) + "/status");
      act = (await res.json()).act || 1;
    } catch (e) {  }

    if (act === 1) {
      titleEl.textContent = "Act 2: Compare 3 trials";
      descEl.textContent = "Same pipeline, three prebaked clinical trials of the same drug class — ingested, understood, and compared against each other, still no outside benchmarks.";
      btn.textContent = "Continue to Act 2 →";
      btn.onclick = function () {
        currentAct = 2;
        goTo("screen-10", 10);
        initTripleIngestScreen();
      };
      box.style.display = "block";
    } else if (act === 2) {
      titleEl.textContent = "Act 3: Add outside benchmarks";
      descEl.textContent = "Same 3-trial comparison, now with an Oracle Comparisons stage — Evidence and Narratives will start citing outside published sources alongside the notebook's own results.";
      btn.textContent = "Continue to Act 3 →";
      btn.onclick = function () {
        currentAct = 3;
        goTo("screen-oracles", 9);
        initOraclesScreen();
      };
      box.style.display = "block";
    } else {
      box.style.display = "none";
    }
  }

  async function _refreshNarrativeList() {
    var list = document.getElementById("narr-list");
    try {
      var res = await fetch(API + "/api/narratives?session_id=" + encodeURIComponent(sessionId));
      var data = await res.json();
      var narratives = data.narratives || [];
      setRailMeta(9, narratives.length + " narrative(s)");
      if (!narratives.length) {
        list.innerHTML = '<div class="dash-empty">No narratives yet — compose one above from the analyses and evidence gathered so far.</div>';
      } else {
        list.innerHTML = "";
        narratives.forEach(function (n) {
          _narrativeCache[n.narrative_id] = n;
          var card = document.createElement("div");
          card.className = "dash-card narr-card";
          card.innerHTML =
            '<div class="dash-card-body">' +
              '<div class="dash-card-title-row">' +
                '<span class="dash-card-title">' + escapeHtml(n.thesis) + '</span>' +
                '<span class="dash-status ' + (NARR_STATUS_CLASS[n.status] || "dash-status-review") + '">' +
                  (NARR_STATUS_LABEL[n.status] || n.status) + '</span>' +
              '</div>' +
              '<div class="dash-card-prov">' + (n.dashboards || []).length + ' dashboard(s)</div>' +
            '</div>';
          card.addEventListener("click", function () { _openNarrativeView(n.narrative_id); });
          list.appendChild(card);
        });
      }
    } catch (e) {
      list.innerHTML = '<div class="dash-empty">Could not reach the backend.</div>';
    }
  }

  document.getElementById("narr-generate-btn").addEventListener("click", async function () {
    var btn = document.getElementById("narr-generate-btn");
    btn.disabled = true;
    btn.textContent = "Hypothesis → Oracle → Narrative Agent running…";
    try {
      var res = await fetch(API + "/api/narratives/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      var data = await res.json();
      if (data.status === "ok" && data.narrative) {
        await _refreshNarrativeList();
        _openNarrativeView(data.narrative.narrative_id);
      } else {
        document.getElementById("narr-desc").textContent = data.error || "Could not compose a narrative from the current analyses and evidence.";
      }
    } catch (e) {
      document.getElementById("narr-desc").textContent = "Could not reach the backend.";
    }
    btn.disabled = false;
    btn.textContent = "Compose narrative →";
  });

  async function _openNarrativeView(nid) {
    var view = document.getElementById("narr-view");
    view.style.display = "block";
    view.scrollIntoView({ behavior: "smooth", block: "start" });
    view.innerHTML = '<div class="dash-view-loading">Loading…</div>';

    var n = _narrativeCache[nid];
    if (!n) {
      try {
        var res = await fetch(API + "/api/narratives/" + encodeURIComponent(nid));
        var data = await res.json();
        n = data.narrative;
        _narrativeCache[nid] = n;
      } catch (e) {
        view.innerHTML = '<div class="dash-view-loading">Could not load narrative.</div>';
        return;
      }
    }

    var dashboardsHtml = (n.dashboards || []).map(function (d, di) {
      var panelsHtml = (d.panels || []).map(function (p, pi) {
        var mountId = "narr-chart-" + n.narrative_id + "-" + di + "-" + pi;
        var caveatsHtml = (p.caveats || []).map(function (c) { return '<div class="dash-caveat">⚠ ' + escapeHtml(c) + '</div>'; }).join("");
        var body;
        if (p.type === "oracle") {
          body = '<div class="oracle-panel"><span class="quality-issue-type">' + escapeHtml(p.title) + '</span>' +
            '<div class="quality-card-location">' + escapeHtml(p.sub || "") + '</div>' +
            '<div class="oracle-consensus">Trial value — ' + escapeHtml(p.trial_metric) + ': <strong>' + escapeHtml(p.trial_value) + '</strong></div></div>';
        } else if (p.type === "excess" || p.type === "verdict") {
          var attributable = p.excess && p.excess.attributable;
          body = '<div class="excess-panel ' + (attributable ? "excess-attributable" : "excess-inconclusive") + '">' +
            '<div class="quality-issue-type">' + escapeHtml(p.title || "") + '</div>' +
            '<div class="quality-card-location">' + escapeHtml(p.sub || "") + '</div>' +
            '<div class="excess-value">' + (p.excess ? (p.excess.value > 0 ? "+" : "") + escapeHtml(p.excess.value) : "—") + ' pts</div>' +
            (p.excess ? '<div class="oracle-method">[' + escapeHtml(p.excess.ci_low) + ', ' + escapeHtml(p.excess.ci_high) + ']</div>' : '') +
            '<div class="excess-verdict">' + (attributable ? "Attributable to trial effect" : "Interval spans zero — cannot claim attribution") + '</div>' +
          '</div>';
        } else if (p.chart_type === "table" || !p.vega_spec) {
          body = '<em>' + escapeHtml(p.title || "") + '</em>';
        } else {
          body = '<div class="dash-view-chart narr-chart-mount" id="' + mountId + '" data-spec-idx="' + di + "-" + pi + '"></div>';
        }
        return '<div class="narr-panel">' + body +
          (p.narrative ? '<div class="dash-narrative">' + escapeHtml(p.narrative) + '</div>' : '') +
          caveatsHtml +
        '</div>';
      }).join("");
      return '<div class="narr-dashboard">' +
        '<h3 class="narr-dashboard-title">' + escapeHtml(d.title) + '</h3>' +
        (d.take ? '<p class="screen-desc" style="margin-bottom:12px;">' + escapeHtml(d.take) + '</p>' : '') +
        panelsHtml +
      '</div>';
    }).join("");

    var storyHtml = n.story
      ? '<div class="narr-story">' + n.story.split(/\n{2,}/).map(function (p) {
          return '<p>' + escapeHtml(p.trim()) + '</p>';
        }).join("") + '</div>'
      : '';

    view.innerHTML =
      '<div class="dash-view-header">' +
        '<span class="dash-view-title">' + escapeHtml(n.thesis) + '</span>' +
        '<span class="dash-status ' + (NARR_STATUS_CLASS[n.status] || "dash-status-review") + '">' +
          (NARR_STATUS_LABEL[n.status] || n.status) + '</span>' +
        '<button class="btn dash-view-close" id="narr-view-close">✕</button>' +
      '</div>' +
      storyHtml +
      dashboardsHtml;

    document.getElementById("narr-view-close").addEventListener("click", function () { view.style.display = "none"; });

    (n.dashboards || []).forEach(function (d, di) {
      (d.panels || []).forEach(function (p, pi) {
        if (p.chart_type === "table" || !p.vega_spec) return;
        var mount = document.getElementById("narr-chart-" + n.narrative_id + "-" + di + "-" + pi);
        if (mount && window.vegaEmbed) {
          _embedResponsive(mount, p.vega_spec, { actions: false, renderer: "svg" }).catch(function (e) {
            mount.innerHTML = "<em>Could not render this chart.</em>";
          });
        }
      });
    });
  }


  // ───────────────────────── Contextual Understanding's gen-AI pass ─────────
  // Shared by screen-5 (single dataset) and screen-11 (combined 3-trial) —
  // both just point it at different DOM ids; the backend endpoints already
  // work off whatever sess["dataset_understanding"] currently is.

  async function _runUnderstandingAgent(cfg) {
    var panel = document.getElementById(cfg.panelId);
    var list = document.getElementById(cfg.listId);
    var countEl = document.getElementById(cfg.countId);
    var log = document.getElementById(cfg.logId);
    var results = document.getElementById(cfg.resultsId);
    panel.style.display = "block";
    list.innerHTML = '<div class="dash-empty">Data Understanding Agent is reading the schema…</div>';

    // Trace UI is ingestion-only now — no-op, see _notebookLog above.
    function ulog(msg) {}

    var questions;
    try {
      var res = await fetch(API + "/api/understanding/candidates?session_id=" + encodeURIComponent(sessionId));
      var data = await res.json();
      if (data.status !== "ok") {
        list.innerHTML = '<div class="dash-empty">' + escapeHtml(data.error || "Could not generate questions.") + '</div>';
        return;
      }
      questions = data.questions || [];
    } catch (e) {
      list.innerHTML = '<div class="dash-empty">Could not reach the backend.</div>';
      return;
    }

    countEl.textContent = "— " + questions.length + " question(s)";
    list.innerHTML = "";
    results.innerHTML = "";
    var rows = questions.map(function (q) {
      var row = document.createElement("div");
      row.className = "dash-preview-item";
      row.innerHTML = '<span class="dash-preview-q">' + escapeHtml(q.question) + '</span>' +
        '<span class="q-status q-status-pending">queued</span>';
      list.appendChild(row);
      return row;
    });

    ulog("Data Understanding Agent proposed " + questions.length + " question(s) about this data's nature. Answering each…");
    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      var statusEl = rows[i].querySelector(".q-status");
      statusEl.className = "q-status q-status-running"; statusEl.textContent = "running…";
      ulog("▸ (" + (i + 1) + "/" + questions.length + ") running…");
      try {
        var ares = await fetch(API + "/api/understanding/generate", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, question: q.question }),
        });
        var adata = await ares.json();
        if (adata.status === "ok") {
          statusEl.className = "q-status q-status-done"; statusEl.textContent = "✓ done";
          ulog("  ✓ " + adata.claim);
          var card = document.createElement("div");
          card.className = "synthesis-card";
          card.innerHTML = '<div class="synthesis-q">' + escapeHtml(q.question) + '</div>' +
            '<div class="synthesis-claim">' + escapeHtml(adata.claim) + '</div>' +
            '<div class="synthesis-narrative">' + escapeHtml(adata.narrative) + '</div>';
          results.appendChild(card);
        } else {
          statusEl.className = "q-status q-status-failed"; statusEl.textContent = "✗ failed";
          ulog("  ✗ failed — " + (adata.error || "unknown error"));
        }
      } catch (e) {
        statusEl.className = "q-status q-status-failed"; statusEl.textContent = "✗ failed";
        ulog("  ✗ failed — could not reach the backend");
      }
    }
    ulog("Done.");
  }


  // ───────────────────────── Act 2/3 — Ingest 3 trials ─────────────────────
  // Same mechanics as Act 1's Ingest screen: nothing loads until the user
  // does something (drop/browse files, or click the prebaked-trials button),
  // and every file's trace renders live and in full, the same way.

  var _tripleIngestStarted = false;

  function initTripleIngestScreen() {
    if (_tripleIngestStarted) return;
    _tripleIngestStarted = true;

    var dropzone = document.getElementById("triple-dropzone");
    var fileInput = document.getElementById("triple-file-input");
    document.getElementById("triple-browse-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      fileInput.click();
    });
    dropzone.addEventListener("click", function () { fileInput.click(); });
    ["dragenter", "dragover"].forEach(function (evt) {
      dropzone.addEventListener(evt, function (e) { e.preventDefault(); dropzone.classList.add("dragover"); });
    });
    ["dragleave", "drop"].forEach(function (evt) {
      dropzone.addEventListener(evt, function (e) { e.preventDefault(); dropzone.classList.remove("dragover"); });
    });
    dropzone.addEventListener("drop", function (e) { _handleTripleFiles(e.dataTransfer.files); });
    fileInput.addEventListener("change", function () { _handleTripleFiles(fileInput.files); });

    document.getElementById("load-triple-btn").addEventListener("click", _loadPrebakedTriple);
  }

  async function _handleTripleFiles(fileList) {
    await ensureSession();
    for (var i = 0; i < fileList.length; i++) {
      await _uploadTripleFile(fileList[i]);
    }
  }

  async function _uploadTripleFile(file) {
    var formData = new FormData();
    formData.append("session_id", sessionId);
    formData.append("file", file);
    try {
      var res = await fetch(API + "/api/upload", { method: "POST", body: formData });
      var data = await res.json();
      _renderTraceBlock(file.name, data.trace, "triple-ingest-log");
      document.getElementById("btn-triple-to-quality").disabled = false;
    } catch (err) {
      _renderTraceBlock(file.name, [{ level: "error", text: "Could not reach Probe backend at " + API }], "triple-ingest-log");
    }
  }

  async function _loadPrebakedTriple() {
    await ensureSession();
    var grid = document.getElementById("triple-ingest-grid");
    var btn = document.getElementById("load-triple-btn");
    btn.disabled = true;
    btn.textContent = "Loading…";
    try {
      var res = await fetch(API + "/api/load-triple-trials", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      var data = await res.json();
      if (data.status !== "ok") {
        _renderTraceBlock("load-triple-trials", [{ level: "error", text: data.error || "failed to load trials" }], "triple-ingest-log");
        btn.disabled = false;
        btn.textContent = "⚛ Load 3 prebaked trials (simulated)";
        return;
      }
      btn.textContent = "3 prebaked trials (simulated) — loaded ✓";

      grid.innerHTML = "";
      Object.keys(data.trials).forEach(function (suf) {
        var t = data.trials[suf];
        var card = document.createElement("div");
        card.className = "triple-ingest-card";
        var domainRows = Object.keys(t.loaded).map(function (d) {
          return '<div class="triple-ingest-domain-row"><span>' + d + '</span><span>' + t.loaded[d].n_rows + ' rows</span></div>';
        }).join("");
        card.innerHTML = '<div class="triple-ingest-card-title">' + escapeHtml(t.label) + '</div>' +
          '<div class="triple-ingest-card-sub">' + escapeHtml(t.study_id) + '</div>' + domainRows +
          '<div class="triple-ingest-domain-row" id="triple-derive-' + suf + '"><span>Derivation</span><span>pending…</span></div>';
        grid.appendChild(card);
      });
      (data.traces || []).forEach(function (t) { _renderTraceBlock(t.filename, t.trace, "triple-ingest-log"); });

      var dres = await fetch(API + "/api/derive-triple", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      var ddata = await dres.json();
      Object.keys(ddata.trials || {}).forEach(function (suf) {
        var r = ddata.trials[suf];
        var el = document.getElementById("triple-derive-" + suf);
        if (r.status === "ok") {
          var n = Object.keys(r.datasets).length;
          el.querySelector("span:last-child").textContent = n + " tables derived";
        } else {
          el.querySelector("span:last-child").textContent = "failed";
        }
      });
      document.getElementById("btn-triple-to-quality").disabled = false;
    } catch (e) {
      _renderTraceBlock("load-triple-trials", [{ level: "error", text: "Could not reach the backend." }], "triple-ingest-log");
    }
    btn.disabled = false;
  }

  var _tripleQualityRunner = _makeQualityRunner({
    listId: "triple-quality-issue-list", descId: "triple-quality-desc",
    onContinue: function () { goTo("screen-11", 11); initTripleUnderstandingScreen(); },
  });

  document.getElementById("btn-triple-to-quality").addEventListener("click", function () {
    goTo("screen-13", 13);
    _tripleQualityRunner.run();
  });
  document.getElementById("btn-apply-triple-quality").addEventListener("click", function () { _tripleQualityRunner.apply(); });
  document.getElementById("btn-back-13").addEventListener("click", function () { goTo("screen-10", 10); });


  // ───────────────────────── Act 2/3 — Combined understanding ──────────────

  var _tripleUnderstandingStarted = false;

  function _renderTripleIntel(u) {
    var el = document.getElementById("triple-dash-intel");
    var trialRows = Object.keys(u.trials || {}).map(function (k) {
      var t = u.trials[k];
      return '<div class="dash-intel-row"><span class="dash-intel-label">' + escapeHtml(t.label) + '</span>' +
        '<span class="dash-intel-val">N=' + t.n_subjects + ' · ' + escapeHtml((t.risks || []).join("; ") || "no flagged risks") + '</span></div>';
    }).join("");
    el.innerHTML =
      '<div class="dash-intel-row"><span class="dash-intel-label">Shared entities</span><span class="dash-intel-val">' + escapeHtml((u.entities || []).join(", ")) + '</span></div>' +
      '<div class="dash-intel-row"><span class="dash-intel-label">Shared metrics</span><span class="dash-intel-val">' + escapeHtml((u.available_metrics || []).join(", ")) + '</span></div>' +
      trialRows;
    el.style.display = "block";
  }

  async function initTripleUnderstandingScreen() {
    if (_tripleUnderstandingStarted) return;
    _tripleUnderstandingStarted = true;
    var descEl = document.getElementById("triple-understanding-desc");
    try {
      var res = await fetch(API + "/api/index/build-triple", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      var data = await res.json();
      if (data.status === "ok") {
        _renderTripleIntel(data.understanding);
        descEl.textContent = "Indexed all 3 trials — " + (data.understanding.available_metrics || []).length +
          " shared metric(s), " + (data.understanding.supported_analyses || []).length + " analysis families supported across them.";
      } else {
        descEl.textContent = data.error || "Could not build combined understanding.";
      }
    } catch (e) {
      descEl.textContent = "Could not reach the backend.";
    }
    document.getElementById("btn-triple-to-notebook").disabled = false;
    _runUnderstandingAgent({
      panelId: "triple-uq-panel", listId: "triple-uq-list", countId: "triple-uq-count",
      logId: "triple-uq-log", resultsId: "triple-uq-results",
    });
  }

  document.getElementById("btn-back-11").addEventListener("click", function () { goTo("screen-13", 13); });
  document.getElementById("btn-triple-to-notebook").addEventListener("click", function () {
    goTo("screen-12", 12);
    initTripleNotebookScreen();
  });


  // ───────────────────────── Act 2/3 — Notebook (comparisons) ──────────────
  // Same tree-shaped Hypothesis Agent pass as Act 1's notebook (_makeHypothesisRunner
  // above) — cross-trial questions this time (compare_mode is handled server-side
  // from the session's act), with follow-ups drilling into each finding the same way.

  async function _refreshTripleNotebookDashLibrary() {
    var libRes = await fetch(API + "/api/dashboards?session_id=" + encodeURIComponent(sessionId));
    var libData = await libRes.json();
    _renderDashLibrary(libData.dashboards || [], "triple-dash-library", "triple-dash-view");
  }

  var _tripleNotebookHypothesisRunner = _makeHypothesisRunner({
    panelId: "triple-nq-panel", listId: "triple-nq-list", countId: "triple-nq-count",
    controlsId: "triple-na-controls", rerunBtnId: "triple-na-rerun-btn",
    loadingLabel: "Hypothesis Agent is reading all 3 trials’ schema…",
    groundedLabel: "genuine cross-trial question(s)", skippedLabel: "not cross-trial — skipped",
    refreshLibrary: _refreshTripleNotebookDashLibrary,
  });

  async function initTripleNotebookScreen() { await _tripleNotebookHypothesisRunner.init(); }

  document.getElementById("triple-na-rerun-btn").addEventListener("click", _tripleNotebookHypothesisRunner.rerun);
  document.getElementById("btn-back-12").addEventListener("click", function () { goTo("screen-11", 11); });
  document.getElementById("btn-triple-notebook-continue").addEventListener("click", function () {
    // Acts are additive, not exclusive — sess["dashboards"] on the backend
    // never gets cleared between acts, so /api/analysis/candidates already
    // synthesizes over every dashboard from every act so far. What's reset
    // here is only this screen's own client-side cache, so the Synthesis
    // Agent re-runs its pass and picks up the notebook results Act 2 just
    // added, on top of (not instead of) Act 1's.
    _synthesisStarted = false;
    _synthesisQuestionState = [];
    _synthesisResults = [];
    goTo("screen-7", 7);
    initAnalysisScreen();
  });


  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
})();
