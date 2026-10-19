// 화면과 저장소에 기대지 않는 순수 함수들. tests/core.test.mjs에서 node로 시험한다.

export const PARA_LABEL = {
  inbox: '받은함',
  project: '프로젝트',
  area: '영역',
  resource: '자료',
  archive: '보관',
};

const DAY = 86400000;

export function uid() {
  const r = Math.random().toString(36).slice(2, 8);
  return Date.now().toString(36) + r;
}

export function normalize(s) {
  return (s || '').normalize('NFC').toLowerCase();
}

// 첫 줄(앞의 # 제거)이 제목. 비어 있으면 '(제목 없음)'
export function memoTitle(body) {
  for (const line of (body || '').split('\n')) {
    let t = line.replace(/^#{1,6}\s+/, '')
      .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, a, b) => (b || a).trim())
      .replace(/\*\*|==|~~/g, '').trim();
    const noTags = t.replace(/(^|\s)#[\p{L}\p{N}_\-/]+/gu, '').trim();
    if (noTags) t = noTags;
    if (t) return t.length > 80 ? t.slice(0, 80) + '…' : t;
  }
  return '(제목 없음)';
}

// 코드 블록·인라인 코드 안의 #, [[ ]]는 무시
function stripCode(body) {
  return (body || '').replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
}

const TAG_RE = /(^|[\s(,])#([\p{L}\p{N}_\-/]+)/gu;

export function parseTags(body) {
  const out = new Set();
  for (const m of stripCode(body).matchAll(TAG_RE)) {
    const tag = m[2].replace(/[/\-_]+$/, '');
    if (/\p{L}/u.test(tag)) out.add(tag);
  }
  return [...out];
}

const LINK_RE = /\[\[([^[\]\n|]+)(?:\|[^\]\n]*)?\]\]/g;

export function parseLinks(body) {
  const out = new Set();
  for (const m of stripCode(body).matchAll(LINK_RE)) {
    const t = m[1].trim();
    if (t) out.add(t);
  }
  return [...out];
}

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

// '미술 교사' → 'ㅁㅅ ㄱㅅ'
export function chosung(s) {
  let out = '';
  for (const ch of s || '') {
    const c = ch.charCodeAt(0);
    out += c >= 0xac00 && c <= 0xd7a3 ? CHO[Math.floor((c - 0xac00) / 588)] : ch;
  }
  return out;
}

// 메모 하나에서 검색·연결에 쓰는 값들
export function derive(memo) {
  const title = memoTitle(memo.body);
  const tags = parseTags(memo.body);
  const links = parseLinks(memo.body);
  const hay = normalize([title, memo.body, memo.sourceUrl || ''].join('\n'));
  return { title, tags, links, hay, cho: chosung(hay), key: normalize(title) };
}

// PARA 위치: 보관 > 컬렉션(프로젝트·영역) > 자료/받은함
export function paraOf(memo, collections) {
  if (memo.archived) return 'archive';
  if (memo.collectionId) {
    const c = collections[memo.collectionId];
    if (c) return c.archived ? 'archive' : c.kind;
  }
  return memo.para === 'resource' ? 'resource' : 'inbox';
}

// 검색어: 띄어쓰기로 나눈 낱말 모두 포함(AND). '#태그'는 태그 조건, '-낱말'은 제외,
// 자음만 쓴 낱말(ㅁㅅ)은 초성 검색
export function parseQuery(q) {
  const terms = [], tags = [], not = [], colls = [];
  for (const raw of normalize(q).split(/\s+/)) {
    if (!raw || raw === '!') continue;
    if (raw.length > 1 && raw[0] === '#') tags.push(raw.slice(1));
    else if (raw.length > 1 && raw[0] === '+') colls.push(raw.slice(1));
    else if (raw.length > 1 && raw[0] === '-') not.push(raw.slice(1));
    else terms.push(raw);
  }
  return { terms, tags, not, colls };
}

const CHO_ONLY = /^[ㄱ-ㅎ]+$/;

export function scoreMemo(d, q) {
  if (!q.terms.length && !q.tags.length && !q.not.length) return 1;
  const tagSet = d.tags.map(normalize);
  for (const t of q.tags) if (!tagSet.some((x) => x === t || x.startsWith(t + '/'))) return 0;
  for (const t of q.not) if (d.hay.includes(t)) return 0;
  let score = 1;
  for (const t of q.terms) {
    if (d.hay.includes(t)) {
      score += d.key.includes(t) ? 10 : 1;
    } else if (CHO_ONLY.test(t) && d.cho.includes(t)) {
      score += chosung(d.key).includes(t) ? 5 : 0.5;
    } else {
      return 0;
    }
  }
  return score;
}

// items: [{memo, d}] → 점수순(같으면 고정 먼저, 최근 수정 먼저)
export function searchMemos(items, query, collections = {}) {
  const q = parseQuery(query);
  const hits = [];
  for (const it of items) {
    if (q.colls.length) {
      const c = collections[it.memo.collectionId];
      const name = c ? normalize(c.name).replace(/\s+/g, '') : '';
      if (!name || !q.colls.every((x) => name.includes(x))) continue;
    }
    const s = scoreMemo(it.d, q);
    if (s > 0) hits.push({ ...it, score: s });
  }
  const searching = q.terms.length > 0;
  hits.sort((a, b) =>
    (searching ? b.score - a.score : 0) ||
    (b.memo.pinned ? 1 : 0) - (a.memo.pinned ? 1 : 0) ||
    b.memo.updatedAt - a.memo.updatedAt);
  return hits;
}

export function backlinks(items, target) {
  const key = target.d.key;
  return items.filter((it) => it.memo.id !== target.memo.id && it.d.links.some((l) => normalize(l) === key));
}

// 태그가 많이 겹치는 메모
export function relatedMemos(items, target, limit = 5) {
  const mine = new Set(target.d.tags.map(normalize));
  if (!mine.size) return [];
  const out = [];
  for (const it of items) {
    if (it.memo.id === target.memo.id) continue;
    const n = it.d.tags.filter((t) => mine.has(normalize(t))).length;
    if (n) out.push({ ...it, shared: n });
  }
  out.sort((a, b) => b.shared - a.shared || b.memo.updatedAt - a.memo.updatedAt);
  return out.slice(0, limit);
}

export function tagCounts(items) {
  const m = new Map();
  for (const it of items) for (const t of it.d.tags) m.set(t, (m.get(t) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
}

// 마감일(YYYY-MM-DD)까지 남은 날. 오늘이면 0
export function daysLeft(deadline, now = Date.now()) {
  if (!deadline) return null;
  const [y, m, d] = deadline.split('-').map(Number);
  const end = new Date(y, m - 1, d).getTime();
  const t = new Date(now);
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  return Math.round((end - today) / DAY);
}

export function dday(deadline, now) {
  const n = daysLeft(deadline, now);
  if (n === null) return '';
  return n === 0 ? 'D-day' : n > 0 ? `D-${n}` : `D+${-n}`;
}

// 공유로 받은 값 → 메모 본문. 안드로이드는 주소를 text에 넣어 보내기도 함
export function sharedToMemo({ title = '', text = '', url = '' }) {
  title = title.trim(); text = text.trim(); url = url.trim();
  if (!url) {
    const m = text.match(/https?:\/\/\S+/);
    if (m) {
      url = m[0];
      if (text === url) text = '';
    }
  }
  const lines = [];
  if (title && title !== url) lines.push('# ' + title);
  if (text && text !== title) lines.push(text);
  if (url && !text.includes(url)) lines.push(url);
  return { body: lines.join('\n\n') || url, sourceUrl: url };
}

// ── 마크다운 → HTML ──
// 먼저 HTML을 이스케이프한 뒤 필요한 태그만 만든다. 링크는 http(s)/mailto만 허용

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

function unescapeHtml(s) {
  return s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]));
}

function inline(text, opt) {
  const slots = [];
  const put = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, (_, c) => put(`<code>${c}</code>`));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (all, alt, src) => {
    if (src.startsWith('img:')) return put(`<img alt="${alt}" data-img="${src.slice(4)}">`);
    if (SAFE_URL.test(src)) return put(`<img alt="${alt}" src="${src}" loading="lazy">`);
    return all;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label, href) =>
    SAFE_URL.test(href) ? put(`<a href="${href}" target="_blank" rel="noopener">${label}</a>`) : all);
  s = s.replace(/\[\[([^[\]|]+)(?:\|([^\]]*))?\]\]/g, (_, target, alias) => {
    const t = target.trim();
    const exists = opt.hasTitle ? opt.hasTitle(unescapeHtml(t)) : true;
    return put(`<a class="wikilink${exists ? '' : ' missing'}" data-link="${t}">${(alias || t).trim()}</a>`);
  });
  s = s.replace(/https?:\/\/[^\s<\u0000]+[^\s<\u0000.,;:!?)'"]/g, (u) =>
    put(`<a href="${u}" target="_blank" rel="noopener">${u}</a>`));
  s = s.replace(/(^|[\s(,])#([\p{L}\p{N}_\-/]+)/gu, (all, pre, tag) =>
    /\p{L}/u.test(tag) ? pre + put(`<a class="tag" data-tag="${tag}">#${tag}</a>`) : all);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/==([^=]+)==/g, '<mark>$1</mark>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[i]);
}

export function renderMarkdown(src, opt = {}) {
  const lines = (src || '').split('\n');
  const out = [];
  let para = [];
  let list = null; // 'ul' | 'tasks' | 'ol'
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map((l) => inline(l, opt)).join('<br>')}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(list === 'ol' ? '</ol>' : '</ul>');
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushPara(); closeList();
      const code = [];
      while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara(); closeList();
      const n = m[1].length;
      out.push(`<h${n}>${inline(m[2], opt)}</h${n}>`);
    } else if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      flushPara(); closeList();
      out.push('<hr>');
    } else if ((m = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/))) {
      flushPara();
      if (list !== 'tasks') { closeList(); out.push('<ul class="tasks">'); list = 'tasks'; }
      const done = m[1] !== ' ';
      out.push(`<li class="task${done ? ' done' : ''}"><input type="checkbox" data-line="${i}"${done ? ' checked' : ''}> <span>${inline(m[2], opt)}</span></li>`);
    } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1], opt)}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1], opt)}</li>`);
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara(); closeList();
      out.push(`<blockquote>${inline(m[1], opt)}</blockquote>`);
    } else if (!line.trim()) {
      flushPara(); closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara(); closeList();
  return out.join('\n');
}

// 체크박스 줄(lineNo)의 [ ] ↔ [x]
export function toggleTask(body, lineNo) {
  const lines = body.split('\n');
  const l = lines[lineNo];
  if (l === undefined) return body;
  lines[lineNo] = l.replace(/\[([ xX])\]/, (_, c) => (c === ' ' ? '[x]' : '[ ]'));
  return lines.join('\n');
}

// ── 내보내기 ──

export function safeFileName(s) {
  const t = s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return t || '메모';
}

function yamlStr(s) {
  return JSON.stringify(String(s));
}

export function memoToMarkdown(memo, collections, imageExt = {}) {
  const c = memo.collectionId && collections[memo.collectionId];
  const fm = [
    '---',
    `id: ${memo.id}`,
    `para: ${paraOf(memo, collections)}`,
    c ? `collection: ${yamlStr(c.name)}` : null,
    memo.sourceUrl ? `source: ${yamlStr(memo.sourceUrl)}` : null,
    memo.pinned ? 'pinned: true' : null,
    `created: ${new Date(memo.createdAt).toISOString()}`,
    `updated: ${new Date(memo.updatedAt).toISOString()}`,
    '---',
    '',
  ].filter((x) => x !== null);
  const body = memo.body.replace(/\]\(img:([\w-]+)\)/g, (_, id) => `](images/${id}.${imageExt[id] || 'jpg'})`);
  return fm.join('\n') + body + '\n';
}

// 메모·첨부 이름 겹침 방지
export function uniqueNames(titles) {
  const used = new Map();
  return titles.map((t) => {
    const base = safeFileName(t);
    const k = base.toLowerCase();
    const n = used.get(k) || 0;
    used.set(k, n + 1);
    return n ? `${base} (${n + 1})` : base;
  });
}

// 압축 없는(STORE) ZIP. 파일 이름은 UTF-8 플래그로 한글 유지
let CRC_TABLE;
function crc32(data) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function makeZip(files, date = new Date()) {
  const enc = new TextEncoder();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(12, time, true);
    cen.setUint16(14, day, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cenSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

// 마크다운 파일 가져오기: 앞머리(---) 떼고 source/created만 살림
export function markdownToMemo(text, fileName = '') {
  let body = text.replace(/\r\n/g, '\n');
  const meta = {};
  const fm = body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) meta[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
    body = body.slice(fm[0].length);
  }
  const name = fileName.replace(/\.md$/i, '');
  if (name && memoTitle(body) !== name && !/^#\s/.test(body)) body = `# ${name}\n\n${body}`;
  const created = Date.parse(meta.created) || Date.now();
  return {
    body: body.trim(),
    sourceUrl: meta.source || '',
    createdAt: created,
    updatedAt: Date.parse(meta.updated) || created,
  };
}

// 가져오기 병합: 같은 id면 더 최근 수정본
export function mergeById(current, incoming) {
  const map = new Map(current.map((x) => [x.id, x]));
  let added = 0, updated = 0;
  for (const x of incoming) {
    const old = map.get(x.id);
    if (!old) { map.set(x.id, x); added++; }
    else if ((x.updatedAt || 0) > (old.updatedAt || 0)) { map.set(x.id, x); updated++; }
  }
  return { list: [...map.values()], added, updated };
}

// ── 빠른 입력 (한 칸으로 적기·찾기) ──

// 저장할 때 쓰는 짧은 명령: '+이름' → 그 프로젝트·영역, '!' 단독 → 고정
// collections: { id: {name, kind, archived} }
export function parseCapture(text, collections = {}) {
  let body = text;
  let collectionId = null;
  let pinned = false;
  const active = Object.values(collections).filter((c) => !c.archived);
  body = body.replace(/(^|\s)\+(\S+)/g, (all, pre, name) => {
    if (collectionId) return all;
    const c = findCollection(active, name);
    if (!c) return all;
    collectionId = c.id;
    return pre;
  });
  body = body.replace(/(^|\s)!(?=\s|$)/g, () => { pinned = true; return ' '; });
  body = body.replace(/[ \t]+$/gm, '').replace(/^[ \t]+/, '').trim();
  return { body, collectionId, pinned };
}

// '+이사' 로 '이사 준비'도 찾음 (정확히 같은 이름 > 앞부분 일치 > 포함)
export function findCollection(list, name) {
  const n = normalize(name).replace(/_/g, ' ');
  if (!n) return null;
  const key = (c) => normalize(c.name);
  return list.find((c) => key(c) === n)
    || list.find((c) => key(c).startsWith(n))
    || list.find((c) => key(c).replace(/\s+/g, '').includes(n.replace(/\s+/g, '')))
    || null;
}

// 입력칸 글이 '찾기'로 쓸 만한지: 한 줄이고 짧을 때만 아래 목록을 거름
export function isSearchLike(text) {
  const t = text.trim();
  return t !== '' && !t.includes('\n') && t.length <= 40;
}

// 메모 종류(아이콘용): 이미지 > 할 일 > 링크 > 문구 > 메모
export function memoKind(memo) {
  const body = memo.body || '';
  if (/!\[[^\]]*\]\([^)]+\)/.test(body)) return 'image';
  if (/^\s*[-*+]\s+\[[ xX]\]\s/m.test(body)) return 'task';
  const lines = body.split('\n').filter((l) => l.trim());
  if (memo.sourceUrl && lines.length <= 3) return 'link';
  if (lines.length <= 2 && body.length <= 160 && !/^#{1,6}\s/.test(body)) return 'snippet';
  return 'note';
}

export const KIND_ICON = { image: '🖼', task: '✅', link: '🔗', snippet: '💬', note: '📝' };

// 목록 미리보기: ==형광펜== 친 부분이 있으면 그것 먼저 (점진적 요약)
export function previewText(body, max = 140) {
  const marks = [...stripCode(body).matchAll(/==([^=\n]+)==/g)].map((m) => m[1].trim());
  const src = marks.length ? marks.join(' · ') : (body || '').split('\n').slice(1).join(' ');
  return src.replace(/!\[[^\]]*\]\([^)]*\)/g, '🖼').replace(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, '$1')
    .replace(/[#>*`~=[\]]+/g, ' ').replace(/(^|\s)-\s/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// 오늘 다시 볼 메모: 2주 넘게 안 본 메모 중 날짜로 정해지는 하나 (하루 동안 같은 것)
export function pickResurface(items, now = Date.now(), skip = 0) {
  const old = items.filter((it) => now - (it.memo.seenAt || it.memo.updatedAt) > 14 * DAY && !it.memo.archived)
    .sort((a, b) => (a.memo.id < b.memo.id ? -1 : 1));
  if (!old.length) return null;
  const day = Math.floor(now / DAY);
  return old[(day * 7919 + skip) % old.length];
}

// 하루 단위 묶음 이름: 오늘 / 어제 / 10월 17일 (금) / 2025년 3월 2일
export function dayLabel(ts, now = Date.now()) {
  const d = new Date(ts);
  const t = new Date(now);
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(t) - start(d)) / DAY);
  if (diff === 0) return '오늘';
  if (diff === 1) return '어제';
  const w = '일월화수목금토'[d.getDay()];
  if (d.getFullYear() === t.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일 (${w})`;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}
