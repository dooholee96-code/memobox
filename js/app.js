import * as db from './db.js';
import {
  PARA_LABEL, uid, normalize, derive, paraOf, searchMemos, backlinks, relatedMemos, tagCounts,
  dday, daysLeft, sharedToMemo, renderMarkdown, escapeHtml, toggleTask, memoToMarkdown, uniqueNames,
  makeZip, markdownToMemo, mergeById, memoTitle,
} from './core.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = escapeHtml;
const DAY = 86400000;
const TRASH_DAYS = 30;
const LIST_PAGE = 150;

const state = {
  memos: [],
  colls: {},
  view: { type: 'all' },
  query: '',
  selected: null,
  mode: 'view',
  limit: LIST_PAGE,
  tagsOpen: false,
  lastBackup: 0,
  persisted: false,
};

const isTouch = matchMedia('(pointer: coarse)').matches;

// ── 메모 파생값 캐시 ──

const cache = new Map();
function dOf(memo) {
  const c = cache.get(memo.id);
  if (c && c.body === memo.body && c.url === memo.sourceUrl) return c.d;
  const d = derive(memo);
  cache.set(memo.id, { body: memo.body, url: memo.sourceUrl, d });
  return d;
}

function liveItems() {
  return state.memos.filter((m) => !m.deletedAt).map((memo) => ({ memo, d: dOf(memo) }));
}

function findMemo(id) {
  return state.memos.find((m) => m.id === id);
}

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
    sourceUrl: '', createdAt: now, updatedAt: now, deletedAt: null, ...fields,
  };
  state.memos.unshift(m);
  await saveMemo(m, false);
  askPersist();
  return m;
}

async function askPersist() {
  if (state.persisted || !navigator.storage?.persist) return;
  state.persisted = await navigator.storage.persist().catch(() => false);
}

function captureFields() {
  const v = state.view;
  if (v.type === 'coll' && state.colls[v.id] && !state.colls[v.id].archived) return { collectionId: v.id };
  if (v.type === 'resource') return { para: 'resource' };
  if (v.type === 'pinned') return { pinned: true };
  return {};
}

function captureLabel() {
  const v = state.view;
  if (v.type === 'coll' && state.colls[v.id] && !state.colls[v.id].archived) return `→ ${state.colls[v.id].name}`;
  if (v.type === 'resource') return '→ 자료';
  if (v.type === 'pinned') return '→ 고정';
  return '→ 받은함';
}

// ── 화면: 사이드바 ──

function viewIs(type, id) {
  return state.view.type === type && (id === undefined || state.view.id === id);
}

function navItem(type, label, count, id) {
  const on = viewIs(type, id) ? ' on' : '';
  const data = id ? ` data-id="${id}"` : '';
  return `<button class="nav${on}" data-view="${type}"${data}><span>${label}</span>${count != null ? `<span class="count">${count}</span>` : ''}</button>`;
}

function renderSide() {
  const items = liveItems();
  const counts = { inbox: 0, resource: 0, archive: 0, project: 0, area: 0, pinned: 0 };
  const byColl = {};
  for (const { memo } of items) {
    counts[paraOf(memo, state.colls)]++;
    if (memo.pinned) counts.pinned++;
    if (memo.collectionId) byColl[memo.collectionId] = (byColl[memo.collectionId] || 0) + 1;
  }
  const colls = Object.values(state.colls).filter((c) => !c.archived);
  const projects = colls.filter((c) => c.kind === 'project')
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.name.localeCompare(b.name, 'ko'));
  const areas = colls.filter((c) => c.kind === 'area').sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const tags = tagCounts(items.filter((it) => paraOf(it.memo, state.colls) !== 'archive'));
  const shownTags = state.tagsOpen ? tags : tags.slice(0, 24);
  const trash = state.memos.filter((m) => m.deletedAt).length;

  const proj = projects.map((c) => {
    const left = daysLeft(c.deadline);
    const warn = left !== null && left <= 3 ? ' warn' : '';
    const label = `${esc(c.name)}${c.deadline ? ` <small class="dday${warn}">${dday(c.deadline)}</small>` : ''}`;
    return navItem('coll', label, byColl[c.id] || 0, c.id);
  }).join('');
  const area = areas.map((c) => navItem('coll', esc(c.name), byColl[c.id] || 0, c.id)).join('');

  $('#side').innerHTML = `
    <div class="brand">메모함</div>
    ${navItem('all', '🗂 전체', items.length - counts.archive)}
    ${navItem('pinned', '📌 고정', counts.pinned)}
    ${navItem('inbox', '📥 받은함', counts.inbox)}
    <div class="group"><span>🎯 프로젝트</span><button class="mini" data-add="project" aria-label="프로젝트 추가">＋</button></div>
    ${proj || '<p class="hint">마감이 있는 일</p>'}
    <div class="group"><span>🌱 영역</span><button class="mini" data-add="area" aria-label="영역 추가">＋</button></div>
    ${area || '<p class="hint">계속 챙기는 분야</p>'}
    ${navItem('resource', '📚 자료', counts.resource)}
    ${navItem('archive', '🗄 보관', counts.archive)}
    <div class="group"><span># 태그</span></div>
    <div class="tags">${shownTags.map(([t, n]) => `<button class="tag-chip" data-tag="${esc(t)}">#${esc(t)} <small>${n}</small></button>`).join('') || '<p class="hint">본문에 #태그 를 쓰면 생겨요</p>'}
    ${tags.length > 24 ? `<button class="link-btn" data-more-tags>${state.tagsOpen ? '접기' : `더 보기 (${tags.length})`}</button>` : ''}</div>
    <div class="side-foot">
      ${navItem('trash', '🗑 휴지통', trash)}
      <button class="nav" data-settings><span>⚙️ 백업·설정</span></button>
    </div>`;
}

// ── 화면: 목록 ──

function viewItems() {
  const v = state.view;
  const searching = state.query.trim() !== '';
  let items;
  if (v.type === 'trash') {
    items = state.memos.filter((m) => m.deletedAt).map((memo) => ({ memo, d: dOf(memo) }));
  } else {
    items = liveItems().filter(({ memo }) => {
      const p = paraOf(memo, state.colls);
      switch (v.type) {
        case 'all': return searching || p !== 'archive';
        case 'pinned': return memo.pinned;
        case 'coll': return memo.collectionId === v.id;
        default: return p === v.type;
      }
    });
  }
  return searchMemos(items, state.query);
}

function fmtTime(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toTimeString().slice(0, 5);
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

function preview(body) {
  const rest = body.split('\n').slice(1).join(' ');
  return rest.replace(/!\[[^\]]*\]\([^)]*\)/g, '🖼').replace(/[#>*`~=[\]-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function badge(memo) {
  const p = paraOf(memo, state.colls);
  const c = memo.collectionId && state.colls[memo.collectionId];
  const text = c ? c.name : PARA_LABEL[p];
  return `<span class="badge b-${p}">${esc(text)}</span>`;
}

function renderList() {
  const hits = viewItems();
  const shown = hits.slice(0, state.limit);
  const trash = state.view.type === 'trash';
  $('#list').innerHTML = shown.map(({ memo, d }) => `
    <li class="card${memo.id === state.selected ? ' on' : ''}" data-id="${memo.id}">
      <div class="card-main">
        <div class="card-title">${memo.pinned ? '📌 ' : ''}${esc(d.title)}</div>
        ${preview(memo.body) ? `<div class="card-snip">${esc(preview(memo.body))}</div>` : ''}
        <div class="card-meta">${badge(memo)}${d.tags.slice(0, 4).map((t) => `<span class="t">#${esc(t)}</span>`).join('')}
          ${memo.sourceUrl ? `<span class="host">🔗 ${esc(hostOf(memo.sourceUrl))}</span>` : ''}
          <span class="time">${fmtTime(memo.updatedAt)}</span></div>
      </div>
      ${trash
        ? `<button class="card-btn" data-restore="${memo.id}">되살리기</button>`
        : `<button class="card-btn" data-copy="${memo.id}" aria-label="복사">복사</button>`}
    </li>`).join('') || `<li class="empty">${emptyText()}</li>`;
  if (hits.length > shown.length) {
    $('#list').insertAdjacentHTML('beforeend', `<li class="more"><button class="link-btn" data-more>더 보기 (${hits.length - shown.length})</button></li>`);
  }
  $('#captureTarget').textContent = captureLabel();
  document.querySelector('.capture').hidden = trash || state.view.type === 'archive';
}

function emptyText() {
  if (state.query.trim()) return '찾는 메모가 없어요.';
  switch (state.view.type) {
    case 'pinned': return '자주 복사하는 글(계좌번호, 주소, 인사말…)을 고정해 두세요.';
    case 'inbox': return '받은함이 비었어요. 정리 끝! 🎉';
    case 'trash': return '휴지통이 비었어요.';
    case 'archive': return '끝난 프로젝트와 보관한 메모가 여기에 모여요.';
    default: return '위 칸에 첫 메모를 적어 보세요.';
  }
}

function renderViewHead() {
  const v = state.view;
  const el = $('#viewHead');
  if (v.type === 'coll') {
    const c = state.colls[v.id];
    if (!c) { el.innerHTML = ''; return; }
    const area = c.areaId && state.colls[c.areaId];
    const projects = c.kind === 'area'
      ? Object.values(state.colls).filter((p) => p.kind === 'project' && p.areaId === c.id && !p.archived) : [];
    el.innerHTML = `
      <div class="vh-title">${c.kind === 'project' ? '🎯' : '🌱'} ${esc(c.name)}
        ${c.deadline ? `<span class="dday">${dday(c.deadline)} · ${c.deadline}</span>` : ''}
        ${c.archived ? '<span class="badge b-archive">보관됨</span>' : ''}</div>
      ${area ? `<div class="muted small">영역: <button class="link-btn" data-open-coll="${area.id}">${esc(area.name)}</button></div>` : ''}
      ${c.note ? `<div class="vh-note">${esc(c.note)}</div>` : ''}
      ${projects.length ? `<div class="muted small">진행 중인 프로젝트: ${projects.map((p) => `<button class="link-btn" data-open-coll="${p.id}">${esc(p.name)}</button>`).join(' · ')}</div>` : ''}
      <div class="vh-actions">
        <button class="chip-btn" data-edit-coll="${c.id}">수정</button>
        ${c.kind === 'project' ? `<button class="chip-btn" data-archive-coll="${c.id}">${c.archived ? '되살리기' : '✅ 끝냄 → 보관'}</button>` : ''}
        <button class="chip-btn danger" data-del-coll="${c.id}">삭제</button>
      </div>`;
  } else if (v.type === 'archive') {
    const done = Object.values(state.colls).filter((c) => c.archived);
    el.innerHTML = `<div class="vh-title">🗄 보관</div>
      ${done.length ? `<div class="muted small">끝난 프로젝트: ${done.map((c) => `<button class="link-btn" data-open-coll="${c.id}">${esc(c.name)}</button>`).join(' · ')}</div>` : ''}`;
  } else if (v.type === 'trash') {
    el.innerHTML = `<div class="vh-title">🗑 휴지통</div><div class="muted small">${TRASH_DAYS}일이 지나면 완전히 지워져요.</div>
      ${state.memos.some((m) => m.deletedAt) ? '<div class="vh-actions"><button class="chip-btn danger" data-empty-trash>휴지통 비우기</button></div>' : ''}`;
  } else {
    const titles = { all: '🗂 전체', pinned: '📌 고정', inbox: '📥 받은함', resource: '📚 자료' };
    const tips = {
      inbox: '일단 넣어 두고, 나중에 프로젝트·영역·자료로 옮겨요.',
      resource: '언젠가 쓸 정보. 태그로 찾아요.',
      pinned: '복사 버튼은 둘째 줄부터 복사해요(첫 줄은 이름).',
    };
    el.innerHTML = `<div class="vh-title">${titles[v.type] || ''}</div>${tips[v.type] ? `<div class="muted small">${tips[v.type]}</div>` : ''}`;
  }
}

function renderBanner() {
  const live = state.memos.filter((m) => !m.deletedAt).length;
  const days = state.lastBackup ? Math.floor((Date.now() - state.lastBackup) / DAY) : null;
  const need = live >= 5 && (days === null || days >= 7);
  $('#banner').innerHTML = need
    ? `<div class="banner">💾 ${days === null ? '아직 백업한 적이 없어요.' : `마지막 백업 ${days}일 전.`} 메모는 이 기기에만 있어요.
        <button class="link-btn" data-backup>지금 백업</button></div>`
    : '';
}

// ── 화면: 메모 편집 ──

function placeOptions(memo) {
  const opt = (value, label) => `<option value="${value}"${value === currentPlace(memo) ? ' selected' : ''}>${label}</option>`;
  const colls = Object.values(state.colls).filter((c) => !c.archived || c.id === memo.collectionId);
  const group = (kind, label) => {
    const list = colls.filter((c) => c.kind === kind).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return list.length ? `<optgroup label="${label}">${list.map((c) => opt('c:' + c.id, esc(c.name) + (c.archived ? ' (보관됨)' : ''))).join('')}</optgroup>` : '';
  };
  return opt('inbox', '📥 받은함') + opt('resource', '📚 자료') + group('project', '🎯 프로젝트') + group('area', '🌱 영역');
}

function currentPlace(memo) {
  if (memo.collectionId && state.colls[memo.collectionId]) return 'c:' + memo.collectionId;
  return memo.para === 'resource' ? 'resource' : 'inbox';
}

function renderEditor({ soft = false } = {}) {
  const el = $('#editor');
  const memo = state.selected && findMemo(state.selected);
  // 입력 중인 칸을 다시 그리면 커서가 사라지므로 건너뜀
  const ta = document.activeElement;
  if (soft && memo && ta?.id === 'body' && ta.dataset.id === memo.id) return;
  document.getElementById('app').classList.toggle('editing', !!memo);
  if (!memo) {
    el.innerHTML = `<div class="ed-empty">
      <h2>메모함 쓰는 법</h2>
      <ul>
        <li><b>첫 줄</b>이 제목이에요.</li>
        <li><code>#태그</code> 로 분류하고, <code>[[다른 메모 제목]]</code> 으로 메모끼리 이어요. 이어진 메모에는 ‘이 메모를 가리키는 메모’가 자동으로 보여요.</li>
        <li>검색: 낱말 여러 개(모두 포함), <code>#태그</code>, <code>-빼기</code>, 초성 <code>ㅁㅅ</code></li>
        <li>📌 고정한 메모는 목록 맨 위. <b>복사</b> 버튼은 둘째 줄부터 복사해요.</li>
        <li>PARA: <b>프로젝트</b>(마감 있음) · <b>영역</b>(계속 챙김) · <b>자료</b>(언젠가 쓸 것) · <b>보관</b>(끝난 것)</li>
        <li>단축키: <kbd>/</kbd> 검색, <kbd>Alt</kbd>+<kbd>N</kbd> 새 메모, <kbd>Esc</kbd> 닫기</li>
      </ul></div>`;
    return;
  }
  const d = dOf(memo);
  const trash = !!memo.deletedAt;
  const editing = state.mode === 'edit' && !trash;
  el.innerHTML = `
    <div class="ed-top">
      <button class="icon-btn" data-close aria-label="닫기">←</button>
      <div class="ed-tools">
        ${trash ? `<button class="chip-btn" data-restore="${memo.id}">되살리기</button>
                   <button class="chip-btn danger" data-purge="${memo.id}">완전히 지우기</button>` : `
        <button class="chip-btn" data-mode>${editing ? '👁 보기' : '✏️ 편집'}</button>
        <button class="chip-btn${memo.pinned ? ' on' : ''}" data-pin title="목록 맨 위에 고정">📌</button>
        <button class="chip-btn" data-copy="${memo.id}" title="복사">📋</button>
        <button class="chip-btn" data-image title="이미지 넣기">🖼</button>
        <button class="chip-btn" data-share title="다른 앱으로 보내기">↗</button>
        <button class="chip-btn${memo.archived ? ' on' : ''}" data-archive title="보관">🗄</button>
        <button class="chip-btn danger" data-delete title="휴지통">🗑</button>`}
      </div>
    </div>
    ${trash ? '' : `<div class="ed-meta">
      <select id="place" aria-label="위치">${placeOptions(memo)}</select>
      <input id="source" type="url" placeholder="출처 링크 (선택)" value="${esc(memo.sourceUrl || '')}" inputmode="url">
    </div>`}
    ${editing
      ? `<textarea id="body" class="ed-body" data-id="${memo.id}" placeholder="첫 줄은 제목&#10;&#10;#태그  [[다른 메모]]  - [ ] 할 일">${esc(memo.body)}</textarea>
         <div id="suggest" class="suggest" hidden></div>`
      : `<article id="view" class="md">${renderMarkdown(memo.body, { hasTitle: (t) => titleMap().has(normalize(t)) }) || '<p class="muted">빈 메모</p>'}</article>`}
    ${memo.sourceUrl && !editing ? `<a class="source" href="${esc(memo.sourceUrl)}" target="_blank" rel="noopener">🔗 ${esc(memo.sourceUrl)}</a>` : ''}
    ${renderConnections(memo, d)}
    <div class="ed-foot muted small">만든 날 ${new Date(memo.createdAt).toLocaleString('ko-KR')} · 고친 날 ${new Date(memo.updatedAt).toLocaleString('ko-KR')}</div>`;
  if (editing) {
    const ta = $('#body');
    autoGrow(ta);
    if (!memo.body) ta.focus();
  } else {
    fillImages($('#view'));
  }
}

function renderConnections(memo, d) {
  if (memo.deletedAt) return '';
  const items = liveItems();
  const self = { memo, d };
  const back = backlinks(items, self);
  const related = relatedMemos(items, self).filter((r) => !back.some((b) => b.memo.id === r.memo.id));
  const li = (it) => `<li><button class="link-btn" data-open="${it.memo.id}">${esc(it.d.title)}</button></li>`;
  return `
    ${back.length ? `<section class="conn"><h3>↩ 이 메모를 가리키는 메모 ${back.length}</h3><ul>${back.map(li).join('')}</ul></section>` : ''}
    ${related.length ? `<section class="conn"><h3>🏷 태그가 겹치는 메모</h3><ul>${related.map(li).join('')}</ul></section>` : ''}`;
}

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.max(ta.scrollHeight, 240) + 'px';
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

function renderAll() {
  renderSide();
  renderViewHead();
  renderList();
  renderBanner();
  renderEditor({ soft: true });
}

let listTimer;
function renderListSoon() {
  clearTimeout(listTimer);
  listTimer = setTimeout(() => { renderList(); renderSide(); }, 250);
}

// ── 열기·닫기 (주소의 #/m/ID로 뒤로 가기 지원) ──

let pushedHash = false;

function openMemo(id, mode = 'view') {
  flushSave();
  state.selected = id;
  state.mode = mode;
  const target = '#/m/' + id;
  if (location.hash !== target) {
    if (location.hash.startsWith('#/m/')) history.replaceState(null, '', target);
    else { history.pushState(null, '', target); pushedHash = true; }
  }
  closeSide();
  renderList();
  renderEditor();
  if (isTouch || innerWidth < 900) scrollTo(0, 0);
}

function closeMemo() {
  flushSave();
  dropIfEmpty();
  state.selected = null;
  if (location.hash.startsWith('#/m/')) {
    if (pushedHash) { pushedHash = false; history.back(); }
    else history.replaceState(null, '', location.pathname + location.search);
  }
  renderList();
  renderEditor();
}

function dropIfEmpty() {
  const m = state.selected && findMemo(state.selected);
  if (m && !m.body.trim() && !m.deletedAt) {
    state.memos = state.memos.filter((x) => x.id !== m.id);
    db.del('memos', m.id);
  }
}

addEventListener('popstate', () => {
  const m = location.hash.match(/^#\/m\/(.+)$/);
  const id = m && findMemo(m[1]) ? m[1] : null;
  if (id === state.selected) return;
  flushSave();
  if (!id) dropIfEmpty();
  pushedHash = false;
  state.selected = id;
  state.mode = 'view';
  renderList();
  renderEditor();
});

function setView(view) {
  flushSave();
  state.view = view;
  state.limit = LIST_PAGE;
  closeSide();
  renderSide();
  renderViewHead();
  renderList();
}

function openSide() { document.getElementById('app').classList.add('side-open'); }
function closeSide() { document.getElementById('app').classList.remove('side-open'); }

// ── 자동 저장 ──

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 500);
}

function flushSave() {
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const m = state.selected && findMemo(state.selected);
  if (m) saveMemo(m);
}

addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
addEventListener('pagehide', flushSave);

// ── 복사·토스트 ──

function copyText(memo) {
  const lines = memo.body.split('\n');
  const rest = lines.slice(1).join('\n').trim();
  return rest || lines[0].replace(/^#{1,6}\s+/, '');
}

async function copyMemo(memo) {
  try {
    await navigator.clipboard.writeText(copyText(memo));
    toast('복사했어요');
  } catch {
    toast('복사하지 못했어요. 메모를 열어 직접 선택해 주세요.');
  }
}

let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = esc(msg) + (action ? ` <button class="link-btn">${esc(action.label)}</button>` : '');
  if (action) el.querySelector('button').onclick = () => { action.fn(); el.classList.remove('show'); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2200);
}

// ── 메모 동작 ──

async function trashMemo(memo) {
  memo.deletedAt = Date.now();
  await saveMemo(memo, false);
  if (state.selected === memo.id) closeMemo();
  renderAll();
  toast('휴지통으로 옮겼어요', {
    label: '되돌리기',
    fn: async () => { memo.deletedAt = null; await saveMemo(memo, false); renderAll(); },
  });
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
  if (ids.has(state.selected)) state.selected = null;
}

async function quickSave() {
  const ta = $('#quick');
  const text = ta.value.trim();
  if (!text) return;
  const shared = /^https?:\/\/\S+$/.test(text) ? sharedToMemo({ url: text }) : { body: text, sourceUrl: '' };
  await createMemo({ ...shared, ...captureFields() });
  ta.value = '';
  autoGrowQuick();
  renderAll();
  toast('저장했어요');
}

function autoGrowQuick() {
  const ta = $('#quick');
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 220) + 'px';
}

async function newMemo(body = '') {
  const m = await createMemo({ body, ...captureFields() });
  renderSide();
  openMemo(m.id, 'edit');
}

async function openOrCreateLink(title) {
  const m = titleMap().get(normalize(title));
  if (m) return openMemo(m.id);
  if (confirm(`'${title}' 메모가 아직 없어요. 새로 만들까요?`)) {
    const n = await createMemo({ body: `# ${title}\n\n` });
    renderSide();
    openMemo(n.id, 'edit');
  }
}

// ── 이미지 (줄여서 이 기기에 저장) ──

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

async function addImageToMemo(memo, file) {
  const id = await storeImage(file);
  const ta = $('#body');
  const snippet = `\n![](img:${id})\n`;
  if (ta) {
    const at = ta.selectionStart ?? ta.value.length;
    memo.body = ta.value.slice(0, at) + snippet + ta.value.slice(at);
  } else {
    memo.body += snippet;
  }
  await saveMemo(memo);
  renderEditor();
  renderListSoon();
}

// ── [[링크]] · #태그 자동완성 ──

function updateSuggest(ta) {
  const box = $('#suggest');
  if (!box) return;
  const before = ta.value.slice(0, ta.selectionStart);
  let m, items = [], kind;
  if ((m = before.match(/\[\[([^\]\n]*)$/))) {
    kind = 'link';
    const q = normalize(m[1]);
    items = liveItems().filter((it) => it.memo.id !== state.selected && it.d.key.includes(q))
      .sort((a, b) => b.memo.updatedAt - a.memo.updatedAt).slice(0, 7).map((it) => it.d.title);
  } else if ((m = before.match(/(?:^|\s)#([\p{L}\p{N}_\-/]+)$/u))) {
    kind = 'tag';
    const q = normalize(m[1]);
    items = tagCounts(liveItems()).map(([t]) => t).filter((t) => normalize(t).startsWith(q) && normalize(t) !== q).slice(0, 7);
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

function onBodyInput(ta) {
  const m = findMemo(state.selected);
  if (!m) return;
  m.body = ta.value;
  m.updatedAt = Date.now();
  autoGrow(ta);
  scheduleSave();
  renderListSoon();
}

// ── 프로젝트·영역 ──

function openDialog(html, onSubmit) {
  const dlg = $('#dlg');
  dlg.innerHTML = `<form method="dialog" class="dlg">${html}</form>`;
  const form = dlg.querySelector('form');
  form.addEventListener('submit', async (e) => {
    if (e.submitter?.value === 'cancel') return;
    if (onSubmit) {
      e.preventDefault();
      const ok = await onSubmit(new FormData(form), form);
      if (ok !== false) dlg.close();
    }
  });
  dlg.showModal();
  return dlg;
}

function editColl(kind, existing) {
  const c = existing || { id: uid(), kind, name: '', deadline: '', areaId: '', note: '', archived: false, createdAt: Date.now() };
  const areas = Object.values(state.colls).filter((a) => a.kind === 'area' && !a.archived);
  const isProject = c.kind === 'project';
  openDialog(`
    <h2>${existing ? '수정' : '새'} ${isProject ? '🎯 프로젝트' : '🌱 영역'}</h2>
    <p class="muted small">${isProject
      ? '끝나는 날이 있는 일. 끝내면 메모가 통째로 ‘보관’으로 가요. 예) 2027 임용 2차 준비, 이사'
      : '끝이 없이 계속 챙기는 분야. 예) 수업, 건강, 돈 관리, 집'}</p>
    <label>이름<input name="name" required value="${esc(c.name)}" autocomplete="off"></label>
    ${isProject ? `
      <label>마감일<input name="deadline" type="date" value="${esc(c.deadline || '')}"></label>
      <label>속한 영역<select name="areaId"><option value="">(없음)</option>
        ${areas.map((a) => `<option value="${a.id}"${a.id === c.areaId ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : ''}
    <label>설명<textarea name="note" rows="2">${esc(c.note || '')}</textarea></label>
    <div class="dlg-actions"><button value="cancel" formnovalidate class="chip-btn">취소</button><button class="primary-btn" value="ok">저장</button></div>`,
  async (fd) => {
    c.name = fd.get('name').trim();
    if (!c.name) return false;
    c.note = (fd.get('note') || '').trim();
    if (isProject) { c.deadline = fd.get('deadline') || ''; c.areaId = fd.get('areaId') || ''; }
    state.colls[c.id] = c;
    await db.put('collections', c);
    if (!existing) setView({ type: 'coll', id: c.id });
    else renderAll();
  });
}

async function archiveColl(c) {
  c.archived = !c.archived;
  await db.put('collections', c);
  renderAll();
  toast(c.archived ? `‘${c.name}’ 끝! 메모는 보관으로 옮겼어요` : '되살렸어요');
}

async function deleteColl(c) {
  const n = state.memos.filter((m) => m.collectionId === c.id).length;
  if (!confirm(`‘${c.name}’을(를) 지울까요?${n ? `\n안의 메모 ${n}개는 받은함으로 옮겨요.` : ''}`)) return;
  for (const m of state.memos) {
    if (m.collectionId === c.id) { m.collectionId = null; await saveMemo(m, false); }
  }
  for (const p of Object.values(state.colls)) {
    if (p.areaId === c.id) { p.areaId = ''; await db.put('collections', p); }
  }
  delete state.colls[c.id];
  await db.del('collections', c.id);
  setView({ type: 'inbox' });
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
    try {
      await navigator.share({ files: [file], title: name });
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
    }
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
  const ok = await deliver(`메모함-백업-${stamp()}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
  if (ok) { await markBackedUp(); toast('백업 파일을 만들었어요'); }
}

async function exportMarkdown() {
  const live = state.memos.filter((m) => !m.deletedAt);
  const images = await db.all('images');
  const ext = {};
  const files = [];
  for (const img of images) {
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
  const zip = makeZip(files);
  const ok = await deliver(`메모함-마크다운-${stamp()}.zip`, new Blob([zip], { type: 'application/zip' }));
  if (ok) { await markBackedUp(); toast('마크다운 ZIP을 만들었어요 (옵시디언에서 열 수 있어요)'); }
}

function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

async function importFiles(files) {
  let added = 0, updated = 0, collsAdded = 0;
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
      collsAdded += mc.added;
      state.colls = Object.fromEntries(mc.list.map((c) => [c.id, c]));
      await db.putMany('collections', mc.list);
      for (const img of data.images || []) {
        if (!(await db.get('images', img.id))) await db.put('images', { id: img.id, type: img.type, createdAt: img.createdAt, blob: base64ToBlob(img.data, img.type) });
      }
    } else {
      const m = markdownToMemo(text, f.name);
      await createMemo(m);
      added++;
    }
  }
  renderAll();
  toast(`가져왔어요: 새 메모 ${added}개${updated ? `, 바뀐 메모 ${updated}개` : ''}${collsAdded ? `, 프로젝트·영역 ${collsAdded}개` : ''}`);
}

async function openSettings() {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const used = est ? `${(est.usage / 1048576).toFixed(1)}MB 사용 중` : '';
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const appUrl = location.origin + location.pathname;
  const bookmarklet = `javascript:(()=>{const s=String(getSelection());window.open(${JSON.stringify(appUrl)}+'?title='+encodeURIComponent(document.title)+'&url='+encodeURIComponent(location.href)+'&text='+encodeURIComponent(s))})()`;
  const dlg = openDialog(`
    <h2>⚙️ 백업·설정</h2>
    <section>
      <h3>💾 백업</h3>
      <p class="muted small">메모는 이 기기 브라우저 안에만 있어요. 가끔 백업 파일을 구글 드라이브 등에 올려 두세요.
      ${state.lastBackup ? `마지막 백업: ${new Date(state.lastBackup).toLocaleString('ko-KR')}` : '아직 백업한 적이 없어요.'}</p>
      <div class="row"><button type="button" class="primary-btn" data-act="json">전체 백업 (JSON)</button>
      <button type="button" class="chip-btn" data-act="md">마크다운 ZIP (옵시디언용)</button></div>
    </section>
    <section>
      <h3>📥 가져오기</h3>
      <p class="muted small">백업 JSON(같은 메모는 더 최근 것으로), 또는 .md 파일 여러 개(옵시디언 노트 등)를 고르세요. 다른 기기로 옮길 때도 이걸 써요.</p>
      <button type="button" class="chip-btn" data-act="import">파일 고르기</button>
    </section>
    <section>
      <h3>🔗 다른 곳에서 바로 저장</h3>
      <p class="small"><b>PC 크롬</b>: 아래 버튼을 북마크바로 끌어다 놓으세요. 아무 페이지에서 누르면 제목·주소(+선택한 글)가 메모로 저장돼요.<br>
      <a class="chip-btn" href="${esc(bookmarklet)}" onclick="return false">📎 메모함에 담기</a></p>
      <p class="small"><b>안드로이드</b>: 크롬 메뉴 → ‘홈 화면에 추가(앱 설치)’ 하면 공유 메뉴에 ‘메모함’이 생겨요.</p>
      <p class="small"><b>아이폰</b>: 사파리 공유 → ‘홈 화면에 추가’. 공유 메뉴에 넣으려면 README의 ‘단축어 만들기’를 따라 하세요. 이 주소를 쓰면 돼요:<br><code class="url">${esc(appUrl)}?text=</code></p>
    </section>
    <section>
      <h3>📦 저장 공간</h3>
      <p class="muted small">${used} · ${persisted ? '✅ 브라우저가 지우지 않도록 보호됨' : '⚠️ 보호 안 됨 — 앱을 홈 화면에 설치하면 더 안전해요'}</p>
    </section>
    <div class="dlg-actions"><button value="cancel" class="chip-btn">닫기</button></div>`);
  dlg.querySelector('[data-act="json"]').onclick = exportJson;
  dlg.querySelector('[data-act="md"]').onclick = exportMarkdown;
  dlg.querySelector('[data-act="import"]').onclick = () => $('#importInput').click();
}

// ── 공유로 들어온 것 (?title=&text=&url=) ──

async function takeShared() {
  const p = new URLSearchParams(location.search);
  if (p.has('new')) {
    history.replaceState(null, '', location.pathname);
    return newMemo();
  }
  if (!['title', 'text', 'url'].some((k) => p.get(k))) return;
  const shared = sharedToMemo({ title: p.get('title') || '', text: p.get('text') || '', url: p.get('url') || '' });
  history.replaceState(null, '', location.pathname);
  const m = await createMemo({ ...shared });
  renderAll();
  openMemo(m.id, 'edit');
  toast('받은함에 저장했어요');
}

// ── 이벤트 ──

function bind() {
  $('#menuBtn').onclick = openSide;
  $('#scrim').onclick = closeSide;

  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = e.target.value; state.limit = LIST_PAGE; renderList(); }, 80);
  });

  const quick = $('#quick');
  quick.addEventListener('input', autoGrowQuick);
  quick.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isTouch) { e.preventDefault(); quickSave(); }
  });
  quick.addEventListener('paste', async (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    const id = await storeImage(file);
    const text = quick.value.trim();
    await createMemo({ body: `${text || '# 붙여넣은 이미지'}\n\n![](img:${id})`, ...captureFields() });
    quick.value = '';
    renderAll();
    toast('이미지를 저장했어요');
  });
  $('#saveQuickBtn').onclick = quickSave;
  $('#pasteBtn').onclick = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t) return toast('클립보드가 비었어요');
      quick.value = quick.value ? quick.value + '\n' + t : t;
      autoGrowQuick();
      quick.focus();
    } catch {
      quick.focus();
      toast('입력칸을 길게 눌러 붙여넣어 주세요');
    }
  };

  $('#side').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.view) setView({ type: b.dataset.view, id: b.dataset.id });
    else if (b.dataset.add) editColl(b.dataset.add);
    else if (b.dataset.tag) { setTag(b.dataset.tag); closeSide(); }
    else if ('moreTags' in b.dataset) { state.tagsOpen = !state.tagsOpen; renderSide(); }
    else if ('settings' in b.dataset) { closeSide(); openSettings(); }
  });

  document.querySelector('.list-pane').addEventListener('click', async (e) => {
    const b = e.target.closest('button, .card');
    if (!b) return;
    const ds = b.dataset;
    if (ds.copy) { e.stopPropagation(); copyMemo(findMemo(ds.copy)); }
    else if (ds.restore) { e.stopPropagation(); restoreMemo(findMemo(ds.restore)); }
    else if ('more' in ds) { state.limit += LIST_PAGE; renderList(); }
    else if ('backup' in ds) exportJson();
    else if (ds.openColl) setView({ type: 'coll', id: ds.openColl });
    else if (ds.editColl) editColl(null, state.colls[ds.editColl]);
    else if (ds.archiveColl) archiveColl(state.colls[ds.archiveColl]);
    else if (ds.delColl) deleteColl(state.colls[ds.delColl]);
    else if ('emptyTrash' in ds) {
      if (confirm('휴지통의 메모를 모두 완전히 지울까요?')) { await purgeMemos(state.memos.filter((m) => m.deletedAt)); renderAll(); }
    } else if (b.classList.contains('card')) openMemo(ds.id);
  });

  const ed = $('#editor');
  ed.addEventListener('click', async (e) => {
    const memo = findMemo(state.selected);
    const t = e.target;
    const link = t.closest('.wikilink');
    if (link) { e.preventDefault(); return openOrCreateLink(link.dataset.link); }
    const tag = t.closest('a.tag');
    if (tag) { e.preventDefault(); return setTag(tag.dataset.tag); }
    const b = t.closest('button');
    if (!b || !memo) return;
    const ds = b.dataset;
    if ('close' in ds) closeMemo();
    else if ('mode' in ds) { flushSave(); state.mode = state.mode === 'edit' ? 'view' : 'edit'; renderEditor(); }
    else if ('pin' in ds) { memo.pinned = !memo.pinned; await saveMemo(memo, false); renderAll(); }
    else if (ds.copy) copyMemo(memo);
    else if ('image' in ds) $('#imageInput').click();
    else if ('share' in ds) {
      const text = memo.body + (memo.sourceUrl && !memo.body.includes(memo.sourceUrl) ? '\n\n' + memo.sourceUrl : '');
      if (navigator.share) navigator.share({ title: dOf(memo).title, text }).catch(() => {});
      else { await navigator.clipboard.writeText(text).catch(() => {}); toast('전체 내용을 복사했어요'); }
    } else if ('archive' in ds) {
      memo.archived = !memo.archived;
      await saveMemo(memo, false);
      renderAll();
      toast(memo.archived ? '보관했어요' : '보관을 풀었어요');
    } else if ('delete' in ds) trashMemo(memo);
    else if (ds.restore) restoreMemo(memo);
    else if (ds.purge) {
      if (confirm('완전히 지울까요? 되돌릴 수 없어요.')) { await purgeMemos([memo]); closeMemo(); renderAll(); }
    } else if (ds.open) openMemo(ds.open);
    else if (ds.pick) pickSuggest(ds.pick);
  });
  ed.addEventListener('mousedown', (e) => { if (e.target.closest('#suggest')) e.preventDefault(); });
  ed.addEventListener('dblclick', (e) => {
    if (e.target.closest('#view') && !e.target.closest('a, input')) { state.mode = 'edit'; renderEditor(); }
  });
  ed.addEventListener('input', (e) => {
    if (e.target.id === 'body') { onBodyInput(e.target); updateSuggest(e.target); }
    else if (e.target.id === 'source') {
      const m = findMemo(state.selected);
      m.sourceUrl = e.target.value.trim();
      scheduleSave();
    }
  });
  ed.addEventListener('keyup', (e) => {
    if (e.target.id === 'body' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) updateSuggest(e.target);
  });
  ed.addEventListener('change', async (e) => {
    const memo = findMemo(state.selected);
    if (!memo) return;
    if (e.target.id === 'place') {
      const v = e.target.value;
      if (v.startsWith('c:')) memo.collectionId = v.slice(2);
      else { memo.collectionId = null; memo.para = v; }
      await saveMemo(memo, false);
      renderSide();
      renderList();
      toast(`${e.target.selectedOptions[0].textContent.trim()}(으)로 옮겼어요`);
    } else if (e.target.matches('input[type="checkbox"][data-line]')) {
      memo.body = toggleTask(memo.body, Number(e.target.dataset.line));
      await saveMemo(memo);
      renderEditor();
      renderListSoon();
    }
  });
  ed.addEventListener('paste', async (e) => {
    if (e.target.id !== 'body') return;
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    onBodyInput(e.target);
    await addImageToMemo(findMemo(state.selected), file);
    state.mode = 'edit';
  });

  $('#imageInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    const memo = findMemo(state.selected);
    if (!file || !memo) return;
    const ta = $('#body');
    if (ta) onBodyInput(ta);
    flushSave();
    await addImageToMemo(memo, file);
  });
  $('#importInput').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    $('#dlg').close();
    if (files.length) await importFiles(files);
  });

  addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
      e.preventDefault();
      $('#search').focus();
      $('#search').select();
    } else if (e.altKey && e.code === 'KeyN') {
      e.preventDefault();
      newMemo();
    } else if (e.key === 'Escape' && !$('#dlg').open) {
      if (document.activeElement?.id === 'search' && state.query) {
        $('#search').value = ''; state.query = ''; renderList();
      } else if (state.selected) closeMemo();
      else closeSide();
    }
  });
}

function setTag(tag) {
  flushSave();
  state.query = '#' + tag;
  $('#search').value = state.query;
  if (state.view.type !== 'all') state.view = { type: 'all' };
  state.limit = LIST_PAGE;
  if (state.selected && innerWidth < 900) closeMemo();
  renderSide();
  renderViewHead();
  renderList();
}

// ── 시작 ──

async function start() {
  const [memos, colls] = await Promise.all([db.all('memos'), db.all('collections')]);
  state.colls = Object.fromEntries(colls.map((c) => [c.id, c]));
  state.lastBackup = await db.getMeta('lastBackup', 0);
  state.persisted = await navigator.storage?.persisted?.().catch(() => false);
  const old = memos.filter((m) => m.deletedAt && Date.now() - m.deletedAt > TRASH_DAYS * DAY);
  state.memos = memos;
  if (old.length) await purgeMemos(old);
  state.memos.sort((a, b) => b.updatedAt - a.updatedAt);

  bind();
  const m = location.hash.match(/^#\/m\/(.+)$/);
  if (m && findMemo(m[1])) state.selected = m[1];
  renderAll();
  await takeShared();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
