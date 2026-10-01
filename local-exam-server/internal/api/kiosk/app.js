// NACOLM CBT candidate kiosk. Plain JavaScript, no build step, served from
// the exam server binary. Every piece of text from the server goes into the
// page as text (never as HTML).
'use strict';

(() => {
  const api = async (method, path, body) => {
    const res = await fetch('/kiosk/api' + path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (_) { /* empty body */ }
    if (!res.ok) {
      const err = new Error(data.error || 'Request failed (' + res.status + ')');
      err.status = res.status;
      err.locked = !!data.locked;
      throw err;
    }
    return data;
  };

  // ---- tiny DOM helper: h('div', {class: 'x', onclick: fn}, 'text', child) ----
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') Object.assign(el.style, v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'disabled') el.disabled = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function icon(d, size = 18) {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.6'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
    s.append(p);
    return s;
  }
  const I = {
    flag: 'M3.5 14V2.5M3.5 3h8l-2 3 2 3h-8',
    check: 'M3.5 8.5l3 3 6-7',
    lock: 'M4.5 7.5h7v6h-7zM6 7.5V5.5a2 2 0 014 0v2',
    wifi: 'M2 6.5a9 9 0 0112 0M4.5 9a5.5 5.5 0 017 0M7 11.5a2 2 0 012 0',
  };
  const LETTERS = 'ABCDEFGH';
  const MIN_WORDS = 15;
  const words = (t) => (t || '').trim().split(/\s+/).filter(Boolean).length;

  // ---- state ----
  const params = new URLSearchParams(location.search);
  const seat = params.get('seat') || sessionStorage.getItem('seat') || '';
  if (seat) sessionStorage.setItem('seat', seat);

  const S = {
    view: 'boot', // login | instructions | exam | review | done
    status: null, me: null, paper: null, questions: [], answers: {}, flags: {},
    cur: 0, deadline: null, offset: 0, confirming: false, result: null,
    online: true, loginError: '', agreed: false, starting: false, submitting: false,
    lastSavedAt: 0, dirty: false, autoSubmitted: false, signOutAt: 0,
    violations: 0, lastViolationAt: 0, notFullscreen: false,
    locked: false, lockReason: '', warnings: 0, lockAfter: 0, extendedScreen: false,
  };
  const qKey = () => 'nacolm-queue:' + (S.me?.candidate?.service_number || '');
  const fKey = () => 'nacolm-flags:' + (S.me?.candidate?.service_number || '');
  const loadQueue = () => { try { return JSON.parse(localStorage.getItem(qKey()) || '{}'); } catch (_) { return {}; } };
  const saveQueue = (q) => { try { localStorage.setItem(qKey(), JSON.stringify(q)); } catch (_) { /* storage full: keep in memory */ } };

  const app = document.getElementById('app');
  function render() {
    const focusId = document.activeElement && document.activeElement.id;
    const caret = document.activeElement && 'selectionStart' in document.activeElement ? document.activeElement.selectionStart : null;
    app.replaceChildren(VIEWS[S.view]());
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) { el.focus(); if (caret != null && 'setSelectionRange' in el) try { el.setSelectionRange(caret, caret); } catch (_) {} }
    }
  }

  // ---- header ----
  function header(right) {
    return h('header', { class: 'top' },
      h('img', { src: 'crest.png', alt: '' }),
      h('div', { class: 'name' }, h('b', { text: 'NACOLM CBT' }), h('span', { text: 'Examination, Nigerian Army College of Logistics and Management' })),
      h('div', { class: 'grow' }),
      right);
  }
  const who = () => {
    const c = S.me?.candidate;
    return c ? h('span', { class: 'who', text: c.rank + ' ' + c.full_name + ', ' + c.service_number }) : null;
  };

  // ---- time ----
  const now = () => Date.now() + S.offset;
  const leftSeconds = () => (S.deadline ? Math.max(0, Math.floor((S.deadline - now()) / 1000)) : 0);
  const fmt = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  function setClock(serverNow, deadline) {
    S.offset = new Date(serverNow).getTime() - Date.now();
    S.deadline = deadline ? new Date(deadline).getTime() : null;
  }

  // ---- views ----
  const VIEWS = {
    boot: () => h('p', { class: 'boot', text: 'Loading…' }),

    login() {
      let svc = sessionStorage.getItem('svc-draft') || '';
      let pin = '';
      const connected = !!S.status;
      const submit = async (e) => {
        e.preventDefault();
        const f = e.target;
        svc = f.svc.value; pin = f.pin.value;
        if (!svc.trim() || !pin.trim()) { S.loginError = 'Enter your service number and exam PIN.'; render(); return; }
        const btn = f.querySelector('button[type=submit]');
        btn.disabled = true; btn.textContent = 'Signing in…';
        try {
          await api('POST', '/login', { service_number: svc, pin, seat });
          S.loginError = '';
          sessionStorage.removeItem('svc-draft');
          await afterLogin();
        } catch (err) {
          S.loginError = err.status >= 500 || !err.status ? 'This computer can’t reach the exam server. Raise your hand for the invigilator.' : err.message;
          render();
        }
      };
      return h('div', { class: 'login' },
        h('section', { class: 'login-brand', 'aria-label': 'Nigerian Army College of Logistics and Management' },
          h('img', { src: 'crest.png', alt: 'Crest of the Nigerian Army College of Logistics and Management' }),
          h('div', {},
            h('p', { class: 'college', text: 'Nigerian Army College of Logistics and Management' }),
            h('h1', { text: 'NACOLM CBT' }),
            h('p', { class: 'sub', text: 'Computer-based examination' })),
          h('div', { class: 'where' },
            h('span', { text: 'Exam centre: ' + (S.status?.centre || '…') }),
            seat ? h('span', { text: 'Computer ' + seat }) : null)),
        h('main', { class: 'login-main' },
          h('form', { class: 'login-form', onsubmit: submit, autocomplete: 'off', novalidate: true },
            h('div', {},
              h('h2', { text: 'Candidate sign-in' }),
              h('p', { class: 'muted', text: 'Enter your service number and the exam PIN on your admission slip.' })),
            connected
              ? h('span', { class: 'pill ok' }, icon(I.wifi, 16), 'Connected to the exam centre')
              : h('span', { class: 'pill bad' }, icon(I.wifi, 16), 'Not connected to the exam server'),
            S.loginError ? h('div', { class: 'alert error', role: 'alert' }, h('div', {}, h('b', { text: 'Couldn’t sign you in' }), S.loginError)) : null,
            h('label', { class: 'field' }, 'Service number',
              h('input', { id: 'svc', name: 'svc', value: svc, placeholder: 'e.g. NA/24/0412', autocapitalize: 'characters', spellcheck: 'false',
                oninput: (e) => { e.target.value = e.target.value.toUpperCase(); sessionStorage.setItem('svc-draft', e.target.value); } })),
            h('label', { class: 'field' }, 'Exam PIN',
              h('input', { id: 'pin', name: 'pin', class: 'pin', type: 'password', inputmode: 'numeric', maxlength: '8', placeholder: '6 digits',
                oninput: (e) => { e.target.value = e.target.value.replace(/\D/g, ''); } })),
            h('button', { class: 'btn primary big', type: 'submit' }, 'Sign in'),
            h('p', { class: 'help', text: 'Having trouble? Stay seated and raise your hand. The invigilator can check your PIN.' }))));
    },

    instructions() {
      const me = S.me, p = me.paper, hold = p ? p.publish_mode !== 'immediate' : true;
      const open = !!me.released;
      const start = async () => {
        S.starting = true; render();
        try { await startExam(); } catch (err) { S.starting = false; alert(err.message); render(); }
      };
      return h('div', { class: 'screen' },
        header([netPill(), who()]),
        h('main', { class: 'page' }, h('div', { class: 'page-inner' },
          h('h1', { text: 'Before you start' }),
          h('div', { class: 'twocol' },
            h('section', { class: 'card' },
              h('h2', { text: 'Check your details' }),
              h('div', { class: 'idrow' },
                h('div', { class: 'photo', text: 'Photo' }),
                h('dl', { class: 'facts' },
                  h('div', { class: 'wide' }, h('dt', { text: 'Name' }), h('dd', { text: me.candidate.rank + ' ' + me.candidate.full_name })),
                  h('div', { class: 'wide' }, h('dt', { text: 'Service number' }), h('dd', { text: me.candidate.service_number })),
                  seat ? h('div', { class: 'wide' }, h('dt', { text: 'Computer' }), h('dd', { text: seat })) : null)),
              h('p', { class: 'muted', text: 'Not you? Don’t continue. Raise your hand for the invigilator.' }),
              h('dl', { class: 'facts' },
                h('div', { class: 'wide' }, h('dt', { text: 'Paper' }), h('dd', { text: p ? p.title : 'Waiting for the invigilator to open the paper' })),
                p ? h('div', {}, h('dt', { text: 'Time allowed' }), h('dd', { text: p.duration_minutes + ' minutes' })) : null,
                p ? h('div', {}, h('dt', { text: 'Questions' }), h('dd', { text: p.questions + ' (' + [p.objective ? p.objective + ' objective' : '', p.theory ? p.theory + ' theory' : ''].filter(Boolean).join(', ') + ')' })) : null,
                p ? h('div', { class: 'wide' }, h('dt', { text: 'Results' }), h('dd', { text: hold ? 'Released later by your instructor' : 'Shown when you submit' })) : null)),
            h('section', { class: 'card' },
              h('h2', { text: 'Instructions' }),
              h('ul', { class: 'rules' },
                h('li', { text: 'Answer every question. There is no penalty for a wrong objective answer.' }),
                h('li', { text: 'Objective questions: choose one option. You can change it until you submit. Keys A to D also choose an option.' }),
                h('li', { text: 'Theory questions: type your answer in full sentences. Answers under ' + MIN_WORDS + ' words score zero.' }),
                h('li', { text: 'Your answers save automatically as you go, even if the network drops.' }),
                h('li', { text: 'Use the question numbers on the right to move around. Flag any question you want to come back to.' }),
                h('li', { text: 'The timer starts when you press Start. When it reaches zero, your answers are submitted for you.' }),
                h('li', { text: 'Don’t close this window or try to leave it. Every action is recorded.' })),
              h('p', { class: 'integrity' },
                h('b', { text: 'This exam is monitored. ' }),
                'Leaving the exam screen, switching windows, a second display, printing, screenshots and copying are blocked or recorded, and shown to the invigilator. ' +
                (lockAfter() ? 'After ' + lockAfter() + ' warnings your exam pauses until the invigilator unlocks it, and your time keeps running.' : '')),
              h('div', { class: 'alert info' }, h('div', {},
                h('b', { text: hold ? 'Your results come later' : 'You’ll see your score when you submit' }),
                hold ? 'Your answers are marked when you submit, and your instructor releases the results.' : 'Objective answers are marked as soon as you submit, and your score appears on screen.')))),
          h('div', { class: 'card startbar' },
            h('label', {}, h('input', { type: 'checkbox', id: 'agree', checked: S.agreed, onchange: (e) => { S.agreed = e.target.checked; render(); } }), 'I have checked my details and read the instructions'),
            h('span', { class: 'muted', text: !open ? 'Waiting for the invigilator to open this paper…' : S.agreed ? 'The timer starts when you press Start.' : 'Tick the box to continue.' }),
            h('button', { class: 'btn primary', disabled: !S.agreed || !open || S.starting, onclick: start }, S.starting ? 'Starting…' : 'Start exam')))));
    },

    exam() {
      const q = S.questions[S.cur], total = S.questions.length;
      const answered = S.questions.filter(isAnswered).length;
      const ans = S.answers[q.position] || {};
      const flagged = !!S.flags[q.position];
      const main = h('main', { class: 'qmain' },
        h('div', { class: 'qhead' },
          h('span', { class: 'n', text: 'Question ' + (S.cur + 1) + ' of ' + total }),
          h('span', { class: 'tag', text: q.type === 'mcq' ? 'Objective' : 'Theory' }),
          h('div', { style: { flex: '1' } }),
          h('button', { class: 'btn flag' + (flagged ? ' on' : ''), 'aria-pressed': String(flagged), onclick: () => { toggleFlag(q.position); } },
            icon(I.flag), flagged ? 'Flagged' : 'Flag for review')),
        h('p', { class: 'qbody', id: 'qbody', text: q.stem }),
        q.type === 'mcq'
          ? h('div', { class: 'options', role: 'radiogroup', 'aria-labelledby': 'qbody' },
            q.options.map((o, i) => h('button', { class: 'opt', role: 'radio', id: 'opt' + i, 'aria-checked': String(ans.selected_index === i), onclick: () => choose(q.position, i) },
              h('span', { class: 'l', text: LETTERS[i] }), h('span', { text: o }))))
          : theoryBox(q, ans),
        h('div', { class: 'qnav' },
          h('button', { class: 'btn big', disabled: S.cur === 0, onclick: () => go(S.cur - 1) }, 'Previous'),
          h('div', { class: 'grow' }),
          S.cur < total - 1
            ? h('button', { class: 'btn primary big', onclick: () => go(S.cur + 1) }, 'Next question')
            : h('button', { class: 'btn primary big', onclick: () => { S.view = 'review'; render(); } }, 'Review answers')));
      const side = h('aside', { class: 'side', 'aria-label': 'Questions' },
        h('div', {},
          h('b', { text: answered + ' of ' + total + ' answered' }),
          h('div', { class: 'bar', style: { marginTop: '6px' } }, h('span', { style: { width: Math.round((answered / total) * 100) + '%' } }))),
        h('div', { class: 'grid' }, S.questions.map((qq, i) => {
          const done = isAnswered(qq), f = !!S.flags[qq.position];
          return h('button', { class: 'navq' + (done ? ' ans' : ''), 'aria-current': String(i === S.cur), onclick: () => go(i),
            'aria-label': 'Question ' + (i + 1) + (done ? ', answered' : ', not answered') + (f ? ', flagged' : '') },
          String(i + 1), f ? h('span', { class: 'f' }, icon(I.flag, 10)) : null);
        })),
        h('ul', { class: 'legend' },
          h('li', {}, h('span', { class: 'sw ans' }), 'Answered'),
          h('li', {}, h('span', { class: 'sw todo' }), 'Not answered'),
          h('li', {}, h('span', { class: 'sw flag' }, icon(I.flag, 12)), 'Flagged to come back to')),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn', onclick: () => { S.view = 'review'; render(); } }, 'Review and submit'));
      return h('div', { class: 'screen' }, examHeader(), banners(), h('div', { class: 'exam' }, main, side), S.confirming ? confirmDialog() : null, guards());
    },

    review() {
      const unanswered = S.questions.filter((q) => !isAnswered(q));
      const flagged = S.questions.filter((q) => S.flags[q.position]);
      return h('div', { class: 'screen' }, examHeader(), banners(),
        h('main', { class: 'page' }, h('div', { class: 'page-inner' },
          h('h1', { text: 'Review your answers' }),
          h('div', { class: 'counts' },
            h('div', { class: 'count' }, h('b', { text: String(S.questions.length - unanswered.length) }), 'answered'),
            h('div', { class: 'count ' + (unanswered.length ? 'warn' : 'good') }, h('b', { text: String(unanswered.length) }), 'not answered'),
            h('div', { class: 'count ' + (flagged.length ? 'warn' : 'good') }, h('b', { text: String(flagged.length) }), 'flagged')),
          h('section', { class: 'rlist' }, S.questions.map((q, i) => {
            const a = isAnswered(q), f = !!S.flags[q.position];
            return h('div', { class: 'rrow' },
              h('span', { class: 'q', text: 'Q' + (i + 1) }),
              h('span', { class: 't', text: q.stem }),
              h('span', { class: 'chip ' + (!a || f ? 'warn' : 'ok'), text: !a ? 'Not answered' : f ? 'Answered, flagged' : 'Answered' }),
              h('button', { class: 'btn', onclick: () => go(i) }, 'Go to question'));
          })),
          h('div', { class: 'card submitbar' },
            h('button', { class: 'btn', onclick: () => { S.view = 'exam'; render(); } }, 'Back to questions'),
            h('span', { class: 'note', text: unanswered.length ? unanswered.length + ' question' + (unanswered.length === 1 ? ' is' : 's are') + ' not answered.' : 'Every question is answered.' }),
            h('button', { class: 'btn primary', onclick: () => { S.confirming = true; render(); } }, icon(I.lock), 'Submit answers')))),
        S.confirming ? confirmDialog() : null, guards());
    },

    done() {
      const r = S.result || {};
      const at = r.submitted_at ? new Date(r.submitted_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
      const immediate = r.publish_mode === 'immediate';
      const secs = Math.max(0, Math.ceil((S.signOutAt - Date.now()) / 1000));
      let score = null;
      if (immediate && r.objective_total) {
        const pct = Math.round((r.objective_correct / r.objective_total) * 100);
        score = h('div', { class: 'score' },
          h('span', { class: 'muted', text: 'Objective score' }),
          h('span', { class: 'big', text: pct + '%' }),
          h('span', { text: r.objective_correct + ' of ' + r.objective_total + ' objective questions correct' }),
          r.theory ? h('span', { class: 'muted', text: 'Your ' + r.theory + ' theory answer' + (r.theory === 1 ? ' is' : 's are') + ' marked separately and added when your full result is released.' }) : null);
      } else {
        score = h('div', { class: 'score', text: 'Your answers have been received. Your instructor will release the results; you’ll see them then.' });
      }
      return h('div', { class: 'screen' },
        header([who()]),
        h('main', { class: 'finished' }, h('div', { class: 'card' },
          h('span', { class: 'tick' }, icon(I.check, 32)),
          h('h1', { text: S.autoSubmitted ? 'Time is up. Answers submitted' : 'Answers submitted' }),
          h('p', { class: 'muted', text: (at ? 'Submitted at ' + at + '. ' : '') + (r.reference ? 'Reference ' + r.reference + '.' : '') }),
          score,
          h('p', { class: 'stay', text: 'Stay seated until the invigilator tells you to leave.' }),
          h('span', { class: 'muted', id: 'signout-note', text: 'This computer signs you out in ' + secs + ' seconds.' }))));
    },
  };

  function netPill() {
    return h('span', { class: 'net' + (S.online ? '' : ' off') }, icon(I.wifi, 16), S.online ? 'Connected' : 'Offline, saving on this computer');
  }
  function examHeader() {
    const left = leftSeconds(), low = left <= 600, crit = left <= 120;
    const pending = Object.keys(loadQueue()).length;
    return header([
      netPill(),
      h('span', { class: 'saved', id: 'saved', text: pending ? (S.online ? 'Saving…' : pending + ' answer' + (pending === 1 ? '' : 's') + ' waiting to send') : 'All answers saved' }),
      who(),
      h('div', { class: 'timer' + (crit ? ' crit' : low ? ' low' : ''), role: 'timer', 'aria-label': 'Time left', id: 'timer' },
        h('small', { text: 'Time left' }), h('span', { id: 'timer-v', text: fmt(left) })),
    ]);
  }
  function banners() {
    const left = leftSeconds();
    return [
      left <= 120 ? h('div', { class: 'banner crit', role: 'alert', text: 'Less than 2 minutes left. Your answers will be submitted automatically at 00:00.' })
        : left <= 600 ? h('div', { class: 'banner low', role: 'alert', text: 'Less than 10 minutes left. Check any flagged or unanswered questions.' }) : null,
      !S.online ? h('div', { class: 'banner off', role: 'status', text: 'The connection to the exam server dropped. Keep going: your answers are saved on this computer and will send when it’s back.' }) : null,
      S.notFullscreen
        ? h('div', { class: 'banner watch', role: 'alert' },
          h('span', { text: 'You’ve left full-screen mode. This is recorded and visible to the invigilator.' }),
          h('button', { class: 'btn', onclick: enterFullscreen }, 'Return to full screen'))
        : null,
      S.extendedScreen
        ? h('div', { class: 'banner watch', role: 'alert', text: 'A second display is connected to this computer. Disconnect it and raise your hand. This is recorded.' })
        : null,
      S.violations > 0 && Date.now() - S.lastViolationAt < 6000
        ? h('div', { class: 'banner watch', role: 'alert', text: 'That was recorded and shown to the invigilator' + (lockAfter() ? ' (warning ' + S.warnings + ' of ' + lockAfter() + ').' : '.') })
        : null,
    ];
  }
  const lockAfter = () => S.lockAfter || S.status?.lock_after || 0;

  // Faint repeated name and service number across the exam: a photo of the
  // screen shows whose it was. An SVG data URL, which the kiosk CSP allows.
  let wmCache = { key: '', url: '' };
  function watermark() {
    const c = S.me?.candidate;
    if (!c) return null;
    const label = (c.service_number + '  ' + c.rank + ' ' + c.full_name + (seat ? '  ' + seat : '')).replace(/[<>&"']/g, '');
    if (wmCache.key !== label) {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="460" height="220"><text x="20" y="130" transform="rotate(-24 230 110)" font-family="Arial" font-size="20" font-weight="700" fill="#1a2015">' + label + '</text></svg>';
      wmCache = { key: label, url: 'url("data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '")' };
    }
    return h('div', { class: 'wm', 'aria-hidden': 'true', style: { backgroundImage: wmCache.url } });
  }
  function guards() {
    return [watermark(), S.locked ? pausedOverlay() : null];
  }
  function pausedOverlay() {
    return h('div', { class: 'paused', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'paused-t' },
      h('div', { class: 'dialog' },
        h('h2', { id: 'paused-t', text: 'Your exam is paused' }),
        h('p', { text: 'This computer recorded ' + (S.lockReason || 'several integrity warnings') + ', such as leaving the exam screen. Stay seated and raise your hand: the invigilator will check and unlock it.' }),
        h('p', { class: 'muted', text: 'Your answers so far are saved. Your time is still running.' }),
        h('div', { class: 'timer', role: 'timer', 'aria-label': 'Time left' }, h('small', { text: 'Time left' }), h('span', { id: 'timer-p', text: fmt(leftSeconds()) }))));
  }
  function applyIntegrity(v) {
    if (!v) return;
    const was = S.locked;
    S.locked = !!v.locked;
    S.lockReason = v.lock_reason || '';
    if (typeof v.warnings === 'number') S.warnings = v.warnings;
    if (typeof v.lock_after === 'number') S.lockAfter = v.lock_after;
    if (was !== S.locked) {
      render();
      if (!S.locked) flush();
    }
  }
  function enterFullscreen() {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  }
  function theoryBox(q, ans) {
    const text = ans.answer_text || '';
    const n = words(text);
    return h('div', {},
      h('label', { class: 'theory' }, 'Your answer',
        h('textarea', { id: 'answer-' + q.position, rows: '11', value: text, placeholder: 'Type your answer in full sentences.', spellcheck: 'false',
          autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off',
          oninput: (e) => { checkBulkInsert(e, q.position); typeAnswer(q.position, e.target.value); const c = document.getElementById('wc'); if (c) { const k = words(e.target.value); c.textContent = wordLabel(k); c.className = k < MIN_WORDS ? 'few' : 'enough'; } } })),
      h('div', { class: 'wordrow' },
        h('span', { id: 'wc', class: n < MIN_WORDS ? 'few' : 'enough', text: wordLabel(n) }),
        h('span', { class: 'note', text: 'Saved on this computer as you type' })));
  }
  // Typing adds a few characters per input event. A large block arriving at
  // once (an auto-typing tool, a browser extension, dictation software) is
  // recorded; ordinary paste is already blocked.
  function checkBulkInsert(e, pos) {
    const before = (S.answers[pos]?.answer_text || '').length;
    const added = e.target.value.length - before;
    if (added > 80 && e.inputType !== 'insertCompositionText') reportViolation('bulk_insert');
  }
  const wordLabel = (n) => n + ' word' + (n === 1 ? '' : 's') + (n < MIN_WORDS ? ' (' + MIN_WORDS + ' needed for any marks)' : '');
  function confirmDialog() {
    const un = S.questions.filter((q) => !isAnswered(q)).length;
    const fl = S.questions.filter((q) => S.flags[q.position]).length;
    const gaps = [un ? un + ' not answered' : '', fl ? fl + ' flagged' : ''].filter(Boolean).join(', ');
    return h('div', { class: 'scrim' },
      h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'sub-t' },
        h('h2', { id: 'sub-t', text: 'Submit your answers?' }),
        h('p', { text: 'You can’t change any answer after you submit.' }),
        gaps ? h('div', { class: 'alert caution' }, h('div', {}, h('b', { text: gaps }), 'You still have ' + fmt(leftSeconds()) + ' left to go back to them.')) : null,
        h('div', { class: 'actions' },
          h('button', { class: 'btn', id: 'cancel-submit', onclick: () => { S.confirming = false; render(); } }, 'Go back'),
          h('button', { class: 'btn primary', disabled: S.submitting, onclick: () => submit(false) }, S.submitting ? 'Submitting…' : 'Yes, submit'))));
  }

  // ---- answers ----
  function isAnswered(q) {
    const a = S.answers[q.position];
    if (!a) return false;
    return q.type === 'mcq' ? a.selected_index != null : words(a.answer_text) > 0;
  }
  function go(i) { S.cur = Math.max(0, Math.min(S.questions.length - 1, i)); S.view = 'exam'; S.confirming = false; render(); document.querySelector('.qmain')?.scrollTo(0, 0); }
  function toggleFlag(pos) { S.flags[pos] = !S.flags[pos]; try { sessionStorage.setItem(fKey(), JSON.stringify(S.flags)); } catch (_) {} render(); }
  function queue(pos, payload) { const q = loadQueue(); q[pos] = payload; saveQueue(q); }
  function choose(pos, i) {
    S.answers[pos] = { selected_index: i };
    queue(pos, { position: pos, selected_index: i });
    render();
    flush();
  }
  let typingTimer = null;
  function typeAnswer(pos, text) {
    S.answers[pos] = { answer_text: text };
    queue(pos, { position: pos, answer_text: text });
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { flush(); refreshHeader(); }, 800);
    refreshHeader();
  }
  function refreshHeader() {
    // Update the header and question grid without re-rendering the textarea.
    const top = document.querySelector('.top');
    if (top && (S.view === 'exam' || S.view === 'review')) top.replaceWith(examHeader());
    const grid = document.querySelector('.grid');
    if (grid && S.view === 'exam') {
      const q = S.questions[S.cur];
      const btn = grid.children[S.cur];
      if (btn) btn.classList.toggle('ans', isAnswered(q));
    }
  }

  let flushing = false;
  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      for (;;) {
        const q = loadQueue();
        const keys = Object.keys(q);
        if (!keys.length) break;
        const item = q[keys[0]];
        try {
          await api('PUT', '/answer', item);
          const cur = loadQueue();
          if (JSON.stringify(cur[keys[0]]) === JSON.stringify(item)) { delete cur[keys[0]]; saveQueue(cur); }
          if (!S.online) { S.online = true; render(); }
        } catch (err) {
          if (!err.status) { if (S.online) { S.online = false; render(); } break; }
          if (err.status === 401) { S.online = true; toLogin(err.message); break; }
          // Paused (or not yet open): keep the answer queued and send it once unlocked.
          if (err.status === 423) { if (err.locked) applyIntegrity({ locked: true, lock_reason: S.lockReason }); break; }
          // A server-side failure is temporary: keep the answer and retry on the next flush.
          if (err.status >= 500 || err.status === 429) break;
          // Server refused it (submitted, time up): drop it rather than retry forever.
          const cur = loadQueue(); delete cur[keys[0]]; saveQueue(cur);
        }
      }
    } finally {
      flushing = false;
      refreshHeader();
    }
  }

  // ---- flow ----
  async function afterLogin() {
    S.me = await api('GET', '/me');
    if (S.me.integrity) { S.lockAfter = S.me.integrity.lock_after; S.warnings = S.me.integrity.warnings; }
    try { S.flags = JSON.parse(sessionStorage.getItem(fKey()) || '{}'); } catch (_) { S.flags = {}; }
    if (S.me.session?.submitted_at) {
      S.result = await api('POST', '/submit');
      finish(false);
      return;
    }
    if (S.me.session?.started) { await startExam(); return; }
    S.view = 'instructions';
    render();
  }

  async function startExam() {
    const d = await api('POST', '/start');
    S.paper = d.paper;
    S.questions = d.questions;
    S.answers = {};
    for (const a of d.answers || []) S.answers[a.position] = { selected_index: a.selected_index, answer_text: a.answer_text };
    // Answers typed while offline (kept on this computer) win over the server copy.
    for (const item of Object.values(loadQueue())) S.answers[item.position] = { selected_index: item.selected_index, answer_text: item.answer_text };
    setClock(d.server_now, d.session.deadline);
    if (d.session.submitted_at) { S.result = await api('POST', '/submit'); finish(false); return; }
    S.view = 'exam';
    S.starting = false;
    applyIntegrity(d.integrity);
    enterFullscreen(); // best-effort: needs the user gesture from the Start button click, which this is
    render();
    checkScreens();
    flush();
  }

  // Chromium-based browsers say whether the desktop spans more than one
  // display; elsewhere this is unknown and stays quiet.
  function checkScreens() {
    const extended = window.screen && window.screen.isExtended === true;
    if (extended && !S.extendedScreen && inExam()) reportViolation('multi_screen');
    if (extended !== S.extendedScreen) { S.extendedScreen = extended; if (inExam()) render(); }
  }
  if (window.screen && window.screen.addEventListener) window.screen.addEventListener('change', checkScreens);

  async function submit(auto) {
    if (S.submitting) return;
    S.submitting = true;
    if (!auto) render();
    await flush();
    try {
      S.result = await api('POST', '/submit');
      S.autoSubmitted = auto;
      finish(true);
    } catch (err) {
      S.submitting = false;
      if (!err.status) { S.online = false; S.confirming = false; render(); setTimeout(() => submit(auto), 4000); return; }
      alert(err.message);
      render();
    }
  }

  function finish() {
    S.view = 'done';
    S.confirming = false;
    S.submitting = false;
    try { localStorage.removeItem(qKey()); sessionStorage.removeItem(fKey()); } catch (_) {}
    S.signOutAt = Date.now() + 60000;
    render();
  }

  async function toLogin(message) {
    try { await api('POST', '/logout'); } catch (_) {}
    Object.assign(S, { view: 'login', me: null, paper: null, questions: [], answers: {}, flags: {}, cur: 0, deadline: null, confirming: false, result: null, agreed: false, autoSubmitted: false,
      loginError: typeof message === 'string' && /another computer/.test(message) ? message : '', locked: false, lockReason: '', warnings: 0, extendedScreen: false });
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    render();
  }

  // ---- ticking ----
  setInterval(() => {
    if (S.view === 'exam' || S.view === 'review') {
      const left = leftSeconds();
      const v = document.getElementById('timer-v');
      const wasLow = document.querySelector('.timer.low, .timer.crit');
      if (v) v.textContent = fmt(left);
      const p = document.getElementById('timer-p');
      if (p) p.textContent = fmt(left);
      if ((left === 600 || left === 120) || (left <= 600 && !wasLow)) render();
      if (S.deadline && left === 0 && !S.submitting) submit(true);
    } else if (S.view === 'done') {
      const secs = Math.max(0, Math.ceil((S.signOutAt - Date.now()) / 1000));
      const n = document.getElementById('signout-note');
      if (n) n.textContent = 'This computer signs you out in ' + secs + ' seconds.';
      if (secs === 0) toLogin();
    }
  }, 1000);
  setInterval(() => { if (S.view === 'exam' || S.view === 'review') flush(); }, 5000);

  // Heartbeat: keeps this computer shown as online to the invigilator and
  // picks up what the server decided since (a pause, an unlock, extra time).
  // Every 10s normally, every 3s while paused so an unlock shows quickly.
  let lastBeat = 0;
  setInterval(async () => {
    if (!inExam() || Date.now() - lastBeat < (S.locked ? 3000 : 10000)) return;
    lastBeat = Date.now();
    checkScreens();
    try {
      const hb = await api('POST', '/heartbeat', { fullscreen: !!document.fullscreenElement, focused: document.hasFocus(), screens_extended: S.extendedScreen });
      if (hb.deadline) {
        const before = S.deadline;
        setClock(hb.server_now, hb.deadline);
        if (before && S.deadline !== before) render();
      }
      applyIntegrity(hb.integrity);
    } catch (err) {
      if (err.status === 401) toLogin(err.message);
    }
  }, 1000);
  // The instructions screen waits for the invigilator to open the paper.
  setInterval(async () => {
    if (S.view !== 'instructions' || S.me?.released) return;
    try { S.me = await api('GET', '/me'); render(); } catch (_) {}
  }, 3000);
  window.addEventListener('online', () => flush());

  // ---- kiosk guards ----
  // A web page can never truly stop someone switching tabs, alt-tabbing, or
  // closing the window the way a native lockdown browser can — there's no
  // API for it. What it can do: make leaving inconvenient (fullscreen,
  // beforeunload's native "are you sure?"), block the easy paths for
  // copying content out (context menu, clipboard events), and — the part
  // that actually matters for integrity — detect and record every one of
  // these so the invigilator, physically in the room, sees it happen.
  function inExam() { return S.view === 'exam' || S.view === 'review'; }
  const QUIET = { blocked_shortcut: true, paste_attempt: true }; // blocked anyway: logged without a banner
  const lastReport = {};
  function reportViolation(kind, detail) {
    if (!inExam()) return;
    if (Date.now() - (lastReport[kind] || 0) < 2000) return;
    lastReport[kind] = Date.now();
    // Best-effort: never blocks the candidate. The server decides about pausing.
    api('POST', '/violation', { kind, detail }).then((r) => applyIntegrity(r.integrity), () => {});
    if (QUIET[kind]) return;
    S.violations++;
    S.lastViolationAt = Date.now();
    render();
    setTimeout(() => { if (Date.now() - S.lastViolationAt >= 6000) render(); }, 6100);
  }

  // Shortcuts for copying, printing, saving, searching, reloading, viewing
  // source and developer tools. Browsers reserve some (new tab or window,
  // Alt+Tab, the Windows key) and give a page no way to stop them; leaving
  // the window that way is caught by the blur and visibility checks below,
  // and Safe Exam Browser or kiosk mode removes them entirely.
  const BLOCKED = { c: 'copy', x: 'cut', v: 'paste', a: 'select all', p: 'print', s: 'save', u: 'view source', f: 'find', g: 'find', h: 'history', j: 'downloads', o: 'open', r: 'reload', d: 'bookmark', l: 'address bar', e: 'search', k: 'search', i: 'devtools' };
  document.addEventListener('keydown', (e) => {
    if (!inExam()) return;
    const k = (e.key || '').toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const label = (e.ctrlKey ? 'Ctrl+' : '') + (e.metaKey ? 'Cmd+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + (k.length === 1 ? k.toUpperCase() : e.key);
    const inText = e.target && e.target.tagName === 'TEXTAREA';
    let block = false;
    if (e.key === 'F12' || e.key === 'F5' || e.key === 'F11' || e.key === 'F3' || e.key === 'F7') block = true;
    else if (mod && e.shiftKey && 'ijck'.includes(k)) block = true; // developer tools
    else if (mod && BLOCKED[k] && !(inText && (k === 'a' || k === 'z' || k === 'y'))) block = true;
    else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home')) block = true; // back / forward / home page
    if (!block) return;
    e.preventDefault();
    e.stopPropagation();
    if (mod && k === 'p') reportViolation('print_attempt');
    else reportViolation('blocked_shortcut', label.slice(0, 40));
  }, true);
  // Print Screen fires no keydown on Windows; keyup is the only signal. The
  // screenshot itself can't be stopped by a page, so it is recorded and the
  // clipboard is overwritten where the browser allows it.
  document.addEventListener('keyup', (e) => {
    if (!inExam() || e.key !== 'PrintScreen') return;
    reportViolation('screenshot_key');
    try { navigator.clipboard?.writeText(' ').catch(() => {}); } catch (_) {}
  }, true);
  window.addEventListener('beforeprint', () => reportViolation('print_attempt'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) reportViolation('tab_hidden'); });
  window.addEventListener('blur', () => { if (!document.hidden) reportViolation('window_blur'); });
  document.addEventListener('fullscreenchange', () => {
    const fs = !!document.fullscreenElement;
    if (inExam() && !fs && !S.notFullscreen) { S.notFullscreen = true; reportViolation('fullscreen_exit'); }
    else if (fs && S.notFullscreen) { S.notFullscreen = false; render(); }
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  for (const ev of ['copy', 'cut', 'drop', 'dragstart', 'selectstart']) {
    document.addEventListener(ev, (e) => {
      if (!inExam()) return;
      if (ev === 'selectstart' && e.target && e.target.closest && e.target.closest('textarea')) return; // selecting their own answer is fine
      e.preventDefault();
    });
  }
  document.addEventListener('paste', (e) => { if (inExam()) { e.preventDefault(); reportViolation('paste_attempt'); } });
  // Catches text inserted by other means than the paste event (drag-in,
  // middle-click on Linux, some input tools).
  document.addEventListener('beforeinput', (e) => {
    if (!inExam()) return;
    if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop' || e.inputType === 'insertFromYank' || e.inputType === 'insertFromPasteAsQuotation') {
      e.preventDefault();
      reportViolation('paste_attempt');
    }
  }, true);
  window.addEventListener('beforeunload', (e) => { if (inExam()) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('keydown', (e) => {
    if (S.view !== 'exam' || S.confirming) {
      if (e.key === 'Escape' && S.confirming) { S.confirming = false; render(); }
      return;
    }
    const inText = e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT');
    if (inText) return;
    const q = S.questions[S.cur];
    const k = e.key.toUpperCase();
    if (q.type === 'mcq' && LETTERS.slice(0, q.options.length).includes(k) && !e.ctrlKey && !e.altKey && !e.metaKey) { choose(q.position, LETTERS.indexOf(k)); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { go(S.cur + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { go(S.cur - 1); e.preventDefault(); }
  });

  // ---- boot ----
  (async () => {
    try { S.status = await api('GET', '/status'); } catch (_) { S.status = null; }
    try { await afterLogin(); } catch (_) { S.view = 'login'; render(); }
  })();
  setInterval(async () => {
    if (S.view !== 'login') return;
    const was = !!S.status;
    try { S.status = await api('GET', '/status'); } catch (_) { S.status = null; }
    if (was !== !!S.status) render();
  }, 10000);
})();
