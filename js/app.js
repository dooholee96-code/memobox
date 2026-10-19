import * as db from './db.js';
import {
  PARA_LABEL, KIND_ICON, uid, normalize, derive, paraOf, searchMemos, backlinks, relatedMemos, tagCounts,
  dday, daysLeft, sharedToMemo, renderMarkdown, escapeHtml, toggleTask, memoToMarkdown, uniqueNames,
  makeZip, markdownToMemo, mergeById, memoTitle, parseCapture, parseTags, isSearchLike, memoKind,
  previewText, pickResurface, dayLabel, entryOf,
} from './core.js';
import { createPalace, assignRooms, placeNew } from './palace.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = escapeHtml;
const DAY = 86400000;
const TRASH_DAYS = 30;
const PAGE = 120;
const isTouch = matchMedia('(pointer: coarse)').matches;

const state = {
  memos: [],
  colls: {},
  input: '',
  filter: { type: 'all' },
  expanded: null,
  fresh: null,
  editing: null,
  limit: PAGE,
  lastBackup: 0,
  persisted: false,
  resurfaceSkip: 0,
  palaceOn: readPref('palaceOn') === '1',
  roomCells: {},
};

function readPref(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 저장 안 돼도 됨 */ }
}

// ── 메모 파생값 ──

const cache = new Map();
function dOf(memo) {
  const c = cache.get(memo.id);
  if (c && c.body === memo.body && c.url === memo.sourceUrl) return c.d;
  const d = derive(memo);
  cache.set(memo.id, { body: memo.body, url: memo.sourceUrl, d });
  return d;
}
const liveItems = () => state.memos.filter((m) => !m.deletedAt).map((memo) => ({ memo, d: dOf(memo) }));
const findMemo = (id) => state.memos.find((m) => m.id === id);
const activeColls = () => Object.values(state.colls).filter((c) => !c.archived);

function titleMap() {
  const map = new Map();
  for (const it of liveItems().sort((a, b) => a.memo.updatedAt - b.memo.updatedAt)) map.set(it.d.key, it.memo);
  return map;
}

// ── 저장 ──

async function saveMemo(m, touch = true) {
  if (touch) m.updatedAt = Date.now();
  await db.put('memos', m);
}

async function createMemo(fields = {}) {
  const now = Date.now();
  const m = {
    id: uid(), body: '', para: 'inbox', collectionId: null, pinned: false, archived: false,
    sourceUrl: '', createdAt: now, updatedAt: now, deletedAt: null, useCount: 0, usedAt: 0, ...fields,
  };
  state.memos.unshift(m);
  await saveMemo(m, false);
  if (!state.persisted && navigator.storage?.persist) state.persisted = await navigator.storage.persist().catch(() => false);
  return m;
}

// 지금 보고 있는 모아보기에 맞춘 기본 위치
function filterFields() {
  const f = state.filter;
  if (f.type === 'coll' && state.colls[f.id] && !state.colls[f.id].archived) return { collectionId: f.id };
  if (f.type === 'resource') return { para: 'resource' };
  if (f.type === 'pinned') return { pinned: true };
  return {};
}

function placeName(memo) {
  const c = memo.collectionId && state.colls[memo.collectionId];
  if (c) return `${c.kind === 'project' ? '🎯' : '🌱'} ${c.name}`;
  return { inbox: '📥 받은함', resource: '📚 자료', archive: '🗄 보관', project: '🎯', area: '🌱' }[paraOf(memo, state.colls)];
}

// ── 입력칸: 적기 + 찾기 ──

function searching() {
  return isSearchLike(state.input);
}

// 태그·+이름·! 만 있고 내용이 없으면 찾기로만 씀
function captureFrom(text) {
  const cap = parseCapture(text, state.colls);
  const meaningful = cap.body.replace(/(^|\s)[#+-]\S+/g, ' ').replace(/[ㄱ-ㅎ\s]/g, '');
  return meaningful ? cap : null;
}

async function saveOmni() {
  const ta = $('#omni');
  const text = ta.value.trim();
  if (!text) return;
  const cap = captureFrom(text);
  if (!cap) { toast('찾기만 했어요. 내용을 함께 적으면 저장돼요'); return; }
  // 저장이 끝나기 전에 다음 글을 적을 수 있으므로 칸은 바로 비움
  clearOmni();
  const same = liveItems().find((it) => it.memo.body.trim() === cap.body);
  if (same) {
    showMemo(same.memo.id);
    toast('이미 있는 메모예요');
    return;
  }
  const shared = /^https?:\/\/\S+$/.test(cap.body) ? sharedToMemo({ url: cap.body }) : { body: cap.body, sourceUrl: '' };
  const fields = { ...filterFields(), ...shared };
  if (cap.collectionId) fields.collectionId = cap.collectionId;
  if (cap.pinned) fields.pinned = true;
  const m = await createMemo(fields);
  state.fresh = m.id;
  renderAll();
  toast(`저장했어요 → ${placeName(m)}`, { label: '편집', fn: () => openEditor(m.id) });
}

function clearOmni() {
  const ta = $('#omni');
  ta.value = '';
  state.input = '';
  state.limit = PAGE;
  growOmni();
  renderHint();
}

function growOmni() {
  const ta = $('#omni');
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, innerHeight * 0.4) + 'px';
}

function renderHint() {
  const t = state.input.trim();
  const cap = t ? captureFrom(t) : null;
  $('#saveBtn').disabled = !cap;
  $('#clearBtn').hidden = !t;
  $('#bigBtn').hidden = !t;
  $('#clipBtn').hidden = !!t;
  let hint = '';
  if (!t) hint = isTouch ? '' : 'Enter 저장 · Shift+Enter 줄바꿈';
  else if (cap) {
    const c = cap.collectionId && state.colls[cap.collectionId];
    const where = c ? `${c.kind === 'project' ? '🎯' : '🌱'} ${c.name}` : placeName({ ...filterFields(), para: filterFields().para || 'inbox' });
    hint = `→ ${where}${cap.pinned ? ' · 📌' : ''}`;
  } else hint = '찾는 중';
  $('#omniHint').textContent = hint;
}

// ── 화면 그리기 ──

function renderAll() {
  if (state.palaceOn) { renderHint(); renderPalace(); return; }
  renderHint();
  renderBanner();
  renderPins();
  renderToday();
  renderChips();
  renderViewHead();
  renderStream();
}

function renderBanner() {
  const live = state.memos.filter((m) => !m.deletedAt).length;
  const days = state.lastBackup ? Math.floor((Date.now() - state.lastBackup) / DAY) : null;
  const need = live >= 5 && (days === null || days >= 7);
  $('#banner').innerHTML = need
    ? `<div class="banner">💾 ${days === null ? '아직 백업한 적이 없어요.' : `마지막 백업 ${days}일 전.`}
        <button class="link-btn" data-backup>지금 백업</button></div>`
    : '';
}

// 고정 메모: 누르면 바로 복사 (자주 쓴 것 먼저)
function renderPins() {
  const pins = liveItems().filter((it) => it.memo.pinned && paraOf(it.memo, state.colls) !== 'archive')
    .sort((a, b) => (b.memo.usedAt || 0) - (a.memo.usedAt || 0) || b.memo.updatedAt - a.memo.updatedAt);
  const el = $('#pins');
  el.hidden = !pins.length || searching();
  el.innerHTML = pins.map(({ memo, d }) =>
    `<button class="pin" data-pin-copy="${memo.id}" title="눌러서 복사">${KIND_ICON[memoKind(memo)]} ${esc(d.title)}</button>`).join('');
}

// 오늘 할 것: 다가오는 마감, 받은함 정리, 다시 보기
function renderToday() {
  const el = $('#today');
  if (searching() || state.filter.type !== 'all') { el.innerHTML = ''; return; }
  const items = liveItems();
  const rows = [];
  for (const c of activeColls().filter((c) => c.kind === 'project' && c.deadline)) {
    const left = daysLeft(c.deadline);
    if (left !== null && left <= 7) {
      rows.push(`<button class="today-row" data-filter="coll" data-id="${c.id}"><span>⏰ ${esc(c.name)}</span><b class="${left <= 2 ? 'warn' : ''}">${dday(c.deadline)}</b></button>`);
    }
  }
  const inbox = items.filter((it) => paraOf(it.memo, state.colls) === 'inbox').length;
  if (inbox >= 3) rows.push(`<button class="today-row" data-triage><span>📥 받은함 ${inbox}개 정리하기</span><b>→</b></button>`);
  const re = pickResurface(items, Date.now(), state.resurfaceSkip);
  if (re) {
    const p = previewText(re.memo.body, 90);
    rows.push(`<div class="today-row resurface"><button class="link-like" data-show="${re.memo.id}">
        <span>🔁 다시 보기 · <b>${esc(re.d.title)}</b></span>${p ? `<small>${esc(p)}</small>` : ''}</button>
        <button class="mini" data-next-resurface aria-label="다른 메모">↻</button></div>`);
  }
  el.innerHTML = rows.length ? `<div class="today">${rows.join('')}</div>` : '';
}

function chip(label, type, id, count, extra = '') {
  const on = state.filter.type === type && (id === undefined || state.filter.id === id) ? ' on' : '';
  return `<button class="chip${on}" data-filter="${type}"${id ? ` data-id="${id}"` : ''}>${label}${count ? ` <small>${count}</small>` : ''}${extra}</button>`;
}

function renderChips() {
  const items = liveItems();
  const counts = { inbox: 0, resource: 0, archive: 0 };
  const byColl = {};
  for (const { memo } of items) {
    const p = paraOf(memo, state.colls);
    if (p in counts) counts[p]++;
    if (memo.collectionId) byColl[memo.collectionId] = (byColl[memo.collectionId] || 0) + 1;
  }
  const projects = activeColls().filter((c) => c.kind === 'project')
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  const areas = activeColls().filter((c) => c.kind === 'area').sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const trash = state.memos.filter((m) => m.deletedAt).length;
  $('#chips').innerHTML = [
    chip('전체', 'all'),
    chip('📥 받은함', 'inbox', undefined, counts.inbox),
    ...projects.map((c) => chip(`🎯 ${esc(c.name)}`, 'coll', c.id, 0, c.deadline ? ` <small class="${(daysLeft(c.deadline) ?? 99) <= 2 ? 'warn' : ''}">${dday(c.deadline)}</small>` : '')),
    ...areas.map((c) => chip(`🌱 ${esc(c.name)}`, 'coll', c.id, byColl[c.id])),
    chip('📚 자료', 'resource', undefined, counts.resource),
    chip('🗄 보관', 'archive'),
    trash ? chip('🗑', 'trash', undefined, trash) : '',
    '<button class="chip add" data-new-coll aria-label="프로젝트·영역 만들기">＋</button>',
  ].join('');
}

function renderViewHead() {
  const f = state.filter;
  const el = $('#viewHead');
  if (f.type === 'coll' && state.colls[f.id]) {
    const c = state.colls[f.id];
    const area = c.areaId && state.colls[c.areaId];
    const projects = c.kind === 'area' ? activeColls().filter((p) => p.kind === 'project' && p.areaId === c.id) : [];
    el.innerHTML = `
      <div class="vh-title">${c.kind === 'project' ? '🎯 프로젝트' : '🌱 영역'} · ${esc(c.name)}
        ${c.deadline ? `<span class="muted small">${c.deadline} (${dday(c.deadline)})</span>` : ''}
        ${c.archived ? '<span class="badge b-archive">끝남</span>' : ''}</div>
      ${area ? `<div class="muted small">영역: <button class="link-btn" data-filter="coll" data-id="${area.id}">${esc(area.name)}</button></div>` : ''}
      ${projects.length ? `<div class="muted small">이 영역의 프로젝트: ${projects.map((p) => `<button class="link-btn" data-filter="coll" data-id="${p.id}">${esc(p.name)}</button>`).join(' · ')}</div>` : ''}
      ${c.note ? `<div class="vh-note">${esc(c.note)}</div>` : ''}
      <div class="vh-actions">
        <button class="chip-btn" data-edit-coll="${c.id}">수정</button>
        ${c.kind === 'project' ? `<button class="chip-btn" data-archive-coll="${c.id}">${c.archived ? '되살리기' : '✅ 끝냄'}</button>` : ''}
        <button class="chip-btn danger" data-del-coll="${c.id}">삭제</button>
      </div>`;
  } else if (f.type === 'archive') {
    const done = Object.values(state.colls).filter((c) => c.archived);
    el.innerHTML = done.length ? `<div class="muted small">끝난 프로젝트: ${done.map((c) => `<button class="link-btn" data-filter="coll" data-id="${c.id}">${esc(c.name)}</button>`).join(' · ')}</div>` : '';
  } else if (f.type === 'trash') {
    el.innerHTML = `<div class="muted small">${TRASH_DAYS}일이 지나면 완전히 지워져요.
      ${state.memos.some((m) => m.deletedAt) ? '<button class="link-btn danger" data-empty-trash>지금 비우기</button>' : ''}</div>`;
  } else el.innerHTML = '';
}

function inFilter(memo) {
  const f = state.filter;
  if (f.type === 'trash') return !!memo.deletedAt;
  if (memo.deletedAt) return false;
  const p = paraOf(memo, state.colls);
  switch (f.type) {
    case 'all': return searching() || p !== 'archive';
    case 'pinned': return memo.pinned;
    case 'coll': return memo.collectionId === f.id;
    default: return p === f.type;
  }
}

function fmtTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toTimeString().slice(0, 5);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function renderStream() {
  const items = state.memos.filter(inFilter).map((memo) => ({ memo, d: dOf(memo) }));
  const q = searching() ? state.input : '';
  const hits = q ? searchMemos(items, q, state.colls) : byRecent(items);
  const shown = hits.slice(0, state.limit);
  const el = $('#stream');
  let html = '';
  if (q) {
    html += `<div class="day">찾은 메모 ${hits.length}개${captureFrom(state.input) ? ' · 없으면 저장을 누르세요' : ''}</div>`;
    html += shown.map(card).join('');
  } else {
    let last = '';
    for (const it of shown) {
      const label = dayLabel(it.memo.updatedAt);
      if (label !== last) { html += `<div class="day">${label}</div>`; last = label; }
      html += card(it);
    }
  }
  if (!hits.length) html += `<p class="empty">${emptyText()}</p>`;
  if (hits.length > shown.length) html += `<button class="more link-btn" data-more>더 보기 (${hits.length - shown.length})</button>`;
  el.innerHTML = html;
  const open = el.querySelector('.card.open .md');
  if (open) fillImages(open);
  state.fresh = null;
}

function byRecent(items) {
  return items.sort((a, b) => b.memo.updatedAt - a.memo.updatedAt);
}

function emptyText() {
  if (searching()) return '찾는 메모가 없어요.';
  switch (state.filter.type) {
    case 'inbox': return '받은함이 비었어요. 🎉';
    case 'trash': return '휴지통이 비었어요.';
    case 'archive': return '끝난 프로젝트와 보관한 메모가 여기에 모여요.';
    case 'coll': return `위 칸에 적으면 여기로 들어가요.`;
    default: return '위 칸에 아무거나 적고 저장해 보세요. 정리는 나중에 해도 돼요.';
  }
}

function card({ memo, d }) {
  const open = state.expanded === memo.id;
  const kind = memoKind(memo);
  const p = paraOf(memo, state.colls);
  // 받은함은 기본 자리라 따로 표시하지 않음
  const showPlace = p !== 'inbox' && !(state.filter.type === 'coll' && memo.collectionId === state.filter.id) && state.filter.type !== p;
  const snip = previewText(memo.body);
  const trash = !!memo.deletedAt;
  const cls = `card${open ? ' open' : ''}${memo.id === state.fresh ? ' fresh' : ''}`;
  return `<article class="${cls}" data-id="${memo.id}">
    <div class="card-head" data-toggle="${memo.id}" role="button" tabindex="0" aria-expanded="${open}">
      <span class="kind" aria-hidden="true">${KIND_ICON[kind]}</span>
      <div class="card-main">
        <div class="card-title">${memo.pinned ? '📌 ' : ''}${esc(d.title)}</div>
        ${!open && snip ? `<div class="card-snip">${esc(snip)}</div>` : ''}
        <div class="card-meta">
          ${showPlace ? `<span class="badge b-${p}">${esc(placeName(memo))}</span>` : ''}
          ${d.tags.slice(0, 4).map((t) => `<span class="t">#${esc(t)}</span>`).join('')}
          ${memo.sourceUrl ? `<span class="host">${esc(hostOf(memo.sourceUrl))}</span>` : ''}
          <span class="time">${fmtTime(memo.updatedAt)}</span>
        </div>
      </div>
      ${trash ? `<button class="card-btn" data-restore="${memo.id}">되살리기</button>`
        : `<button class="card-btn" data-copy="${memo.id}" aria-label="복사">복사</button>`}
    </div>
    ${open && !trash ? cardBody(memo, d) : ''}
  </article>`;
}

function cardBody(memo, d) {
  // 제목(첫 줄)은 카드 머리에 이미 있으므로 둘째 줄부터. 한 줄 메모는 링크·태그를 누를 수 있게 그대로
  const lines = memo.body.split('\n');
  const firstText = lines.findIndex((l) => l.trim());
  const e = entryOf(memo.body);
  const rest = [e ? e.desc : '', lines.slice(firstText + 1).join('\n')].join('\n').trim();
  const html = renderMarkdown(rest || memo.body, { hasTitle: (t) => titleMap().has(normalize(t)) });
  return `<div class="card-body">
      <div class="md">${html}</div>
      ${memo.sourceUrl ? `<a class="source" href="${esc(memo.sourceUrl)}" target="_blank" rel="noopener">🔗 ${esc(memo.sourceUrl)}</a>` : ''}
      ${connections(memo, d)}
      <div class="card-actions">
        <button class="act" data-edit="${memo.id}">✏️ 편집</button>
        <button class="act" data-move="${memo.id}">🗂 옮기기</button>
        <button class="act${memo.pinned ? ' on' : ''}" data-pin="${memo.id}">📌 ${memo.pinned ? '고정 풀기' : '고정'}</button>
        <button class="act" data-share="${memo.id}">↗ 보내기</button>
        <button class="act danger" data-delete="${memo.id}">🗑</button>
      </div>
    </div>`;
}

function connections(memo, d) {
  const items = liveItems();
  const self = { memo, d };
  const back = backlinks(items, self);
  const related = relatedMemos(items, self, 4).filter((r) => !back.some((b) => b.memo.id === r.memo.id));
  const li = (it) => `<button class="conn-item" data-show="${it.memo.id}">${KIND_ICON[memoKind(it.memo)]} ${esc(it.d.title)}</button>`;
  if (!back.length && !related.length) return '';
  return `<div class="conn">
    ${back.length ? `<div><span class="muted small">↩ 이 메모를 가리키는 메모</span>${back.map(li).join('')}</div>` : ''}
    ${related.length ? `<div><span class="muted small">🏷 태그가 겹치는 메모</span>${related.map(li).join('')}</div>` : ''}
  </div>`;
}

const imageUrls = new Map();
async function fillImages(root) {
  for (const img of root.querySelectorAll('img[data-img]')) {
    const id = img.dataset.img;
    if (!imageUrls.has(id)) {
      const row = await db.get('images', id);
      imageUrls.set(id, row ? URL.createObjectURL(row.blob) : '');
    }
    const url = imageUrls.get(id);
    if (url) img.src = url; else img.alt = '(지워진 이미지)';
  }
}

// 목록에서 메모 하나를 펼쳐 보여 줌 (다른 화면으로 가지 않음)
async function showMemo(id) {
  const m = findMemo(id);
  if (!m) return;
  if (m.deletedAt) state.filter = { type: 'trash' };
  else if (!inFilter(m)) state.filter = { type: 'all' };
  if (paraOf(m, state.colls) === 'archive' && state.filter.type === 'all') state.filter = { type: 'archive' };
  if (searching()) clearOmni();
  state.expanded = id;
  const idx = byRecent(state.memos.filter(inFilter).map((memo) => ({ memo, d: dOf(memo) })))
    .findIndex((h) => h.memo.id === id);
  if (idx >= state.limit) state.limit = idx + 1;
  m.seenAt = Date.now();
  saveMemo(m, false);
  renderAll();
  document.querySelector(`.card[data-id="${id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function toggleCard(id) {
  state.expanded = state.expanded === id ? null : id;
  const m = findMemo(id);
  if (m && state.expanded) { m.seenAt = Date.now(); saveMemo(m, false); }
  renderStream();
}

// ── 겹쳐 뜨는 화면 (뒤로 가기로 닫힘) ──

const layers = [];

function openLayer(dlg, onClose) {
  layers.push({ dlg, onClose });
  history.pushState({ layer: layers.length }, '');
  if (!dlg.open) dlg.showModal();
}

let afterClose = null;
// then: 닫힌 다음에 할 일 (뒤로 가기가 끝난 뒤에 새 화면을 열어야 기록이 꼬이지 않음)
function closeLayer(then) {
  if (!layers.length) return then?.();
  afterClose = then || null;
  history.back();
}

addEventListener('popstate', () => {
  const top = layers.pop();
  if (!top) return;
  top.dlg.close();
  top.onClose?.();
  const fn = afterClose;
  afterClose = null;
  fn?.();
});

for (const id of ['editor', 'sheet']) {
  document.getElementById(id).addEventListener('cancel', (e) => { e.preventDefault(); closeLayer(); });
}
document.getElementById('sheet').addEventListener('click', (e) => {
  if (e.target.id === 'sheet') closeLayer();
});

// ── 편집 ──

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}
function flushSave() {
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const m = state.editing && findMemo(state.editing);
  if (m) saveMemo(m);
}
addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
addEventListener('pagehide', flushSave);

function openEditor(id) {
  const m = findMemo(id);
  if (!m) return;
  if ($('#editor').open) { flushSave(); state.editing = id; renderEditor(); return; }
  state.editing = id;
  renderEditor();
  openLayer($('#editor'), onEditorClosed);
  const ta = $('#body');
  if (!isTouch || !m.body) {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
}

async function onEditorClosed() {
  flushSave();
  const m = state.editing && findMemo(state.editing);
  state.editing = null;
  if (m && !m.body.trim()) {
    state.memos = state.memos.filter((x) => x.id !== m.id);
    await db.del('memos', m.id);
  } else if (m) {
    state.expanded = m.id;
  }
  renderAll();
}

function renderEditor() {
  const m = findMemo(state.editing);
  const d = dOf(m);
  $('#editor').innerHTML = `
    <div class="ed-top">
      <button class="chip-btn" data-done>← 완료</button>
      <button class="chip-btn place" data-move="${m.id}">${esc(placeName(m))} ▾</button>
      <span class="spacer"></span>
      <button class="icon-btn" data-image aria-label="이미지 넣기">🖼</button>
      <button class="icon-btn${m.pinned ? ' on' : ''}" data-pin="${m.id}" aria-label="고정">📌</button>
      <button class="icon-btn danger" data-delete="${m.id}" aria-label="휴지통">🗑</button>
    </div>
    <textarea id="body" class="ed-body" placeholder="첫 줄은 제목&#10;&#10;#태그  [[다른 메모]]  - [ ] 할 일  ==형광펜==">${esc(m.body)}</textarea>
    <div id="suggest" class="suggest" hidden></div>
    <label class="ed-source"><span>🔗</span><input id="source" type="url" placeholder="출처 링크 (있으면)" value="${esc(m.sourceUrl || '')}" inputmode="url"></label>
    <div id="edConn">${connections(m, d)}</div>
    <div class="muted small ed-foot">만든 날 ${new Date(m.createdAt).toLocaleString('ko-KR')}</div>`;
  growBody();
}

function growBody() {
  const ta = $('#body');
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = Math.max(ta.scrollHeight, innerHeight * 0.45) + 'px';
}

function onBodyInput(ta) {
  const m = findMemo(state.editing);
  if (!m) return;
  m.body = ta.value;
  growBody();
  scheduleSave();
}

// [[링크]] · #태그 자동완성
function updateSuggest(ta) {
  const box = $('#suggest');
  const before = ta.value.slice(0, ta.selectionStart);
  let m, items = [], kind;
  if ((m = before.match(/\[\[([^\]\n]*)$/))) {
    kind = 'link';
    const q = normalize(m[1]);
    items = liveItems().filter((it) => it.memo.id !== state.editing && it.d.key.includes(q))
      .sort((a, b) => b.memo.updatedAt - a.memo.updatedAt).slice(0, 8).map((it) => it.d.title);
  } else if ((m = before.match(/(?:^|\s)#([\p{L}\p{N}_\-/]+)$/u))) {
    kind = 'tag';
    const q = normalize(m[1]);
    items = tagCounts(liveItems()).map(([t]) => t).filter((t) => normalize(t).startsWith(q) && normalize(t) !== q).slice(0, 8);
  }
  if (!items.length) { box.hidden = true; return; }
  box.hidden = false;
  box.dataset.kind = kind;
  box.dataset.len = m[1].length;
  box.innerHTML = items.map((t) => `<button type="button" data-pick="${esc(t)}">${kind === 'tag' ? '#' : ''}${esc(t)}</button>`).join('');
}

function pickSuggest(value) {
  const ta = $('#body');
  const box = $('#suggest');
  const at = ta.selectionStart;
  const len = Number(box.dataset.len);
  const insert = box.dataset.kind === 'link' ? value + ']]' : value + ' ';
  let after = ta.value.slice(at);
  if (box.dataset.kind === 'link' && after.startsWith(']]')) after = after.slice(2);
  ta.value = ta.value.slice(0, at - len) + insert + after;
  const pos = at - len + insert.length;
  ta.setSelectionRange(pos, pos);
  ta.focus();
  box.hidden = true;
  onBodyInput(ta);
}

// ── 이미지 ──

async function compressImage(file) {
  const MAX = 1600;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return { blob: file, type: file.type || 'image/png' };
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const toBlob = (type, q) => new Promise((r) => canvas.toBlob(r, type, q));
  let blob = await toBlob('image/webp', 0.82);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', 0.85);
  if (!blob || blob.size > file.size) return { blob: file, type: file.type || 'image/png' };
  return { blob, type: blob.type };
}

async function storeImage(file) {
  const { blob, type } = await compressImage(file);
  const id = uid();
  await db.put('images', { id, blob, type, createdAt: Date.now() });
  return id;
}

async function insertImage(file) {
  const m = findMemo(state.editing);
  if (!m) return;
  const id = await storeImage(file);
  const ta = $('#body');
  const at = ta.selectionStart ?? ta.value.length;
  ta.value = ta.value.slice(0, at) + `\n![](img:${id})\n` + ta.value.slice(at);
  onBodyInput(ta);
  flushSave();
}

// ── 메모 동작 ──

function copyText(memo) {
  const e = entryOf(memo.body);
  if (e) return e.keyword;
  if (memoKind(memo) === 'link' && memo.sourceUrl) return memo.sourceUrl;
  const lines = memo.body.split('\n');
  const rest = lines.slice(1).join('\n').trim();
  return rest || lines[0].replace(/^#{1,6}\s+/, '');
}

async function copyMemo(memo, withOpen = false, text = copyText(memo)) {
  try {
    await navigator.clipboard.writeText(text);
    memo.useCount = (memo.useCount || 0) + 1;
    memo.usedAt = Date.now();
    saveMemo(memo, false);
    const actions = [{ label: '🔎 검색', fn: () => webSearch(text) }];
    if (withOpen) actions.push({ label: '열기', fn: () => (state.palaceOn ? openEditor(memo.id) : showMemo(memo.id)) });
    toast(`‘${text.length > 16 ? text.slice(0, 16) + '…' : text}’ 복사했어요`, actions);
  } catch {
    toast('복사하지 못했어요. 메모를 펼쳐 직접 선택해 주세요.');
  }
}

// 복사한 키워드를 바로 웹에서 찾기
function webSearch(text) {
  window.open('https://www.google.com/search?q=' + encodeURIComponent(text), '_blank', 'noopener');
}

async function togglePin(memo) {
  memo.pinned = !memo.pinned;
  await saveMemo(memo, false);
  if ($('#editor').open) renderEditor();
  renderAll();
}

async function trashMemo(memo) {
  memo.deletedAt = Date.now();
  await saveMemo(memo, false);
  if (state.editing === memo.id) { state.editing = null; closeLayer(); }
  if (state.expanded === memo.id) state.expanded = null;
  renderAll();
  toast('휴지통으로 옮겼어요', { label: '되돌리기', fn: async () => { memo.deletedAt = null; await saveMemo(memo, false); renderAll(); } });
}

async function restoreMemo(memo) {
  memo.deletedAt = null;
  await saveMemo(memo, false);
  renderAll();
  toast('되살렸어요');
}

async function purgeMemos(list) {
  const ids = new Set(list.map((m) => m.id));
  state.memos = state.memos.filter((m) => !ids.has(m.id));
  const used = new Set();
  for (const m of state.memos) for (const x of m.body.matchAll(/\]\(img:([\w-]+)\)/g)) used.add(x[1]);
  for (const m of list) {
    await db.del('memos', m.id);
    for (const x of m.body.matchAll(/\]\(img:([\w-]+)\)/g)) if (!used.has(x[1])) await db.del('images', x[1]);
  }
}

async function shareMemo(memo) {
  const text = memo.body + (memo.sourceUrl && !memo.body.includes(memo.sourceUrl) ? '\n\n' + memo.sourceUrl : '');
  if (navigator.share) navigator.share({ title: dOf(memo).title, text }).catch(() => {});
  else { await navigator.clipboard.writeText(text).catch(() => {}); toast('전체 내용을 복사했어요'); }
}

async function moveMemo(memo, place) {
  if (place === 'archive') memo.archived = true;
  else {
    memo.archived = false;
    if (place.startsWith('c:')) memo.collectionId = place.slice(2);
    else { memo.collectionId = null; memo.para = place; }
  }
  await saveMemo(memo, false);
}

async function openLink(title) {
  const m = titleMap().get(normalize(title));
  if (m) {
    if ($('#editor').open) return openEditor(m.id);
    return showMemo(m.id);
  }
  if (confirm(`'${title}' 메모가 아직 없어요. 새로 만들까요?`)) {
    const n = await createMemo({ body: `# ${title}\n\n` });
    openEditor(n.id);
  }
}

async function setTaskLine(memo, line) {
  memo.body = toggleTask(memo.body, line);
  await saveMemo(memo);
  renderStream();
}

// ── 시트: 옮기기 · 정리하기 · 태그 · 프로젝트/영역 · 설정 ──

function placeButtons(memo) {
  const cur = memo.archived ? 'archive' : memo.collectionId && state.colls[memo.collectionId] ? 'c:' + memo.collectionId : memo.para === 'resource' ? 'resource' : 'inbox';
  const b = (v, label) => `<button class="place-btn${v === cur ? ' on' : ''}" data-place="${v}">${label}</button>`;
  const projects = activeColls().filter((c) => c.kind === 'project');
  const areas = activeColls().filter((c) => c.kind === 'area');
  return `
    <div class="place-grid">${b('resource', '📚 자료')}${b('inbox', '📥 받은함')}${b('archive', '🗄 보관')}</div>
    ${projects.length ? `<div class="muted small">🎯 프로젝트</div><div class="place-grid">${projects.map((c) => b('c:' + c.id, esc(c.name))).join('')}</div>` : ''}
    ${areas.length ? `<div class="muted small">🌱 영역</div><div class="place-grid">${areas.map((c) => b('c:' + c.id, esc(c.name))).join('')}</div>` : ''}
    <button class="link-btn small" data-new-coll>＋ 프로젝트·영역 만들기</button>`;
}

function openSheet(html, bind, onClose) {
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="sheet-body">${html}</div>`;
  bind?.(sheet);
  if (!sheet.open) openLayer(sheet, onClose);
}

function openMove(memo) {
  openSheet(`<h2>어디로 옮길까요?</h2><p class="muted small">${esc(dOf(memo).title)}</p>${placeButtons(memo)}`, (s) => {
    s.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.place) {
        await moveMemo(memo, b.dataset.place);
        closeLayer();
        if ($('#editor').open) renderEditor();
        renderAll();
        toast(`${placeName(memo)}(으)로 옮겼어요`);
      } else if ('newColl' in b.dataset) newCollSheet();
    };
  });
}

// 받은함 정리: 한 장씩 보고 한 번 눌러 보내기
function openTriage() {
  const queue = liveItems().filter((it) => paraOf(it.memo, state.colls) === 'inbox')
    .sort((a, b) => a.memo.createdAt - b.memo.createdAt).map((it) => it.memo.id);
  let i = 0;
  let done = 0;
  const show = () => {
    const memo = findMemo(queue[i]);
    if (!memo) {
      openSheet(`<h2>정리 끝 🎉</h2><p>${done}개를 옮겼어요.</p><div class="dlg-actions"><button class="primary-btn" data-close>닫기</button></div>`,
        (s) => { s.onclick = (e) => { if (e.target.closest('[data-close]')) closeLayer(); }; });
      return;
    }
    openSheet(`
      <div class="triage-top"><h2>받은함 정리</h2><span class="muted small">${i + 1} / ${queue.length}</span></div>
      <div class="triage-card md">${renderMarkdown(memo.body)}</div>
      ${memo.sourceUrl ? `<div class="muted small host">🔗 ${esc(hostOf(memo.sourceUrl))}</div>` : ''}
      <input id="triageTags" class="field" placeholder="#태그 더하기 (선택)" autocomplete="off">
      ${placeButtons(memo)}
      <div class="dlg-actions">
        <button class="chip-btn danger" data-trash>🗑 버리기</button>
        <button class="chip-btn" data-edit-now>✏️ 편집</button>
        <button class="chip-btn" data-skip>나중에 →</button>
      </div>`, (s) => {
      fillImages(s.querySelector('.triage-card'));
      s.onclick = async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const extra = parseTags(s.querySelector('#triageTags').value.replace(/(^|\s)([^#\s])/g, '$1#$2'));
        const addTags = async () => {
          const have = new Set(dOf(memo).tags.map(normalize));
          const add = extra.filter((t) => !have.has(normalize(t)));
          if (add.length) { memo.body = memo.body.trimEnd() + '\n\n' + add.map((t) => '#' + t).join(' '); await saveMemo(memo); }
        };
        if (b.dataset.place) { await addTags(); await moveMemo(memo, b.dataset.place); done++; i++; show(); renderAll(); }
        else if ('trash' in b.dataset) { memo.deletedAt = Date.now(); await saveMemo(memo, false); done++; i++; show(); renderAll(); }
        else if ('skip' in b.dataset) { await addTags(); i++; show(); }
        else if ('editNow' in b.dataset) { await addTags(); closeLayer(() => openEditor(memo.id)); }
        else if ('newColl' in b.dataset) newCollSheet();
      };
    });
  };
  show();
}

function openTags() {
  const tags = tagCounts(liveItems().filter((it) => paraOf(it.memo, state.colls) !== 'archive'));
  openSheet(`<h2># 태그</h2>
    ${tags.length ? `<div class="tag-cloud">${tags.map(([t, n]) => `<button class="tag-chip" data-tag="${esc(t)}">#${esc(t)} <small>${n}</small></button>`).join('')}</div>`
      : '<p class="muted">본문에 #태그 를 쓰면 여기에 모여요.</p>'}`, (s) => {
    s.onclick = (e) => {
      const b = e.target.closest('[data-tag]');
      if (!b) return;
      closeLayer(() => searchFor('#' + b.dataset.tag));
    };
  });
}

function searchFor(text) {
  const ta = $('#omni');
  ta.value = text;
  state.input = text;
  state.filter = { type: 'all' };
  state.expanded = null;
  growOmni();
  renderAll();
  scrollTo({ top: 0 });
}

function newCollSheet() {
  openSheet(`<h2>무엇을 만들까요?</h2>
    <button class="big-choice" data-kind="project"><b>🎯 프로젝트</b><span>끝나는 날이 있는 일 · 예) 2027 임용 2차, 이사</span></button>
    <button class="big-choice" data-kind="area"><b>🌱 영역</b><span>끝없이 계속 챙기는 분야 · 예) 수업, 건강, 돈</span></button>`, (s) => {
    s.onclick = (e) => {
      const b = e.target.closest('[data-kind]');
      if (b) editColl(b.dataset.kind);
    };
  });
}

function editColl(kind, existing) {
  const c = existing || { id: uid(), kind, name: '', deadline: '', areaId: '', note: '', archived: false, createdAt: Date.now() };
  const isProject = c.kind === 'project';
  const areas = activeColls().filter((a) => a.kind === 'area');
  openSheet(`
    <form class="form">
      <h2>${existing ? '고치기' : '새'} ${isProject ? '🎯 프로젝트' : '🌱 영역'}</h2>
      <label>이름<input class="field" name="name" required value="${esc(c.name)}" autocomplete="off"></label>
      ${isProject ? `
        <label>마감일<input class="field" name="deadline" type="date" value="${esc(c.deadline || '')}"></label>
        ${areas.length ? `<label>속한 영역<select class="field" name="areaId"><option value="">(없음)</option>
          ${areas.map((a) => `<option value="${a.id}"${a.id === c.areaId ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : ''}` : ''}
      <label>설명 (선택)<textarea class="field" name="note" rows="2">${esc(c.note || '')}</textarea></label>
      <p class="muted small">빠른 입력칸에 <code>+${esc(c.name || '이름')}</code> 을 붙이면 바로 여기로 저장돼요.</p>
      <div class="dlg-actions"><button type="button" class="chip-btn" data-cancel>취소</button><button class="primary-btn">저장</button></div>
    </form>`, (s) => {
    const form = s.querySelector('form');
    form.name.focus();
    s.onclick = (e) => { if (e.target.closest('[data-cancel]')) closeLayer(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      c.name = fd.get('name').trim();
      if (!c.name) return;
      c.note = (fd.get('note') || '').trim();
      if (isProject) { c.deadline = fd.get('deadline') || ''; c.areaId = fd.get('areaId') || ''; }
      state.colls[c.id] = c;
      await db.put('collections', c);
      closeLayer();
      if (!existing) state.filter = { type: 'coll', id: c.id };
      renderAll();
    };
  });
}

async function archiveColl(c) {
  c.archived = !c.archived;
  await db.put('collections', c);
  renderAll();
  toast(c.archived ? `‘${c.name}’ 끝! 메모는 보관으로 갔어요` : '되살렸어요');
}

async function deleteColl(c) {
  const n = state.memos.filter((m) => m.collectionId === c.id).length;
  if (!confirm(`‘${c.name}’을(를) 지울까요?${n ? `\n안의 메모 ${n}개는 받은함으로 옮겨요.` : ''}`)) return;
  for (const m of state.memos) if (m.collectionId === c.id) { m.collectionId = null; await saveMemo(m, false); }
  for (const p of Object.values(state.colls)) if (p.areaId === c.id) { p.areaId = ''; await db.put('collections', p); }
  delete state.colls[c.id];
  await db.del('collections', c.id);
  state.filter = { type: 'all' };
  renderAll();
}

// ── 백업·가져오기 ──

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function deliver(name, blob) {
  const file = new File([blob], name, { type: blob.type });
  if (isTouch && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  download(name, blob);
  return true;
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.readAsDataURL(blob);
  });
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function markBackedUp() {
  state.lastBackup = Date.now();
  await db.setMeta('lastBackup', state.lastBackup);
  renderBanner();
}

async function exportJson() {
  const images = [];
  for (const img of await db.all('images')) images.push({ id: img.id, type: img.type, createdAt: img.createdAt, data: await blobToBase64(img.blob) });
  const data = { app: 'memobox', version: 1, exportedAt: new Date().toISOString(), memos: state.memos, collections: Object.values(state.colls), images };
  if (await deliver(`메모함-백업-${stamp()}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }))) {
    await markBackedUp();
    toast('백업 파일을 만들었어요');
  }
}

async function exportMarkdown() {
  const live = state.memos.filter((m) => !m.deletedAt);
  const ext = {};
  const files = [];
  for (const img of await db.all('images')) {
    ext[img.id] = (img.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    files.push({ name: `images/${img.id}.${ext[img.id]}`, data: new Uint8Array(await img.blob.arrayBuffer()) });
  }
  const names = uniqueNames(live.map((m) => memoTitle(m.body)));
  live.forEach((m, i) => {
    const p = paraOf(m, state.colls);
    const c = m.collectionId && state.colls[m.collectionId];
    const folder = { inbox: '0 받은함', project: '1 프로젝트', area: '2 영역', resource: '3 자료', archive: '4 보관' }[p];
    const sub = c ? `/${uniqueNames([c.name])[0]}` : '';
    files.push({ name: `${folder}${sub}/${names[i]}.md`, data: memoToMarkdown(m, state.colls, ext) });
  });
  if (await deliver(`메모함-마크다운-${stamp()}.zip`, new Blob([makeZip(files)], { type: 'application/zip' }))) {
    await markBackedUp();
    toast('마크다운 ZIP을 만들었어요 (옵시디언에서 열 수 있어요)');
  }
}

function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

async function importFiles(files) {
  let added = 0, updated = 0;
  for (const f of files) {
    const text = await f.text();
    if (/\.json$/i.test(f.name) || text.trimStart().startsWith('{')) {
      let data;
      try { data = JSON.parse(text); } catch { toast(`${f.name}: 읽을 수 없는 파일이에요`); continue; }
      if (data.app !== 'memobox') { toast(`${f.name}: 메모함 백업 파일이 아니에요`); continue; }
      const mm = mergeById(state.memos, data.memos || []);
      state.memos = mm.list;
      added += mm.added; updated += mm.updated;
      await db.putMany('memos', state.memos);
      const mc = mergeById(Object.values(state.colls), data.collections || []);
      state.colls = Object.fromEntries(mc.list.map((c) => [c.id, c]));
      await db.putMany('collections', mc.list);
      for (const img of data.images || []) {
        if (!(await db.get('images', img.id))) await db.put('images', { id: img.id, type: img.type, createdAt: img.createdAt, blob: base64ToBlob(img.data, img.type) });
      }
    } else {
      await createMemo(markdownToMemo(text, f.name));
      added++;
    }
  }
  state.memos.sort((a, b) => b.updatedAt - a.updatedAt);
  renderAll();
  toast(`가져왔어요: 새 메모 ${added}개${updated ? `, 바뀐 메모 ${updated}개` : ''}`);
}

async function openSettings() {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const appUrl = location.origin + location.pathname;
  const bookmarklet = `javascript:(()=>{const s=String(getSelection());window.open(${JSON.stringify(appUrl)}+'?title='+encodeURIComponent(document.title)+'&url='+encodeURIComponent(location.href)+'&text='+encodeURIComponent(s))})()`;
  const colls = Object.values(state.colls).sort((a, b) => (a.archived - b.archived) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'ko'));
  openSheet(`
    <h2>⚙️ 설정·백업</h2>
    <section>
      <h3>✍️ 빠른 입력 요령</h3>
      <ul class="small tips">
        <li>위 칸 하나로 <b>적기와 찾기</b>를 같이 해요. 짧게 적으면 아래에 비슷한 메모가 바로 보여요.</li>
        <li><code>#태그</code> 태그 · <code>+이름</code> 그 프로젝트·영역으로 저장 · <code>!</code> 고정</li>
        <li>찾기: 낱말 여러 개 · <code>#태그</code> · <code>+프로젝트</code> · <code>-빼기</code> · 초성 <code>ㅁㅅ</code></li>
        <li>본문: <code>[[메모 제목]]</code> 잇기 · <code>==형광펜==</code> 은 목록에 먼저 보임 · <code>- [ ] 할 일</code></li>
        <li>📌 고정한 메모는 맨 위 줄에 — 누르면 바로 복사 (둘째 줄부터, 링크는 주소)</li>
      </ul>
    </section>
    <section>
      <h3>🎯 프로젝트 · 🌱 영역</h3>
      <div class="coll-list">${colls.map((c) => `<button class="coll-row" data-edit-coll="${c.id}">
        <span>${c.kind === 'project' ? '🎯' : '🌱'} ${esc(c.name)}${c.archived ? ' <small class="muted">(끝남)</small>' : ''}</span>
        <small class="muted">${c.deadline ? dday(c.deadline) : ''} 고치기</small></button>`).join('') || '<p class="muted small">아직 없어요.</p>'}</div>
      <button class="chip-btn" data-new-coll>＋ 만들기</button>
    </section>
    <section>
      <h3>💾 백업</h3>
      <p class="muted small">메모는 이 기기에만 있어요. ${state.lastBackup ? `마지막 백업: ${new Date(state.lastBackup).toLocaleString('ko-KR')}` : '아직 백업한 적이 없어요.'}</p>
      <div class="row"><button class="primary-btn" data-act="json">전체 백업 (JSON)</button>
      <button class="chip-btn" data-act="md">마크다운 ZIP (옵시디언용)</button></div>
      <p class="muted small">가져오기: 백업 JSON(같은 메모는 더 최근 것으로) 또는 .md 파일 여러 개.</p>
      <button class="chip-btn" data-act="import">📥 파일 가져오기</button>
    </section>
    <section>
      <h3>🔗 다른 앱에서 바로 담기</h3>
      <p class="small"><b>PC 크롬</b>: 이 버튼을 북마크바로 끌어다 놓기 → <a class="chip-btn" href="${esc(bookmarklet)}" onclick="return false">📎 메모함에 담기</a></p>
      <p class="small"><b>안드로이드</b>: 크롬 메뉴 → 앱 설치. 공유 메뉴에 ‘메모함’이 생겨요.</p>
      <p class="small"><b>아이폰</b>: 사파리 공유 → 홈 화면에 추가. 공유 메뉴용 단축어 주소: <code class="url">${esc(appUrl)}?text=</code></p>
    </section>
    <section>
      <h3>📦 저장 공간</h3>
      <p class="muted small">${est ? `${(est.usage / 1048576).toFixed(1)}MB 사용 중 · ` : ''}${persisted ? '✅ 브라우저가 지우지 않도록 보호됨' : '⚠️ 보호 안 됨 — 홈 화면에 설치하면 더 안전해요'}</p>
    </section>`, (s) => {
    s.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'json') exportJson();
      else if (act === 'md') exportMarkdown();
      else if (act === 'import') $('#importInput').click();
      else if (b.dataset.editColl) editColl(null, state.colls[b.dataset.editColl]);
      else if ('newColl' in b.dataset) newCollSheet();
    };
  });
}

// ── 알림 ──

let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  const actions = action ? [].concat(action) : [];
  el.innerHTML = esc(msg) + actions.map((a, i) => ` <button class="link-btn" data-i="${i}">${esc(a.label)}</button>`).join('');
  el.querySelectorAll('button').forEach((b) => {
    b.onclick = () => { el.classList.remove('show'); actions[b.dataset.i].fn(); };
  });
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), actions.length ? 5000 : 2000);
}

// ── 공유로 들어온 것: 편집 화면 없이 바로 저장 ──

async function takeShared() {
  const p = new URLSearchParams(location.search);
  if (![...p.keys()].length) return;
  history.replaceState(null, '', location.pathname);
  if (p.has('new')) { $('#omni').focus(); return; }
  if (!['title', 'text', 'url'].some((k) => p.get(k))) return;
  const shared = sharedToMemo({ title: p.get('title') || '', text: p.get('text') || '', url: p.get('url') || '' });
  const same = shared.sourceUrl && liveItems().find((it) => it.memo.sourceUrl === shared.sourceUrl);
  if (same) { showMemo(same.memo.id); toast('이미 담아 둔 링크예요'); return; }
  const m = await createMemo(shared);
  state.fresh = m.id;
  renderAll();
  toast('받은함에 담았어요', { label: '편집', fn: () => openEditor(m.id) });
}

// ── 이벤트 ──

function bind() {
  const omni = $('#omni');
  let t;
  omni.addEventListener('input', () => {
    state.input = omni.value;
    growOmni();
    renderHint();
    clearTimeout(t);
    t = setTimeout(() => {
      if (state.palaceOn) return highlightPalace();
      state.limit = PAGE; renderPins(); renderToday(); renderStream();
    }, 60);
  });
  omni.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && (!isTouch || e.ctrlKey || e.metaKey)) { e.preventDefault(); saveOmni(); }
    else if (e.key === 'Escape') { clearOmni(); renderAll(); }
    else if (e.key === 'ArrowDown' && searching()) { e.preventDefault(); document.querySelector('.card-head')?.focus(); }
  });
  omni.addEventListener('paste', async (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    const id = await storeImage(file);
    const text = omni.value.trim();
    const m = await createMemo({ body: `${text || '# 붙여넣은 이미지'}\n\n![](img:${id})`, ...filterFields() });
    clearOmni();
    state.fresh = m.id;
    renderAll();
    toast('이미지를 저장했어요');
  });
  $('#saveBtn').onclick = saveOmni;
  $('#clearBtn').onclick = () => { clearOmni(); renderAll(); omni.focus(); };
  $('#bigBtn').onclick = async () => {
    const cap = parseCapture(omni.value, state.colls);
    const fields = { ...filterFields(), body: cap.body };
    if (cap.collectionId) fields.collectionId = cap.collectionId;
    if (cap.pinned) fields.pinned = true;
    const m = await createMemo(fields);
    clearOmni();
    openEditor(m.id);
  };
  $('#clipBtn').onclick = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return toast('클립보드가 비었어요');
      omni.value = text;
      state.input = text;
      await saveOmni();
    } catch {
      omni.focus();
      toast('칸을 길게 눌러 붙여넣은 뒤 저장해 주세요');
    }
  };
  $('#menuBtn').onclick = openSettings;
  $('#palaceBtn').onclick = () => setPalace(!state.palaceOn);
  addEventListener('resize', sizePalace);
  $('#tagsBtn').onclick = openTags;

  document.querySelector('.wrap').addEventListener('click', async (e) => {
    const t = e.target;
    const link = t.closest('.wikilink');
    if (link) { e.preventDefault(); return openLink(link.dataset.link); }
    const tag = t.closest('a.tag');
    if (tag) { e.preventDefault(); return searchFor('#' + tag.dataset.tag); }
    if (t.matches('input[type="checkbox"][data-line]')) {
      const memo = findMemo(t.closest('.card').dataset.id);
      return setTaskLine(memo, Number(t.dataset.line));
    }
    const b = t.closest('button, [data-toggle]');
    if (!b) return;
    const ds = b.dataset;
    const memo = (id) => findMemo(id);
    if (ds.copy) copyMemo(memo(ds.copy));
    else if (ds.pinCopy) copyMemo(memo(ds.pinCopy), true);
    else if (ds.restore) restoreMemo(memo(ds.restore));
    else if (ds.toggle) toggleCard(ds.toggle);
    else if (ds.edit) openEditor(ds.edit);
    else if (ds.move) openMove(memo(ds.move));
    else if (ds.pin) togglePin(memo(ds.pin));
    else if (ds.share) shareMemo(memo(ds.share));
    else if (ds.delete) trashMemo(memo(ds.delete));
    else if (ds.show) showMemo(ds.show);
    else if (ds.filter) {
      const same = state.filter.type === ds.filter && state.filter.id === ds.id;
      state.filter = same && ds.filter !== 'all' ? { type: 'all' } : { type: ds.filter, id: ds.id };
      state.expanded = null;
      state.limit = PAGE;
      if (searching()) clearOmni();
      renderAll();
    } else if ('newColl' in ds) newCollSheet();
    else if (ds.editColl) editColl(null, state.colls[ds.editColl]);
    else if (ds.archiveColl) archiveColl(state.colls[ds.archiveColl]);
    else if (ds.delColl) deleteColl(state.colls[ds.delColl]);
    else if ('triage' in ds) openTriage();
    else if ('nextResurface' in ds) { state.resurfaceSkip++; renderToday(); }
    else if ('backup' in ds) exportJson();
    else if ('more' in ds) { state.limit += PAGE; renderStream(); }
    else if ('emptyTrash' in ds) {
      if (confirm('휴지통의 메모를 모두 완전히 지울까요?')) { await purgeMemos(state.memos.filter((m) => m.deletedAt)); renderAll(); }
    }
  });
  $('#stream').addEventListener('keydown', (e) => {
    const head = e.target.closest('.card-head');
    if (!head) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCard(head.dataset.toggle); }
    else if (e.key === 'e') openEditor(head.dataset.toggle);
    else if (e.key === 'c') copyMemo(findMemo(head.dataset.toggle));
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const heads = [...document.querySelectorAll('.card-head')];
      const i = heads.indexOf(head) + (e.key === 'ArrowDown' ? 1 : -1);
      if (i < 0) $('#omni').focus(); else heads[i]?.focus();
    }
  });

  const ed = $('#editor');
  ed.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const ds = b.dataset;
    const m = findMemo(state.editing);
    if ('done' in ds) closeLayer();
    else if (ds.move) { flushSave(); openMove(m); }
    else if ('image' in ds) $('#imageInput').click();
    else if (ds.pin) togglePin(m);
    else if (ds.delete) { flushSave(); trashMemo(m); }
    else if (ds.pick) pickSuggest(ds.pick);
    else if (ds.show) openEditor(ds.show);
  });
  ed.addEventListener('mousedown', (e) => { if (e.target.closest('#suggest')) e.preventDefault(); });
  ed.addEventListener('input', (e) => {
    if (e.target.id === 'body') { onBodyInput(e.target); updateSuggest(e.target); }
    else if (e.target.id === 'source') { findMemo(state.editing).sourceUrl = e.target.value.trim(); scheduleSave(); }
  });
  ed.addEventListener('paste', async (e) => {
    if (e.target.id !== 'body') return;
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    await insertImage(file);
  });
  $('#imageInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await insertImage(file);
  });
  $('#importInput').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) { closeLayer(); await importFiles(files); }
  });

  addEventListener('keydown', (e) => {
    if (layers.length) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
      e.preventDefault();
      $('#omni').focus();
      $('#omni').select();
    }
  });
}

// ── 궁전 보기 ──

let palace = null;

function roomKeyOf(memo) {
  const c = memo.collectionId && state.colls[memo.collectionId];
  if (c && !c.archived) return c.id;
  return memo.para === 'resource' ? 'resource' : 'inbox';
}

function palaceRooms(items) {
  const count = {};
  for (const it of items) count[it.room] = (count[it.room] || 0) + 1;
  const colls = activeColls();
  const byName = (a, b) => a.name.localeCompare(b.name, 'ko');
  return [
    { key: 'inbox', kind: 'inbox', label: '📥 입구' },
    { key: 'resource', kind: 'resource', label: '📚 자료' },
    ...colls.filter((c) => c.kind === 'area').sort(byName).map((c) => ({ key: c.id, kind: 'area', label: `🌱 ${esc(c.name)}` })),
    ...colls.filter((c) => c.kind === 'project').sort(byName).map((c) => ({ key: c.id, kind: 'project', label: `🎯 ${esc(c.name)}${c.deadline ? ` <span class="dday">${dday(c.deadline)}</span>` : ''}` })),
  ].map((r) => ({ ...r, count: count[r.key] || 0 }));
}

async function renderPalace() {
  const el = $('#palace');
  if (!palace) palace = createPalace(el, { onTap: palaceTap, onMove: palaceMove });
  const items = liveItems().filter((it) => paraOf(it.memo, state.colls) !== 'archive')
    .map((it) => {
      const e = entryOf(it.memo.body);
      return {
        id: it.memo.id, room: roomKeyOf(it.memo), keyword: it.d.title,
        desc: e ? e.desc : previewText(it.memo.body, 40), strong: (it.memo.useCount || 0) >= 3, pinned: it.memo.pinned,
      };
    });
  const rooms = palaceRooms(items);
  // 방 자리: 한 번 정하면 그대로
  const cells = assignRooms(rooms.map((r) => r.key), state.roomCells);
  if (rooms.some((r) => !state.roomCells[r.key])) {
    state.roomCells = { ...state.roomCells, ...cells };
    db.setMeta('palaceRooms', state.roomCells);
  }
  // 키워드 자리: 처음 보는 것만 빈 칸에
  const positions = Object.fromEntries(state.memos.filter((m) => m.pos).map((m) => [m.id, m.pos]));
  const fresh = placeNew(items, positions);
  const changed = [];
  for (const [id, pos] of Object.entries(fresh)) {
    const m = findMemo(id);
    m.pos = pos;
    positions[id] = pos;
    changed.push(m);
  }
  if (changed.length) db.putMany('memos', changed);
  sizePalace();
  palace.render({ rooms, items, positions, roomCells: cells });
  highlightPalace(false);
}

function sizePalace() {
  const el = $('#palace');
  if (!state.palaceOn || el.hidden) return;
  el.style.height = Math.max(240, innerHeight - el.getBoundingClientRect().top) + 'px';
}

function highlightPalace(fly = true) {
  if (!palace) return;
  if (!searching()) return palace.highlight(null);
  const items = liveItems().filter((it) => paraOf(it.memo, state.colls) !== 'archive');
  const ids = searchMemos(items, state.input, state.colls).map((h) => h.memo.id);
  if (fly) palace.highlight(ids);
}

function palaceTap(id) {
  const m = findMemo(id);
  if (m) copyMemo(m, true);
}

async function palaceMove(id, roomKey, pos) {
  const m = findMemo(id);
  if (!m || !roomKey) return renderPalace();
  const moved = roomKey !== roomKeyOf(m);
  m.pos = pos;
  if (moved) await moveMemo(m, roomKey === 'inbox' || roomKey === 'resource' ? roomKey : 'c:' + roomKey);
  else await saveMemo(m, false);
  renderPalace();
  if (moved) toast(`${placeName(m)}(으)로 옮겼어요`);
}

function setPalace(on) {
  state.palaceOn = on;
  writePref('palaceOn', on ? '1' : '0');
  document.body.classList.toggle('palace-on', on);
  $('#palace').hidden = !on;
  $('#palaceBtn').setAttribute('aria-pressed', String(on));
  if (on) scrollTo({ top: 0 });
  renderAll();
}

// ── 시작 ──

async function start() {
  const [memos, colls] = await Promise.all([db.all('memos'), db.all('collections')]);
  state.colls = Object.fromEntries(colls.map((c) => [c.id, c]));
  state.lastBackup = await db.getMeta('lastBackup', 0);
  state.roomCells = await db.getMeta('palaceRooms', {});
  state.persisted = await navigator.storage?.persisted?.().catch(() => false);
  state.memos = memos;
  const old = memos.filter((m) => m.deletedAt && Date.now() - m.deletedAt > TRASH_DAYS * DAY);
  if (old.length) await purgeMemos(old);
  state.memos.sort((a, b) => b.updatedAt - a.updatedAt);
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);

  bind();
  setPalace(state.palaceOn);
  if (!isTouch) $('#omni').focus();
  await takeShared();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
