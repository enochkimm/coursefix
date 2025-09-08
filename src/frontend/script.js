const $ = (sel) => document.querySelector(sel);

// --------------------
// Campus → querystring for /api/programs
// --------------------
function currentCampusQuery() {
  const selected = [...document.querySelectorAll('#campusSelect option:checked')]
    .map(o => o.value.toLowerCase());

  // ✅ Default to NYU if nothing selected
  if (selected.length === 0) return '?campus=nyu';
  return `?campus=${encodeURIComponent(selected.join(','))}`;
}

// --------------------
// Programs dropdown (with placeholder + count)
// --------------------
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

    sel.innerHTML = '';

    // placeholder (auto-selected)
    const placeholder = document.createElement('option');
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = 'Select Program';
    placeholder.value = '';
    sel.appendChild(placeholder);

    // options (alphabetical by program_name, school appended)
    const items = (data || []).map(row => ({
      label: `${row.program_name} — ${row.school}`,
      value: row.program_name
    })).sort((a, b) => a.label.localeCompare(b.label));

    items.forEach(({ label, value }) => {
      const opt = document.createElement('option');
      opt.textContent = label;
      opt.value = value;
      sel.appendChild(opt);
    });

    const totalOptions = Math.max(0, sel.querySelectorAll('option').length - 1);
    countEl.textContent = `Loaded ${totalOptions} programs`;

  } catch (err) {
    console.error('Failed to load /api/programs:', err);
    sel.innerHTML = '<option disabled selected>Failed to load programs</option>';
    countEl.textContent = '';
  }
}

// --------------------
// Render helpers
// --------------------
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

// --------------------
// Submit form → /api/upload
// --------------------
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

  $('#uploadForm').querySelectorAll('button, input, select').forEach(el => el.disabled = true);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: form });
    const data = await res.json();

    $('#uploadForm').querySelectorAll('button, input, select').forEach(el => el.disabled = false);

    // parsed
    const parsedList = $('#parsedList');
    parsedList.innerHTML = '';
    (data.parsed || []).forEach(item => parsedList.appendChild(chip(item.code)));
    $('#parsedCount').textContent = (data.parsed || []).length;

    // progress
    const prog = data.plan?.progress || data.progress || {};
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

    // plan
    const plan = data.plan?.plan || data.plan || {};
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

    // validation
    const val = data.plan?.validation || data.validation || {};
    setPill($('#validationOk'), !!val.ok, (val.warnings || []).length, (val.errors || []).length);
    renderList($('#errorsList'), val.errors || [], (t) => t);
    renderList($('#warningsList'), val.warnings || [], (t) => t);

    // raw JSON
    $('#rawJson').textContent = JSON.stringify(data, null, 2);

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
  const pill = $('#validationOk'); pill.className='pill'; pill.textContent='—';
  $('#errorsList').innerHTML = '';
  $('#warningsList').innerHTML = '';
  $('#rawJson').textContent = '';
}

// =====================
// Prereq Checker
// =====================
function renderLogic(node) {
  if (!node) return '—';
  const isArray = Array.isArray(node);
  if (isArray) return node.map(renderLogic).join(', ');
  if (typeof node === 'string') return node;

  if (node.anyOf) return '(' + node.anyOf.map(renderLogic).join(' OR ') + ')';
  if (node.allOf) return '(' + node.allOf.map(renderLogic).join(' AND ') + ')';
  if (node.choose && node.of) return `Choose ${node.choose} of (${node.of.map(renderLogic).join(', ')})`;

  const parts = [];
  for (const k of Object.keys(node)) {
    parts.push(`${k}: ${renderLogic(node[k])}`);
  }
  return parts.join('; ');
}

async function suggestCourses(q) {
  const box = $('#courseSuggestList');
  if (!q || q.length < 3) { box.innerHTML = ''; return; }
  try {
    const res = await fetch('/api/courses/suggest?q=' + encodeURIComponent(q));
    const data = await res.json();
    box.innerHTML = '';
    (data.results || []).forEach(r => {
      const item = document.createElement('div');
      item.className = 'suggest-item';
      item.textContent = `${r.code} — ${r.title || ''}`;
      item.addEventListener('click', () => {
        $('#courseCodeInput').value = r.code;
        box.innerHTML = '';
      });
      box.appendChild(item);
    });
  } catch (e) {
    console.warn('suggest error', e);
  }
}

async function checkCourse() {
  const code = $('#courseCodeInput').value.trim();
  if (!code) return alert('Enter a course code.');
  try {
    const res = await fetch('/api/course?code=' + encodeURIComponent(code));
    const data = await res.json();
    const show = (ok=true)=>{ $('#courseResult').style.display = ok ? 'block' : 'none'; };

    if (!data.ok) {
      show(true);
      $('#cCode').textContent = 'Not Found';
      $('#cTitle').textContent = '—';
      $('#cCredits').textContent = '—';
      $('#cCampus').textContent = '—';
      $('#cDept').textContent = '—';
      $('#cUrl').innerHTML = '—';
      $('#cPrereqs').textContent = data.error || 'Not found';
      $('#cCoreqs').textContent = '—';
      $('#cRestrict').textContent = '—';
      return;
    }

    const c = data.course || {};
    show(true);
    $('#cCode').textContent = c.code || code;
    $('#cTitle').textContent = c.title || '—';
    $('#cCredits').textContent = c.credits ?? '—';
    $('#cCampus').textContent = c.campus || '—';
    $('#cDept').textContent = c.department || '—';
    $('#cUrl').innerHTML = c.url ? `<a href="${c.url}" target="_blank" rel="noopener">Open bulletin</a>` : '—';

    const req = c.requirements || {};
    $('#cPrereqs').textContent = renderLogic(req.prerequisites) || '—';
    $('#cCoreqs').textContent   = renderLogic(req.corequisites) || '—';

    const r = req.restrictions;
    if (!r) {
      $('#cRestrict').textContent = '—';
    } else if (typeof r === 'string') {
      $('#cRestrict').textContent = r;
    } else {
      $('#cRestrict').textContent = renderLogic(r);
    }
  } catch (e) {
    alert('Lookup failed. See console.');
    console.error(e);
  }
}

// =====================
// Wire up
// =====================
document.getElementById('uploadForm').addEventListener('submit', submitForm);
document.getElementById('clearBtn').addEventListener('click', clearForm);
document.getElementById('campusSelect').addEventListener('change', loadPrograms);

// Prereq checker events
document.getElementById('courseCodeInput').addEventListener('input', (e) => {
  suggestCourses(e.target.value.trim());
});
document.getElementById('checkBtn').addEventListener('click', checkCourse);

// =====================
// Initial load (NYU default)
// =====================
document.addEventListener('DOMContentLoaded', () => {
  const campusSelect = document.getElementById('campusSelect');
  if (campusSelect) {
    // ✅ Force NYU selected on load
    [...campusSelect.options].forEach(opt => {
      opt.selected = opt.value.toLowerCase() === 'nyu';
    });
  }
  loadPrograms();
});