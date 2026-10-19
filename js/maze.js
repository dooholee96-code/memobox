// 미궁 보기(시험판): 방 하나를 3D 정육면체로 세우고 네 벽에 키워드를 글자로 붙인다.
// 외부 엔진 없이 CSS 3D만 쓴다. 끌어서 둘러보기, 휠·두 손가락·방향키로 앞뒤, 누르면 복사.

import { escapeHtml as esc } from './core.js';

const HALF = 600;          // 방 가로·세로의 절반
const WALL_H = 640;
const FOCAL = 520;         // 원근 (작을수록 넓게 보임)
const LIMIT = 430;         // 벽에 너무 붙지 않게
// yaw: 그 벽을 정면으로 볼 때의 시점 각도
const WALLS = [
  { yaw: 0, face: 'rotateY(0deg)' },      // 앞
  { yaw: 90, face: 'rotateY(-90deg)' },   // 오른쪽
  { yaw: 180, face: 'rotateY(180deg)' },  // 뒤
  { yaw: -90, face: 'rotateY(90deg)' },   // 왼쪽
];

// 키워드 n개를 네 벽 칸에 나눔: 앞→오른쪽→뒤→왼쪽 순서로 한 칸씩 (테스트 대상)
export function wallLayout(n) {
  const perWall = Math.max(1, Math.ceil(n / 4));
  const cols = perWall <= 6 ? 3 : perWall <= 12 ? 4 : 5;
  const rows = Math.max(2, Math.ceil(perWall / cols));
  const cells = [];
  for (let i = 0; i < n; i++) {
    const wall = i % 4;
    const idx = Math.floor(i / 4);
    cells.push({ wall, col: idx % cols, row: Math.floor(idx / cols) });
  }
  return { cols, rows, cells };
}

export function createMaze(root, hooks) {
  root.innerHTML = `
    <nav class="mz-rooms" aria-label="방"></nav>
    <div class="mz-view" tabindex="0" aria-label="미궁">
      <div class="mz-world"></div>
      <div class="mz-shade"></div>
    </div>
    <div class="mz-help">끌어서 둘러보기 · 휠/두 손가락/방향키로 앞뒤 · 누르면 복사</div>`;
  const view = root.querySelector('.mz-view');
  const world = root.querySelector('.mz-world');
  const roomsNav = root.querySelector('.mz-rooms');
  let cam = { yaw: 0, pitch: 0, x: 0, z: 200 };
  let current = null;

  function apply(animate = false) {
    world.classList.toggle('anim', animate);
    world.style.transform =
      `translateZ(${FOCAL}px) rotateX(${cam.pitch}deg) rotateY(${cam.yaw}deg) translate3d(${-cam.x}px, 0, ${-cam.z}px)`;
  }

  function move(step) {
    const r = (cam.yaw * Math.PI) / 180;
    // 보는 방향 = (sin yaw, -cos yaw)
    cam.x = clamp(cam.x + Math.sin(r) * step, -LIMIT, LIMIT);
    cam.z = clamp(cam.z - Math.cos(r) * step, -LIMIT, LIMIT);
    apply();
  }

  // data: { rooms:[{key,label}], room, items:[{id, keyword, desc, strong}] }
  function render(data) {
    roomsNav.innerHTML = data.rooms.map((r) =>
      `<button class="text-btn" data-room="${r.key}" aria-pressed="${r.key === data.room}">${r.label}</button>`).join('');
    if (current !== data.room) { cam = { yaw: 0, pitch: 0, x: 0, z: 200 }; current = data.room; }
    const { cols, rows, cells } = wallLayout(data.items.length);
    const walls = WALLS.map(() => []);
    data.items.forEach((it, i) => walls[cells[i].wall].push({ it, ...cells[i] }));
    // 빈 벽을 채우는 흐린 글자: 이 방 키워드를 되풀이
    const words = data.items.map((it) => it.keyword);
    const filler = (count) => {
      if (!words.length) return '';
      let s = '';
      for (let i = 0; i < count; i++) s += `<span>${esc(words[i % words.length])}</span>`;
      return s;
    };
    const big = Math.max(26, Math.round(52 - cols * 5));
    const wallHtml = WALLS.map((w, wi) => `
      <div class="mz-face mz-wall" style="transform:${w.face} translateZ(${-HALF}px)">
        <div class="mz-filler">${filler(160)}</div>
        <div class="mz-grid" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr)">
          ${walls[wi].map(({ it, col, row }) => `
            <button class="mz-kw${it.strong ? ' strong' : ''}" data-kw="${it.id}" data-wall="${wi}"
              style="grid-column:${col + 1};grid-row:${row + 1};font-size:${big}px">
              <b>${esc(it.keyword)}</b>${it.desc ? `<small>${esc(it.desc)}</small>` : ''}</button>`).join('')}
        </div>
      </div>`).join('');
    world.innerHTML = wallHtml + `
      <div class="mz-face mz-floor" style="transform:rotateX(90deg) translateZ(${-WALL_H / 2}px)"><div class="mz-filler">${filler(220)}</div></div>
      <div class="mz-face mz-ceil" style="transform:rotateX(-90deg) translateZ(${-WALL_H / 2}px)"><div class="mz-filler">${filler(220)}</div></div>
      ${data.items.length ? '' : `<div class="mz-face mz-wall mz-empty" style="transform:translateZ(${-HALF + 2}px)"><p>이 방은 아직 비어 있어요</p></div>`}`;
    apply();
  }

  // 찾는 말과 맞는 키워드를 빛나게 하고, 첫 번째가 있는 벽으로 돌아봄
  function highlight(ids) {
    const set = ids ? new Set(ids) : null;
    world.classList.toggle('searching', !!set);
    let first = null;
    world.querySelectorAll('.mz-kw').forEach((el) => {
      const on = !!set && set.has(el.dataset.kw);
      el.classList.toggle('glow', on);
      if (on && !first) first = el;
    });
    if (first) {
      const target = WALLS[Number(first.dataset.wall)].yaw;
      cam.yaw = nearestAngle(cam.yaw, target);
      cam.pitch = 0;
      apply(true);
    }
  }

  // ── 손가락·마우스·키보드 ──
  const pointers = new Map();
  let drag = null;
  view.addEventListener('pointerdown', (e) => {
    view.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      drag = { pinch: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    drag = { sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, kw: e.target.closest('.mz-kw') };
  });
  view.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !drag) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (drag.pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      move((d - drag.pinch) * 2.2);
      drag.pinch = d;
      return;
    }
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) drag.moved = true;
    // 손으로 벽을 잡아 끄는 느낌: 오른쪽으로 끌면 왼쪽이 보임
    cam.yaw -= (e.clientX - drag.lx) * 0.25;
    cam.pitch = clamp(cam.pitch + (e.clientY - drag.ly) * 0.2, -35, 35);
    drag.lx = e.clientX;
    drag.ly = e.clientY;
    apply();
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size) return;
    if (drag && !drag.moved && !drag.pinch && e.type === 'pointerup') {
      const kw = drag.kw || kwAt(e.clientX, e.clientY);
      if (kw) hooks.onTap(kw.dataset.kw);
    }
    drag = null;
  };

  // 크롬은 돌아간 3D 벽에서 누른 곳을 못 찾을 때가 있어서, 바라보는 쪽 벽의 글자 영역으로 직접 찾음
  function kwAt(x, y) {
    let best = null;
    world.querySelectorAll('.mz-kw').forEach((el) => {
      const facing = Math.abs(nearestAngle(cam.yaw, WALLS[Number(el.dataset.wall)].yaw) - cam.yaw);
      if (facing > 60) return;
      const r = el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
      const area = r.width * r.height;
      if (!best || facing < best.facing || (facing === best.facing && area < best.area)) best = { el, facing, area };
    });
    return best && best.el;
  }
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);
  view.addEventListener('wheel', (e) => { e.preventDefault(); move(-e.deltaY * 0.8); }, { passive: false });
  view.addEventListener('keydown', (e) => {
    const k = { ArrowUp: () => move(60), ArrowDown: () => move(-60), ArrowLeft: () => { cam.yaw -= 15; apply(true); }, ArrowRight: () => { cam.yaw += 15; apply(true); } }[e.key];
    if (k) { e.preventDefault(); k(); }
  });
  roomsNav.addEventListener('click', (e) => {
    const b = e.target.closest('[data-room]');
    if (b) hooks.onRoom(b.dataset.room);
  });

  return { render, highlight };
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

// 지금 각도에서 가장 가까운 같은 방향 (빙빙 돌지 않게)
function nearestAngle(from, to) {
  const d = ((to - from) % 360 + 540) % 360 - 180;
  return from + d;
}
