// 호기심의 방(cabinet of curiosities) = 글자 지도.
// 큰 종이 한 장에 진열장(자료·영역·프로젝트)과 미분류 상자(받은함)가 놓이고, 선반 위에 표본(키워드)이 글자로 놓인다.
// 멀리서는 진열장 이름판만, 다가가면 표본 이름, 더 다가가면 이름표(설명)까지 (확대 단계마다 보이는 글자가 다름).
// 끌어서 이동, 두 손가락·휠로 확대. 표본 자리는 한 번 정하면 앱이 다시 섞지 않는다(장소법).
// 선반·이름판도 글자와 가는 선뿐이다(화면은 글자만 규칙).

import { escapeHtml as esc } from './core.js';

export const ROOM_W = 560;
export const ROOM_H = 640;
const GAP = 80;
const COLS = 3;
const SLOT_W = 176;
const SLOT_H = 46;
const SLOT_TOP = 84;
const SLOT_COLS = 3;
const SLOT_ROWS = Math.floor((ROOM_H - SLOT_TOP - 16) / SLOT_H);
export const MIN_SHELVES = 3; // 빈 진열장도 선반 몇 칸은 보이게

// 선반 선의 y 자리(진열장 안 좌표). 표본이 있는 줄까지, 최소 MIN_SHELVES줄
export function shelfLines(positions, min = MIN_SHELVES) {
  let rows = min;
  for (const p of positions) rows = Math.max(rows, Math.floor((p.y - SLOT_TOP) / SLOT_H) + 1);
  rows = Math.min(rows, SLOT_ROWS);
  return Array.from({ length: rows }, (_, i) => SLOT_TOP + (i + 1) * SLOT_H - 6);
}

// 산책: 오래 안 만난 표본부터 다시 보여 준다 (나중에 다시 보기).
// items: [{id, room, metAt}] (metAt = 마지막으로 보거나 복사한 때, 없으면 0)
// recent: 이번 산책에서 이미 본 id들. 가능하면 직전과 다른 진열장에서 고른다.
// rng: 0~1 난수 (테스트에서 고정). 가장 오래된 쪽 20%(최소 3개) 안에서 고른다.
export function pickStroll(items, recent = [], rng = Math.random) {
  const seen = new Set(recent);
  let pool = items.filter((it) => !seen.has(it.id));
  if (!pool.length) {
    if (!items.length) return null;
    pool = items.filter((it) => it.id !== recent.at(-1));
    if (!pool.length) pool = items;
  }
  pool = [...pool].sort((a, b) => (a.metAt || 0) - (b.metAt || 0));
  const n = Math.max(3, Math.ceil(pool.length * 0.2));
  let head = pool.slice(0, n);
  const lastRoom = items.find((it) => it.id === recent.at(-1))?.room;
  const other = head.filter((it) => it.room !== lastRoom);
  if (other.length && lastRoom) head = other;
  return head[Math.min(head.length - 1, Math.floor(rng() * head.length))];
}

// ── 자리 정하기 (순수 함수, 테스트 대상) ──

// 방마다 격자 칸 하나. 이미 정한 칸은 그대로, 새 방은 빈 칸 중 앞쪽
export function assignRooms(keys, saved = {}) {
  const out = {};
  const used = new Set();
  for (const k of keys) {
    const p = saved[k];
    if (p) { out[k] = p; used.add(`${p.col},${p.row}`); }
  }
  let i = 0;
  for (const k of keys) {
    if (out[k]) continue;
    while (used.has(`${i % COLS},${Math.floor(i / COLS)}`)) i++;
    out[k] = { col: i % COLS, row: Math.floor(i / COLS) };
    used.add(`${i % COLS},${Math.floor(i / COLS)}`);
  }
  return out;
}

export function roomOrigin(cell) {
  return { x: cell.col * (ROOM_W + GAP), y: cell.row * (ROOM_H + GAP) };
}

// 방 안의 빈 자리. 칸이 다 차면 아래로 이어 붙임
export function freeSlot(taken) {
  for (let i = 0; ; i++) {
    const col = i % SLOT_COLS;
    const row = Math.floor(i / SLOT_COLS);
    const x = 16 + col * SLOT_W;
    const y = SLOT_TOP + row * SLOT_H;
    if (!taken.some((p) => Math.abs(p.x - x) < SLOT_W - 8 && Math.abs(p.y - y) < SLOT_H - 6)) return { x, y };
    if (i > 2000) return { x, y };
  }
}

// items: [{id, room}] , positions: {id: {room,x,y}} → 새로 정한 자리만 돌려줌
export function placeNew(items, positions) {
  const byRoom = {};
  for (const it of items) {
    const p = positions[it.id];
    if (p && p.room === it.room) (byRoom[it.room] ||= []).push(p);
  }
  const fresh = {};
  for (const it of items) {
    const p = positions[it.id];
    if (p && p.room === it.room) continue;
    const taken = byRoom[it.room] ||= [];
    const slot = freeSlot(taken);
    const np = { room: it.room, ...slot };
    taken.push(np);
    fresh[it.id] = np;
  }
  return fresh;
}

// ── 화면 ──

export function createPalace(root, hooks) {
  root.innerHTML = `
    <div class="pal-view" tabindex="0" aria-label="호기심의 방"><div class="pal-canvas"></div></div>
    <p class="pal-empty" hidden>오른쪽 아래 버튼을 눌러 첫 표본을 적어 보세요<br><small>키워드: 짧은 설명</small></p>
    <div class="pal-tools">
      <button class="text-btn" data-pal="fit">전체</button>
      <button class="text-btn" data-pal="in" aria-label="확대">+</button>
      <button class="text-btn" data-pal="out" aria-label="축소">−</button>
      <button class="text-btn" data-pal="stroll">산책</button>
    </div>
    <div class="stroll" hidden>
      <span class="stroll-where muted"></span>
      <button class="text-btn strong" data-pal="next">다음</button>
      <button class="text-btn" data-pal="stop">그만</button>
    </div>`;
  const view = root.querySelector('.pal-view');
  const canvas = root.querySelector('.pal-canvas');
  let t = { x: 0, y: 0, k: 0.6 };
  let rooms = [];
  let layout = {};
  let used = {}; // 방마다 글자가 실제로 있는 높이 (화면 맞춤용)
  let hasView = false;


  function apply(animate = false) {
    canvas.classList.toggle('anim', animate);
    canvas.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
    // 멀리(방 이름만) · 보통(키워드) · 가까이(설명까지)
    canvas.classList.toggle('far', t.k < 0.5);
    canvas.classList.toggle('near', t.k >= 1.05);
  }

  function bounds(rects) {
    const x1 = Math.min(...rects.map((r) => r.x));
    const y1 = Math.min(...rects.map((r) => r.y));
    const x2 = Math.max(...rects.map((r) => r.x + r.w));
    const y2 = Math.max(...rects.map((r) => r.y + r.h));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function flyTo(r, maxK = 1.6) {
    const vw = view.clientWidth, vh = view.clientHeight;
    const pad = 24;
    const k = Math.min(maxK, (vw - pad * 2) / r.w, (vh - pad * 2) / r.h);
    t = { k, x: vw / 2 - (r.x + r.w / 2) * k, y: vh / 2 - (r.y + r.h / 2) * k };
    apply(true);
  }

  function fitAll(animate = true) {
    if (!rooms.length) return;
    // 빈 아래쪽은 빼고 글자가 있는 영역만 맞춤 → 글자가 덜 작아짐
    const b = bounds(rooms.map((r) => ({ ...layout[r.key], w: ROOM_W, h: used[r.key] || 120 })));
    flyTo(b, 1.2);
    if (!animate) apply(false);
  }

  function zoomAt(px, py, factor) {
    const k = Math.min(3, Math.max(0.12, t.k * factor));
    const f = k / t.k;
    t = { k, x: px - (px - t.x) * f, y: py - (py - t.y) * f };
    apply();
  }

  function toCanvas(clientX, clientY) {
    const b = view.getBoundingClientRect();
    return { x: (clientX - b.left - t.x) / t.k, y: (clientY - b.top - t.y) / t.k };
  }

  function roomAt(p) {
    return rooms.find((r) => {
      const o = layout[r.key];
      return p.x >= o.x && p.x <= o.x + ROOM_W && p.y >= o.y && p.y <= o.y + ROOM_H;
    });
  }

  // data: { rooms: [{key,label,count}], items: [{id, room, keyword, desc, strong, pinned}], positions, roomCells }
  function render(data) {
    rooms = data.rooms;
    layout = {};
    used = {};
    for (const r of rooms) layout[r.key] = roomOrigin(data.roomCells[r.key]);
    for (const it of data.items) {
      const p = data.positions[it.id];
      if (p && p.room === it.room) used[it.room] = Math.max(used[it.room] || 120, p.y + 44);
    }
    for (const r of rooms) if (r.kind !== 'inbox') used[r.key] = Math.max(used[r.key] || 0, SLOT_TOP + MIN_SHELVES * SLOT_H + 8);
    const posByRoom = {};
    for (const it of data.items) {
      const p = data.positions[it.id];
      if (p && p.room === it.room) (posByRoom[it.room] ||= []).push(p);
    }
    canvas.innerHTML = rooms.map((r) => {
      const o = layout[r.key];
      // 받은함은 선반 없는 '미분류 상자', 나머지는 이름판 + 선반이 있는 진열장
      const shelves = r.kind === 'inbox' ? '' : shelfLines(posByRoom[r.key] || [])
        .map((y) => `<i class="shelf" style="top:${y}px"></i>`).join('');
      return `<section class="room room-${r.kind}" data-room="${r.key}" style="left:${o.x}px;top:${o.y}px;width:${ROOM_W}px;height:${ROOM_H}px">
        <h3 class="room-name">${r.label} <small>${r.count}</small></h3>${shelves}</section>`;
    }).join('') + data.items.map((it) => {
      const p = data.positions[it.id];
      const o = layout[it.room];
      if (!p || !o) return '';
      return `<button class="kw${it.strong ? ' strong' : ''}${it.pinned ? ' pinned' : ''}" data-kw="${it.id}"
        style="left:${o.x + p.x}px;top:${o.y + p.y}px" title="${esc(it.keyword)}${it.desc ? ' — ' + esc(it.desc) : ''}">
        <b>${esc(it.keyword)}</b>${it.desc ? `<small>${esc(it.desc)}</small>` : ''}</button>`;
    }).join('');
    // 처음 열 때는 방 전체
    root.querySelector('.pal-empty').hidden = data.items.length > 0;
    // 처음엔 지도 전체 (멀리서 방 이름이 보이는 단계)
    if (!hasView) { hasView = true; requestAnimationFrame(() => fitAll(false)); } else apply();
  }

  // 찾는 말에 맞는 키워드만 밝히고 그쪽으로 날아감
  function highlight(ids) {
    if (!ids && strollBar && !strollBar.hidden) { strollBar.hidden = true; root.querySelector('.pal-tools').hidden = false; }
    const set = ids ? new Set(ids) : null;
    canvas.classList.toggle('searching', !!set);
    const hits = [];
    canvas.querySelectorAll('.kw').forEach((el) => {
      const on = !!set && set.has(el.dataset.kw);
      el.classList.toggle('hit', on);
      if (on) hits.push({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    });
    if (hits.length && hits.length <= 30) flyTo(bounds(hits), 1.4);
  }

  // 산책: 표본 하나로 다가가 이름표까지 보여 줌
  const strollBar = root.querySelector('.stroll');
  function showSpecimen(id, where = '') {
    const el = canvas.querySelector(`.kw[data-kw="${CSS.escape(id)}"]`);
    if (!el) return false;
    canvas.classList.add('searching');
    canvas.querySelectorAll('.kw.hit').forEach((k) => k.classList.remove('hit'));
    el.classList.add('hit');
    const r = { x: el.offsetLeft - 40, y: el.offsetTop - 60, w: el.offsetWidth + 80, h: el.offsetHeight + 120 };
    // 설명(near)이 보이는 배율로 다가감
    const vw = view.clientWidth, vh = view.clientHeight;
    const k = Math.min(1.8, Math.max(1.1, Math.min(vw / (r.w + 48), vh / (r.h + 48))));
    t = { k, x: vw / 2 - (r.x + r.w / 2) * k, y: vh / 2 - (r.y + r.h / 2) * k };
    apply(true);
    strollBar.hidden = false;
    strollBar.querySelector('.stroll-where').textContent = where;
    root.querySelector('.pal-tools').hidden = true;
    return true;
  }
  function endStroll(refit = true) {
    if (strollBar.hidden) return;
    strollBar.hidden = true;
    root.querySelector('.pal-tools').hidden = false;
    highlight(null);
    if (refit) fitAll();
  }

  function focusRoom(key, animate = true) {
    const o = layout[key];
    if (!o) return;
    flyTo({ ...o, w: ROOM_W, h: used[key] || 120 }, 1.4);
    if (!animate) apply(false);
  }

  // ── 손가락·마우스 ──
  const pointers = new Map();
  let gesture = null; // {type:'pan'|'pinch'|'kw'|'drag', ...}
  let lastTap = { time: 0, room: null };

  view.addEventListener('pointerdown', (e) => {
    view.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), k: t.k, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, t0: { ...t } };
      cancelKw();
      return;
    }
    const kw = e.target.closest('.kw');
    if (kw) {
      gesture = { type: 'kw', el: kw, id: kw.dataset.kw, sx: e.clientX, sy: e.clientY, moved: false, touch: e.pointerType !== 'mouse' };
      if (gesture.touch) gesture.timer = setTimeout(() => startDrag(), 380);
    } else {
      gesture = { type: 'pan', sx: e.clientX, sy: e.clientY, t0: { ...t }, moved: false, room: e.target.closest('.room')?.dataset.room };
    }
  });

  function startDrag() {
    if (!gesture || gesture.type !== 'kw') return;
    gesture.type = 'drag';
    gesture.el.classList.add('dragging');
    navigator.vibrate?.(15);
  }
  function cancelKw() {
    if (gesture?.timer) clearTimeout(gesture.timer);
  }

  view.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    if (gesture.type === 'pinch' && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const box = view.getBoundingClientRect();
      const mid = { x: (a.x + b.x) / 2 - box.left, y: (a.y + b.y) / 2 - box.top };
      const k = Math.min(3, Math.max(0.12, gesture.k * dist / gesture.dist));
      const g0 = gesture.t0;
      const m0 = { x: gesture.mid.x - box.left, y: gesture.mid.y - box.top };
      const cx = (m0.x - g0.x) / g0.k, cy = (m0.y - g0.y) / g0.k;
      t = { k, x: mid.x - cx * k, y: mid.y - cy * k };
      apply();
      return;
    }
    const dx = e.clientX - gesture.sx, dy = e.clientY - gesture.sy;
    const far = Math.hypot(dx, dy) > 6;
    if (gesture.type === 'kw') {
      if (!far) return;
      cancelKw();
      if (gesture.touch) { gesture = { type: 'pan', sx: gesture.sx, sy: gesture.sy, t0: { ...t }, moved: true }; }
      else startDrag();
    }
    if (gesture.type === 'drag') {
      const p = toCanvas(e.clientX, e.clientY);
      gesture.el.style.left = `${p.x - gesture.el.offsetWidth / 2}px`;
      gesture.el.style.top = `${p.y - gesture.el.offsetHeight / 2}px`;
      canvas.querySelectorAll('.room').forEach((r) => r.classList.toggle('drop', r.dataset.room === roomAt(p)?.key));
    } else if (gesture.type === 'pan') {
      if (far) gesture.moved = true;
      t = { ...t, x: gesture.t0.x + dx, y: gesture.t0.y + dy };
      apply();
    }
  });

  function end(e) {
    pointers.delete(e.pointerId);
    const g = gesture;
    if (pointers.size > 0) { if (g?.type === 'pinch') gesture = null; return; }
    gesture = null;
    if (!g) return;
    cancelKw();
    if (g.type === 'kw' && e.type === 'pointerup') hooks.onTap(g.id);
    else if (g.type === 'drag') {
      g.el.classList.remove('dragging');
      canvas.querySelectorAll('.room.drop').forEach((r) => r.classList.remove('drop'));
      const p = toCanvas(e.clientX, e.clientY);
      const room = roomAt(p);
      if (room) {
        const o = layout[room.key];
        hooks.onMove(g.id, room.key, {
          room: room.key,
          x: Math.round(Math.min(ROOM_W - 40, Math.max(0, p.x - o.x - g.el.offsetWidth / 2))),
          y: Math.round(Math.min(ROOM_H - 30, Math.max(56, p.y - o.y - g.el.offsetHeight / 2))),
        });
      } else hooks.onMove(g.id, null);
    } else if (g.type === 'pan' && !g.moved && e.type === 'pointerup') {
      // 멀리서는 방을 한 번, 가까이서는 두 번 누르면 그 방으로
      const now = Date.now();
      if (g.room && (t.k < 0.5 || (lastTap.room === g.room && now - lastTap.time < 350))) focusRoom(g.room);
      lastTap = { time: now, room: g.room };
    }
  }
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);

  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    const b = view.getBoundingClientRect();
    if (e.ctrlKey || Math.abs(e.deltaY) >= 40 && e.deltaMode === 0 && !e.deltaX) {
      zoomAt(e.clientX - b.left, e.clientY - b.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    } else {
      t = { ...t, x: t.x - e.deltaX, y: t.y - e.deltaY };
      apply();
    }
  }, { passive: false });

  root.querySelector('.pal-tools').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pal]');
    if (!b) return;
    const c = { x: view.clientWidth / 2, y: view.clientHeight / 2 };
    if (b.dataset.pal === 'fit') fitAll();
    else if (b.dataset.pal === 'stroll') hooks.onStroll?.();
    else canvas.classList.add('anim'), zoomAt(c.x, c.y, b.dataset.pal === 'in' ? 1.4 : 1 / 1.4);
  });
  strollBar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pal]');
    if (!b) return;
    if (b.dataset.pal === 'next') hooks.onStroll?.();
    else if (b.dataset.pal === 'stop') endStroll();
  });
  // 산책 중에 직접 끌거나 확대하면 산책 표시는 남고, 다른 곳을 찾으면 끝남
  view.addEventListener('keydown', (e) => { if (e.key === 'Escape') endStroll(); });

  return { render, highlight, focusRoom, fitAll, showSpecimen, endStroll, get strolling() { return !strollBar.hidden; } };
}
