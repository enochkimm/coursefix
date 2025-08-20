// src/frontend/script.js
const $ = (sel) => document.querySelector(sel);

/* --------------------
   Campus → querystring
-------------------- */
function currentCampusQuery() {
  const selected = [...document.querySelectorAll('#campusSelect option:checked')]
    .map(o => o.value.toLowerCase());
  if (selected.length === 0) return '';
  return `?campus=${encodeURIComponent(selected.join(','))}`;
}

/* -----------------------------------------
   Programs dropdown (alphabetical by program)
----------------------------------------- */
async function loadPrograms() {
  const sel = $('#programSelect');
  const countEl = $('#programCount');
  sel.innerHTML = '<option disabled selected>Loading programs…</option>';
  countEl.textContent = '';

  try {
    const campusQS = currentCampusQuery();
    const res = await fetch('/api/programs' + campusQS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Sort alphabetically by program name (case-insensitive)
    const programs = (data.programs || []).slice().sort((a, b) =>
      a.program.localeCompare(b.program, undefined, { sensitivity: 'base' })
    );

    // Build options
    sel.innerHTML = '';

    // placeholder (auto-selected)
    const placeholder = document.createElement('option');
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = 'Select Program';
    placeholder.value = '';
    sel.appendChild(placeholder);

    programs.forEach(({ program, school, id }) => {
      const opt = document.createElement('option');
      opt.value = program; // we match by name on the backend
      opt.textContent = `${program} (${school})`;
      if (id) opt.dataset.id = id;
      sel.appendChild(opt);
    });

    const totalOptions = Math.max(0, sel.querySelectorAll('option').length - 1); // exclude placeholder
    countEl.textContent = `Loaded ${totalOptions} programs`;
  } catch (err) {
    console.error('Failed to load /api/programs:', err);
    sel.innerHTML = '<option disabled selected>Failed to load programs</option>';
    countEl.textContent = '';
  }
}

/* --------------
   Render helpers
-------------- */
function chip(text) {
  const s = document.createElement('span');
  s.className = 'chip';
  s.textContent = text;
  return s;
}
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

/* -----------------------
   Submit form → /api/upload
----------------------- */
async function submitForm(e) {
  e.preventDefault();
  const file = $('#fileInput').files[0];
  if (!file) return alert('Please choose a transcript PDF.');

  const program = $('#programSelect').value;
  if (!program) return alert('Please select a program.');

  const campuses = [...document.querySelectorAll('#campusSelect option:checked')].map(o => o.value);
  const min = parseInt($('#minCredit').value, 10) || 0;
  const max = parseInt($('#maxCredit').value, 10) || 0;
  const overload = parseInt($('#overloadCredit').value, 10) || 0;

  const constraints = {
    campus: campuses,
    credit_load: { min, max, overload_max: overload }
  };

  const form = new FormData();
  form.append('transcript', file);
  form.append('program', program);
  form.append('constraints', JSON.stringify(constraints));

  // disable UI during upload
  $('#uploadForm').querySelectorAll('button, input, select').forEach(el => el.disabled = true);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: form });
    const data = await res.json();

    // re-enable
    $('#uploadForm').querySelectorAll('button, input, select').forEach(el => el.disabled = false);

    // --- Parsed
    const parsedList = $('#parsedList');
    parsedList.innerHTML = '';
    (data.parsed || []).forEach(item => parsedList.appendChild(chip(item.code)));
    $('#parsedCount').textContent = (data.parsed || []).length;

    // --- Progress
    const prog = data.progress || {};
    const summary = prog.summary || {};
    $('#progressTotals').textContent =
      `Completed ${summary.completedCredits || 0} / Required ${summary.requiredCredits || 0}`;

    renderList($('#satisfiedList'), prog.satisfied || [], (s) => {
      if (s.type === 'REQUIRE') {
        return `<b>${s.label || 'Require'}</b><div class="small">${s.course?.code || ''} — ${s.earned || 0}cr</div>`;
      }
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

    // --- Plan
    const plan = data.plan || {};
    $('#planTotals').textContent = `Picks ${plan.picks?.length || 0} • ${plan.totalCredits || 0}cr`;
    renderList($('#planPicks'), plan.picks || [], (p) => {
      const tag = p.fulfills ? `<span class="pill">${p.fulfills}</span>` : '';
      return `<b>${p.code}</b> — ${p.title || ''} • ${p.credits || 0}cr ${tag}`;
    });
    const notesEl = $('#planNotes');
    notesEl.innerHTML = '';
    (plan.notes || []).forEach(n => {
      const div = document.createElement('div');
      div.textContent = `• ${n}`;
      notesEl.appendChild(div);
    });

    // --- Validation
    const val = data.validation || {};
    setPill($('#validationOk'), !!val.ok, (val.warnings || []).length, (val.errors || []).length);
    renderList($('#errorsList'), val.errors || [], (t) => t);
    renderList($('#warningsList'), val.warnings || [], (t) => t);

    // --- Raw JSON
    $('#rawJson').textContent = JSON.stringify(data, null, 2);

    // scroll to results
    document.getElementById('results').scrollIntoView({ behavior: 'smooth' });

  } catch (err) {
    $('#uploadForm').querySelectorAll('button, input, select').forEach(el => el.disabled = false);
    alert('Upload failed. See console for details.');
    console.error(err);
  }
}

function clearForm() {
  $('#fileInput').value = '';
  $('#programSelect').selectedIndex = 0; // reset to placeholder
  $('#parsedList').innerHTML = '';
  $('#parsedCount').textContent = '0';
  $('#satisfiedList').innerHTML = '';
  $('#pendingList').innerHTML = '';
  $('#planPicks').innerHTML = '';
  $('#planNotes').innerHTML = '';
  const pill = $('#validationOk'); pill.className = 'pill'; pill.textContent = '—';
  $('#errorsList').innerHTML = '';
  $('#warningsList').innerHTML = '';
  $('#rawJson').textContent = '';
}

// wire up
document.getElementById('uploadForm').addEventListener('submit', submitForm);
document.getElementById('clearBtn').addEventListener('click', clearForm);
document.getElementById('campusSelect').addEventListener('change', loadPrograms);

// initial load
loadPrograms();