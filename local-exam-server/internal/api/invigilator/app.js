// NACOLM CBT invigilator console. Plain JavaScript, no build step. Every
// piece of text from the server goes into the page as text, never as HTML.
(function () {
  'use strict';
  var app = document.getElementById('app');
  var STATUS_LABEL = { not_checked_in: 'Not checked in', checked_in: 'Checked in', started: 'Started', submitted: 'Submitted' };
  var EVENT_LABEL = {
    tab_hidden: 'Switched away from the exam (tab hidden)',
    window_blur: 'Exam window lost focus',
    fullscreen_exit: 'Left full screen',
    multi_screen: 'Second display detected',
    print_attempt: 'Tried to print',
    screenshot_key: 'Pressed Print Screen',
    bulk_insert: 'Large block of text appeared at once',
    paste_attempt: 'Tried to paste (blocked)',
    blocked_shortcut: 'Blocked keyboard shortcut',
    concurrent_login_blocked: 'Sign-in attempt from another computer (blocked)',
    session_moved: 'Moved to another computer',
    signed_in: 'Signed in',
    locked: 'Exam paused after repeated warnings',
    unlocked: 'Unlocked by the invigilator',
    relogin_allowed: 'Allowed to sign in on another computer',
    time_extended: 'Extra time given',
  };
  var SERIOUS = { tab_hidden: 1, window_blur: 1, fullscreen_exit: 1, multi_screen: 1, print_attempt: 1, screenshot_key: 1, bulk_insert: 1, concurrent_login_blocked: 1 };
  var state = { status: null, candidates: [], error: '', busy: false, filter: '', selected: '', events: [], notice: '' };

  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child == null || child === false) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) el.appendChild(c); });
      else el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return el;
  }

  function api(path, opts) {
    return fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts)).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) { var e = new Error(body.error || 'Request failed'); e.status = r.status; throw e; }
        return body;
      });
    });
  }
  function post(path, body) { return api(path, { method: 'POST', body: JSON.stringify(body || {}) }); }

  function time(iso) { return iso ? new Date(iso).toLocaleTimeString('en-GB') : ''; }
  function ago(iso) {
    if (!iso) return '';
    var s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    return s < 60 ? s + 's ago' : Math.round(s / 60) + ' min ago';
  }

  // ---- sign-in / release ----
  function keyForm(opts) {
    var input = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'Paste the key, e.g. 3f9a1c…', 'aria-label': 'Release key' });
    var btn = h('button', { class: 'btn primary', type: 'submit', text: state.busy ? opts.busyLabel : opts.label, disabled: state.busy });
    var form = h('form', { onsubmit: function (e) {
      e.preventDefault();
      var key = input.value.trim();
      if (!key) return;
      state.busy = true; state.error = ''; render();
      post(opts.path, { key_hex: key })
        .then(function () { state.busy = false; return refresh(); })
        .catch(function (err) { state.busy = false; state.error = err.message; render(); });
    } }, h('label', { class: 'field' }, h('span', { text: 'Release key (hex)' }), input), btn);
    return h('div', { class: 'card' },
      h('h2', { text: opts.title }),
      h('p', { class: 'muted', text: opts.help }),
      state.error ? h('div', { class: 'alert error', text: state.error }) : null,
      form);
  }

  // ---- roster ----
  function summary() {
    var c = { checked: 0, started: 0, submitted: 0, flagged: 0, paused: 0, offline: 0 };
    state.candidates.forEach(function (x) {
      if (x.status !== 'not_checked_in') c.checked++;
      if (x.status === 'started') c.started++;
      if (x.status === 'submitted') c.submitted++;
      if (x.flags > 0) c.flagged++;
      if (x.locked) c.paused++;
      if (x.status === 'started' && !x.online) c.offline++;
    });
    var stat = function (label, n) { return h('div', { class: 'stat' }, h('b', { text: String(n) }), h('span', { text: label })); };
    return h('div', { class: 'summary' },
      stat('On roster', state.candidates.length), stat('Checked in', c.checked), stat('In progress', c.started),
      stat('Submitted', c.submitted), stat('Flagged', c.flagged), stat('Paused', c.paused), stat('Offline', c.offline));
  }

  function connection(c) {
    if (!c.last_seen) return h('span', { class: 'muted-cell', text: '—' });
    if (c.status === 'submitted') return h('span', { class: 'muted-cell', text: 'Finished' });
    return h('span', { class: 'conn ' + (c.online ? 'on' : 'off'), text: c.online ? 'Online' : 'Offline, last seen ' + ago(c.last_seen) });
  }

  function candidateTable() {
    var filter = state.filter.trim().toLowerCase();
    var rows = state.candidates.filter(function (c) {
      return !filter || (c.service_number + ' ' + c.full_name + ' ' + (c.seat || '')).toLowerCase().indexOf(filter) !== -1;
    });
    var table = h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { text: 'Service number' }), h('th', { text: 'Name' }), h('th', { text: 'Computer' }),
        h('th', { text: 'Status' }), h('th', { text: 'Connection' }), h('th', { text: 'Flags' }), h('th', { text: 'Reference' }))),
      h('tbody', {}, rows.map(function (c) {
        var cls = (c.locked ? 'paused' : c.flags > 0 ? 'flagged' : '') + (state.selected === c.service_number ? ' selected' : '');
        return h('tr', { class: cls },
          h('td', { text: c.service_number }),
          h('td', {}, h('button', { class: 'name', type: 'button', onclick: function () { select(c.service_number); } }, c.rank + ' ' + c.full_name)),
          h('td', { text: c.seat || '—' }),
          h('td', { class: 'status' },
            h('span', { class: 'badge ' + c.status, text: STATUS_LABEL[c.status] || c.status }),
            c.locked ? h('span', { class: 'badge paused', text: ' Paused' }) : null),
          h('td', {}, connection(c)),
          h('td', {}, c.flags > 0 ? h('span', { class: 'flag-count', title: c.flags + ' integrity warning(s). Open the candidate to see them.', text: String(c.flags) }) : h('span', { class: 'muted-cell', text: '—' })),
          h('td', { text: c.reference || '—' }));
      })));
    var search = h('input', { class: 'search', type: 'text', placeholder: 'Search by service number, name or computer…', value: state.filter, oninput: function (e) { state.filter = e.target.value; render(); var s = document.querySelector('input.search'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } } });
    var st = state.status;
    return h('div', { class: 'card' },
      h('h2', { text: st.title || 'Exam roster' }),
      h('p', { class: 'muted', text: (st.duration_minutes || '?') + ' minutes · ' + (st.questions_per_candidate || '?') + ' questions per candidate · results ' + (st.publish_mode === 'immediate' ? 'shown at submit' : 'held for review') +
        ' · ' + (st.lock_after ? 'exam pauses after ' + st.lock_after + ' warnings' : 'pausing turned off') + (st.seb_required ? ' · Safe Exam Browser required' : '') }),
      summary(),
      h('div', { class: 'toolbar' }, search,
        h('a', { class: 'btn small', href: '/invigilator/api/incidents.csv', download: 'incidents.csv', text: 'Download incident log (CSV)' }),
        h('a', { class: 'btn small primary', href: '/invigilator/api/results.json', download: 'results.json', title: 'Signed results for the exam officer to import into the portal', text: 'Download results file' })),
      h('div', { class: 'tablewrap' }, table));
  }

  // ---- one candidate ----
  function detail() {
    var c = state.candidates.filter(function (x) { return x.service_number === state.selected; })[0];
    if (!c) return null;
    var minutes = h('select', { 'aria-label': 'Minutes' }, [5, 10, 15, 20, 30, 45, 60].map(function (m) { return h('option', { value: String(m), text: m + ' min' }); }));
    var reason = h('input', { type: 'text', maxlength: '200', placeholder: 'e.g. computer froze for 8 minutes', 'aria-label': 'Reason for extra time' });
    function act(path, body, done) {
      state.busy = true; state.error = ''; state.notice = ''; render();
      post(path, Object.assign({ service_number: c.service_number }, body || {}))
        .then(function () { state.busy = false; state.notice = done; return refresh(); })
        .catch(function (err) { state.busy = false; state.error = err.message; render(); });
    }
    var actions = h('div', { class: 'actions' },
      c.locked ? h('button', { class: 'btn danger', type: 'button', disabled: state.busy, text: 'Unlock and let them continue', onclick: function () { act('/invigilator/api/unlock', null, 'Unlocked. Their computer resumes within a few seconds.'); } }) : null,
      h('button', { class: 'btn', type: 'button', disabled: state.busy, text: 'Allow sign-in on another computer', onclick: function () { act('/invigilator/api/allow-move', null, 'They can now sign in on another computer.'); } }),
      c.status === 'started' ? h('label', { class: 'field' }, h('span', { text: 'Extra time' }), minutes) : null,
      c.status === 'started' ? h('label', { class: 'field' }, h('span', { text: 'Reason (recorded)' }), reason) : null,
      c.status === 'started' ? h('button', { class: 'btn', type: 'button', disabled: state.busy, text: 'Give extra time', onclick: function () {
        act('/invigilator/api/extend', { minutes: Number(minutes.value), reason: reason.value }, 'Extra time given.');
      } }) : null);
    var timeline = state.events.length
      ? h('ul', { class: 'timeline' }, state.events.slice().reverse().map(function (e) {
        return h('li', { class: SERIOUS[e.kind] ? 'serious' : '' },
          h('time', { text: time(e.at) }),
          h('span', {}, EVENT_LABEL[e.kind] || e.kind, e.detail ? h('span', { class: 'd', text: e.detail }) : null));
      }))
      : h('p', { class: 'muted', text: 'Nothing recorded yet.' });
    return h('div', { class: 'card detail' },
      h('div', { class: 'head' },
        h('h2', { text: c.rank + ' ' + c.full_name }),
        h('span', { class: 'muted-cell', text: c.service_number + (c.seat ? ' · computer ' + c.seat : '') + (c.ip ? ' · ' + c.ip : '') }),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn small', type: 'button', text: 'Close', onclick: function () { select(''); } })),
      c.locked ? h('div', { class: 'alert error', text: 'Paused: ' + (c.lock_reason || 'integrity warnings') + '. Check the candidate, then unlock. Their time is still running.' }) : null,
      state.notice ? h('div', { class: 'alert ok', text: state.notice }) : null,
      state.error ? h('div', { class: 'alert error', text: state.error }) : null,
      actions,
      h('h3', { text: 'What was recorded' }),
      timeline);
  }

  function select(svc) {
    state.selected = svc; state.events = []; state.notice = ''; state.error = '';
    render();
    if (svc) loadEvents();
  }
  function loadEvents() {
    if (!state.selected) return Promise.resolve();
    return api('/invigilator/api/events?candidate=' + encodeURIComponent(state.selected)).then(function (b) { state.events = b.events || []; render(); }, function () {});
  }

  function render() {
    var active = document.activeElement;
    var keepFocus = active && active.tagName === 'INPUT' && active.closest && active.closest('.detail') ? active : null;
    if (keepFocus) return; // don't wipe what the invigilator is typing; the next refresh redraws
    app.replaceChildren();
    if (!state.status) { app.appendChild(h('div', { class: 'boot', text: state.error || 'Loading…' })); return; }
    var st = state.status;
    var top = h('div', { class: 'top' },
      h('b', { text: 'Invigilator console' }),
      h('span', { class: 'sub', text: st.centre + ' · ' + st.exam_id }),
      h('span', { class: 'grow' }),
      h('span', { class: 'pill ' + (st.released ? 'ok' : 'bad'), text: st.released ? 'Released' : 'Not released' }),
      st.signed_in ? h('button', { class: 'btn', type: 'button', text: 'Sign out', onclick: function () { post('/invigilator/api/logout').then(refresh); } }) : null);
    var page = h('div', { class: 'page' });
    if (!st.roster_loaded) page.appendChild(h('div', { class: 'card' }, h('div', { class: 'alert error', text: 'No candidate roster is loaded on this exam server (CBT_ROSTER_PATH). Candidates will not be able to sign in even after release.' })));
    if (!st.released) {
      page.appendChild(keyForm({ path: '/invigilator/api/release', title: 'Open this exam', label: 'Open exam', busyLabel: 'Opening…',
        help: 'Paste the release key handed to you by the exam officer, then press Open exam. Candidates cannot start until this is done. This also signs this computer in to the console.' }));
    } else if (!st.signed_in) {
      page.appendChild(keyForm({ path: '/invigilator/api/login', title: 'Sign in to the invigilator console', label: 'Sign in', busyLabel: 'Signing in…',
        help: 'The exam is open. Enter the same release key to watch the room from this computer.' }));
    } else {
      var d = detail();
      if (d) page.appendChild(d);
      page.appendChild(candidateTable());
    }
    app.appendChild(top);
    app.appendChild(page);
  }

  function refresh() {
    return api('/invigilator/api/status').then(function (status) {
      state.status = status;
      if (status.released && status.signed_in) {
        return Promise.all([api('/invigilator/api/candidates'), loadEvents()]).then(function (r) {
          state.candidates = r[0].candidates || [];
          render();
        });
      }
      render();
    }).catch(function (err) {
      if (err.status === 401 && state.status) { state.status.signed_in = false; }
      state.error = err.message;
      render();
    });
  }

  refresh();
  setInterval(refresh, 5000);
})();
