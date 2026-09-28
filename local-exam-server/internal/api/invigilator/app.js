(function () {
  var app = document.getElementById('app');
  var STATUS_LABEL = { not_checked_in: 'Not checked in', checked_in: 'Checked in', started: 'Started', submitted: 'Submitted' };
  var state = { status: null, candidates: [], error: '', releasing: false, filter: '' };

  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    for (var k in attrs) {
      if (k === 'text') el.textContent = attrs[k];
      else if (k === 'html') el.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child) el.appendChild(child);
    }
    return el;
  }

  function api(path, opts) {
    return fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts)).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) throw new Error(body.error || 'request failed');
        return body;
      });
    });
  }

  function releaseForm() {
    var input = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'e.g. 3f9a1c…' });
    var btn = h('button', { class: 'btn primary', text: state.releasing ? 'Opening…' : 'Open exam' });
    if (state.releasing) btn.setAttribute('disabled', 'true');
    var form = h('form', { onsubmit: function (e) {
      e.preventDefault();
      var key = input.value.trim();
      if (!key) return;
      state.releasing = true;
      state.error = '';
      render();
      api('/invigilator/api/release', { method: 'POST', body: JSON.stringify({ key_hex: key }) })
        .then(function () { state.releasing = false; return refresh(); })
        .catch(function (err) { state.releasing = false; state.error = err.message; render(); });
    } },
      h('div', { class: 'field' }, h('span', { text: 'Release key (hex)' }), input),
      btn
    );
    return h('div', { class: 'card' },
      h('h2', { text: 'Open this exam' }),
      h('p', { class: 'muted', text: 'Paste the release key handed to you by the exam officer, then press Open exam. Candidates cannot check in until this is done.' }),
      state.error ? h('div', { class: 'alert error', text: state.error }) : null,
      form
    );
  }

  function summary() {
    var counts = { not_checked_in: 0, checked_in: 0, started: 0, submitted: 0 };
    var flagged = 0;
    state.candidates.forEach(function (c) { counts[c.status] = (counts[c.status] || 0) + 1; if (c.violations > 0) flagged++; });
    var stat = function (label, n) { return h('div', { class: 'stat' }, h('b', { text: String(n) }), h('span', { text: label })); };
    return h('div', { class: 'summary' },
      stat('On roster', state.candidates.length),
      stat('Checked in', counts.checked_in + counts.started + counts.submitted),
      stat('In progress', counts.started),
      stat('Submitted', counts.submitted),
      stat('Flagged', flagged)
    );
  }

  function candidateTable() {
    var filter = state.filter.trim().toLowerCase();
    var rows = state.candidates.filter(function (c) {
      if (!filter) return true;
      return (c.service_number + ' ' + c.full_name).toLowerCase().indexOf(filter) !== -1;
    });
    var table = h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { text: 'Service number' }), h('th', { text: 'Rank' }), h('th', { text: 'Name' }),
        h('th', { text: 'Status' }), h('th', { text: 'Reference' }), h('th', { text: 'Flags' })
      )),
      h('tbody', {}, ...rows.map(function (c) {
        return h('tr', { class: c.violations > 0 ? 'flagged' : '' },
          h('td', { text: c.service_number }),
          h('td', { text: c.rank }),
          h('td', { text: c.full_name }),
          h('td', { class: 'status' }, h('span', { class: 'badge ' + c.status, text: STATUS_LABEL[c.status] || c.status })),
          h('td', { text: c.reference || '—' }),
          h('td', {}, c.violations > 0 ? h('span', { class: 'flag-count', title: 'Left the exam screen or fullscreen ' + c.violations + ' time(s)' }, String(c.violations)) : h('span', { class: 'muted-cell', text: '—' }))
        );
      }))
    );
    var search = h('input', { class: 'search', type: 'text', placeholder: 'Search by service number or name…', value: state.filter, oninput: function (e) { state.filter = e.target.value; render(); } });
    return h('div', { class: 'card' },
      h('h2', { text: state.status.title || 'Exam roster' }),
      h('p', { class: 'muted', text: (state.status.duration_minutes || '?') + ' minutes · ' + (state.status.questions_per_candidate || '?') + ' questions per candidate · results ' + (state.status.publish_mode === 'immediate' ? 'shown at submit' : 'held for review') }),
      summary(),
      search,
      table
    );
  }

  function render() {
    app.innerHTML = '';
    if (!state.status) { app.appendChild(h('div', { class: 'boot', text: 'Loading…' })); return; }
    var released = state.status.released;
    var pill = h('span', { class: 'pill ' + (released ? 'ok' : 'bad'), text: released ? 'Released' : 'Not released' });
    var top = h('div', { class: 'top' },
      h('b', { text: 'Invigilator console' }),
      h('span', { class: 'sub', text: state.status.centre + ' · ' + state.status.exam_id }),
      h('span', { class: 'grow' }),
      pill
    );
    var page = h('div', { class: 'page' });
    if (!state.status.roster_loaded) {
      page.appendChild(h('div', { class: 'card' }, h('div', { class: 'alert error', text: 'No candidate roster is loaded on this exam server (CBT_ROSTER_PATH). Candidates will not be able to check in even after release.' })));
    }
    page.appendChild(released ? candidateTable() : releaseForm());
    app.appendChild(top);
    app.appendChild(page);
  }

  function refresh() {
    return api('/invigilator/api/status').then(function (status) {
      state.status = status;
      if (status.released) {
        return api('/invigilator/api/candidates').then(function (body) {
          state.candidates = body.candidates || [];
          render();
        });
      }
      render();
    }).catch(function (err) {
      state.error = err.message;
      render();
    });
  }

  refresh();
  setInterval(refresh, 5000);
})();
