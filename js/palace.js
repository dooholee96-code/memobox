// 궁전 보기: 큰 캔버스 하나에 방(입구·자료·영역·프로젝트)과 키워드를 놓고
// 끌어서 이동, 집게·휠로 확대한다. 키워드 자리는 한 번 정하면 앱이 다시 섞지 않는다.

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
    <div class="pal-view" tabindex="0" aria-label="궁전 보기"><div class="pal-canvas"></div></div>
    <div class="pal-tools">
      <button class="text-btn" data-pal="fit">전체</button>
      <button class="text-btn" data-pal="in" aria-label="확대">+</button>
      <button class="text-btn" data-pal="out" aria-label="축소">−</button>
    </div>`;
  const view = root.querySelector('.pal-view');
  const canvas = root.querySelector('.pal-canvas');
  let t = { x: 0, y: 0, k: 0.6 };
  let rooms = [];
  let layout = {};
  let hasView = false;

  try {
    const s = JSON.parse(localStorage.getItem('palaceView') || 'null');
    if (s && s.k) { t = s; hasView = true; }
  } catch { /* 저장 안 돼도 됨 */ }

  function apply(animate = false) {
    canvas.classList.toggle('anim', animate);
    canvas.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
    canvas.classList.toggle('far', t.k < 0.55);
    canvas.classList.toggle('very-far', t.k < 0.3);
    clearTimeout(apply.timer);
    apply.timer = setTimeout(() => {
      try { localStorage.setItem('palaceView', JSON.stringify(t)); } catch { /* 무시 */ }
    }, 300);
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
    const b = bounds(rooms.map((r) => ({ ...layout[r.key], w: ROOM_W, h: ROOM_H })));
    flyTo(b, 1);
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
    for (const r of rooms) layout[r.key] = roomOrigin(data.roomCells[r.key]);
    canvas.innerHTML = rooms.map((r) => {
      const o = layout[r.key];
      return `<section class="room room-${r.kind}" data-room="${r.key}" style="left:${o.x}px;top:${o.y}px;width:${ROOM_W}px;height:${ROOM_H}px">
        <h3 class="room-name">${r.label} <small>${r.count}</small></h3></section>`;
    }).join('') + data.items.map((it) => {
      const p = data.positions[it.id];
      const o = layout[it.room];
      if (!p || !o) return '';
      return `<button class="kw${it.strong ? ' strong' : ''}${it.pinned ? ' pinned' : ''}" data-kw="${it.id}"
        style="left:${o.x + p.x}px;top:${o.y + p.y}px" title="${esc(it.keyword)}${it.desc ? ' — ' + esc(it.desc) : ''}">
        <b>${esc(it.keyword)}</b>${it.desc ? `<small>${esc(it.desc)}</small>` : ''}</button>`;
    }).join('');
    // 처음 열 때: 넓은 화면은 전체, 폰은 입구 방에 맞춤 (전체는 글자가 너무 작아짐)
    if (!hasView) {
      hasView = true;
      requestAnimationFrame(() => (view.clientWidth < 700 ? focusRoom('inbox', false) : fitAll(false)));
    } else apply();
  }

  // 찾는 말에 맞는 키워드만 밝히고 그쪽으로 날아감
  function highlight(ids) {
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

  function focusRoom(key, animate = true) {
    const o = layout[key];
    if (!o) return;
    flyTo({ ...o, w: ROOM_W, h: ROOM_H });
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
      // 방을 두 번 누르면 그 방으로
      const now = Date.now();
      if (g.room && lastTap.room === g.room && now - lastTap.time < 350) focusRoom(g.room);
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
    else canvas.classList.add('anim'), zoomAt(c.x, c.y, b.dataset.pal === 'in' ? 1.4 : 1 / 1.4);
  });

  return { render, highlight, focusRoom, fitAll };
}
