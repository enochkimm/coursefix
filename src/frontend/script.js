// src/frontend/script.js
const $ = (sel) => document.querySelector(sel);

// ---------- Programs dropdown (filtered by campus) ----------
function currentCampusQuery() {
  const selected = [...document.querySelectorAll('#campusSelect option:checked')]
    .map(o => o.value.toLowerCase());
  if (!selected.length) return '';
  return `?campus=${encodeURIComponent(selected.join(','))}`;
}

async function loadPrograms() {
  const sel = $('#programSelect');
  const countEl = $('#programCount');
  sel.innerHTML = '<option disabled selected>Loading programs…</option>';
  countEl.textContent = '';

  try {
    const res = await fetch('/api/programs' + currentCampusQuery());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    sel.innerHTML = '';
    const ph = document.createElement('option');
    ph.disabled = true; ph.selected = true; ph.value = ''; ph.textContent = 'Select Program';
    sel.appendChild(ph);

    (data.programs || []).forEach(row => {
      const opt = document.createElement('option');
      opt.value = row.program;
      opt.textContent = `${row.program} — ${row.school}`;
      if (row.id) opt.dataset.id = row.id;
      sel.appendChild(opt);
    });

    const total = Math.max(0, sel.querySelectorAll('option').length - 1);
    countEl.textContent = total ? `Loaded ${total} programs` : 'No programs found';
  } catch (err) {
    console.error('Failed to load /api/programs:', err);
    sel.innerHTML = '<option disabled selected>Failed to load programs</option>';
    countEl.textContent = '';
  }
}

// ---------- Render helpers ----------
function chip(text){ const s=document.createElement('span'); s.className='chip'; s.textContent=text; return s; }
function renderList(el, items, renderItem) {
  el.innerHTML = '';
  (items || []).forEach(item => {
    const li = document.createElement('li');
    li.innerHTML = renderItem(item);
    el.appendChild(li);
  });
}
function setPill(el, ok, warnCount, errCount) {
  el.className = 'pill';
  if (!ok && errCount > 0) el.classList.add('err');
  else if (!ok || warnCount > 0) el.classList.add('warn');
  else el.classList.add('ok');
  el.textContent = ok ? (warnCount ? 'OK (warnings)' : 'OK') : 'Not OK';
}

// ---------- Submit form → /api/upload ----------
async function submitForm(e) {
  e.preventDefault();

  const file = $('#fileInput').files[0];
  if (!file) { alert('Please choose a transcript PDF.'); return; }

  const program = $('#programSelect').value;
  if (!program) { alert('Please select a program.'); return; }

  // optional constraints; wire campus selections if you want them enforced server-side
  const campuses = [...document.querySelectorAll('#campusSelect option:checked')].map(o => o.value);
  const constraints = { campus: campuses, credit_load: { min: 12, max: 18, overload_max: 21 } };

  const form = new FormData();
  form.append('transcript', file);
  form.append('program', program);
  form.append('constraints', JSON.stringify(constraints));

  $('#uploadForm').querySelectorAll('button, input, select').forEach(el => el.disabled = true);

  try {
    const resp = await fetch('/api/upload', { method: 'POST', body: form });
    const data = await resp.json();

    $('#uploadForm').querySelectorAll('button, input, select').forEach(el => el.disabled = false);

    if (!resp.ok || !data.ok) {
      console.error('Upload failed:', data);
      alert(data.error || 'Upload failed');
      return;
    }

    // --- Parsed
    const parsed = data.parsed || [];
    const list = $('#parsedList'); list.innerHTML = '';
    parsed.forEach(item => list.appendChild(chip(item.code)));
    $('#parsedCount').textContent = parsed.length;

    // The planning payload is under data.plan
    const out = data.plan || {};
    const prog = out.progress || {};
    const sum = prog.summary || {};

    // --- Progress render
    $('#progressTotals').textContent = `Completed ${sum.completedCredits || 0} / Required ${sum.requiredCredits || 0}`;

    renderList($('#satisfiedList'), prog.satisfied || [], (s) => {
      if (s.type === 'REQUIRE') return `<b>${s.label || 'Require'}</b><div class="small">${s.course?.code || ''} — ${s.earned || 0}cr</div>`;
      if (s.type === 'GROUP_SELECT') {
        const picks = (s.picks || []).map(p => p.code).join(', ');
        return `<b>${s.label || 'Selection'}</b><div class="small">${picks} — ${s.earned || 0}cr</div>`;
      }
      return `<b>${s.label || s.type}</b>`;
    });

    renderList($('#pendingList'), prog.pending || [], (p) => {
      const hits = (p.hits || []).map(h => h.code).join(', ');
      return `<b>${p.label || p.type}</b><div class="small">Needs ${p.needCredits || 0}cr${hits ? ` — you have: ${hits}` : ''}</div>`;
    });

    // --- Plan render
    const plan = out.plan || {};
    $('#planTotals').textContent = `Picks ${plan.picks?.length || 0} • ${plan.totalCredits || 0}cr`;
    renderList($('#planPicks'), plan.picks || [], (p) => {
      const tag = p.fulfills ? `<span class="pill">${p.fulfills}</span>` : '';
      return `<b>${p.code}</b> — ${p.title || ''} • ${p.credits || 0}cr ${tag}`;
    });
    const notesEl = $('#planNotes'); notesEl.innerHTML = '';
    (plan.notes || []).forEach(n => { const div = document.createElement('div'); div.textContent = `• ${n}`; notesEl.appendChild(div); });

    // --- Validation render
    const val = out.validation || {};
    setPill($('#validationOk'), !!val.ok, (val.warnings || []).length, (val.errors || []).length);
    renderList($('#errorsList'), val.errors || [], (t) => t);
    renderList($('#warningsList'), val.warnings || [], (t) => t);

    // --- Raw JSON
    $('#rawJson').textContent = JSON.stringify(data, null, 2);

    // scroll to results
    document.getElementById('progressTotals').scrollIntoView({ behavior: 'smooth' });

  } catch (err) {
    $('#uploadForm').querySelectorAll('button, input, select').forEach(el => el.disabled = false);
    console.error('Fetch error:', err);
    alert('Upload failed (network/JS error). See console.');
  }
}

function clearForm() {
  $('#fileInput').value = '';
  $('#programSelect').selectedIndex = 0;
  $('#parsedList').innerHTML = '';
  $('#parsedCount').textContent = '0';

  $('#progressTotals').textContent = '—';
  $('#satisfiedList').innerHTML = '';
  $('#pendingList').innerHTML = '';

  $('#planTotals').textContent = '—';
  $('#planPicks').innerHTML = '';
  $('#planNotes').innerHTML = '';

  const pill = $('#validationOk'); pill.className='pill'; pill.textContent='—';
  $('#errorsList').innerHTML = '';
  $('#warningsList').innerHTML = '';

  $('#rawJson').textContent = '{}';
}

// wire up
document.getElementById('uploadForm').addEventListener('submit', submitForm);
document.getElementById('clearBtn').addEventListener('click', clearForm);
document.getElementById('campusSelect').addEventListener('change', loadPrograms);

// initial load
loadPrograms();