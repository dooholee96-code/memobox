import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  memoTitle, parseTags, parseLinks, chosung, derive, paraOf, searchMemos, backlinks, relatedMemos,
  daysLeft, dday, sharedToMemo, renderMarkdown, toggleTask, memoToMarkdown, uniqueNames, makeZip,
  markdownToMemo, mergeById, safeFileName, parseCapture, findCollection, isSearchLike, memoKind,
  previewText, pickResurface, dayLabel, entryOf,
} from '../js/core.js';

const memo = (id, body, extra = {}) => ({ id, body, updatedAt: 1, createdAt: 1, sourceUrl: '', ...extra });
const item = (m) => ({ memo: m, d: derive(m) });

test('제목은 첫 줄, 앞의 #은 뗀다', () => {
  assert.equal(memoTitle('\n\n# 회의 메모\n내용'), '회의 메모');
  assert.equal(memoTitle(''), '(제목 없음)');
  assert.equal(memoTitle('노트 쓰는 법 [[제텔카스텐]] ==핵심== #방법론'), '노트 쓰는 법 제텔카스텐 핵심');
  assert.equal(memoTitle('#레시피 #한식'), '#레시피 #한식');
  assert.equal(memoTitle('가'.repeat(100)).length, 81);
});

test('태그: 한글, 하위 태그, 숫자만은 제외, 코드 안은 무시', () => {
  assert.deepEqual(parseTags('#미술 수업 #교육/임용 #2027 (#괄호) a#b'), ['미술', '교육/임용', '괄호']);
  assert.deepEqual(parseTags('# 제목\n`#코드` ```\n#블록\n```'), []);
});

test('링크: [[제목]]과 [[제목|별칭]]', () => {
  assert.deepEqual(parseLinks('[[가]] 그리고 [[나 |다른 이름]] [[가]]'), ['가', '나']);
});

test('초성', () => {
  assert.equal(chosung('미술 교사 A'), 'ㅁㅅ ㄱㅅ A');
});

test('PARA 위치', () => {
  const colls = { p: { id: 'p', kind: 'project' }, a: { id: 'a', kind: 'area' }, d: { id: 'd', kind: 'project', archived: true } };
  assert.equal(paraOf(memo(1, ''), colls), 'inbox');
  assert.equal(paraOf(memo(1, '', { para: 'resource' }), colls), 'resource');
  assert.equal(paraOf(memo(1, '', { collectionId: 'p' }), colls), 'project');
  assert.equal(paraOf(memo(1, '', { collectionId: 'a' }), colls), 'area');
  assert.equal(paraOf(memo(1, '', { collectionId: 'd' }), colls), 'archive');
  assert.equal(paraOf(memo(1, '', { collectionId: 'p', archived: true }), colls), 'archive');
  assert.equal(paraOf(memo(1, '', { collectionId: 'gone' }), colls), 'inbox');
});

test('검색: 부분 문자열 AND, 조사 붙어도 찾음, 태그·제외·초성', () => {
  const items = [
    item(memo('a', '# 미술교사를 위한 자료\n#미술 수업', { updatedAt: 3 })),
    item(memo('b', '# 계좌번호\n국민 123-456', { updatedAt: 2, pinned: true })),
    item(memo('c', '# 장보기\n우유 미술용품', { updatedAt: 1 })),
  ];
  const ids = (q) => searchMemos(items, q).map((h) => h.memo.id);
  assert.deepEqual(ids('미술교사'), ['a']);
  assert.deepEqual(ids('미술'), ['a', 'c']);
  assert.deepEqual(ids('미술 -우유'), ['a']);
  assert.deepEqual(ids('#미술'), ['a']);
  assert.deepEqual(ids('ㄱㅈㅂㅎ'), ['b']);
  assert.deepEqual(ids('계좌'), ['b']);
  assert.deepEqual(ids(''), ['b', 'a', 'c']);
  assert.deepEqual(ids('MISSING'), []);
});

test('검색: 상위 태그로 하위 태그도 찾음', () => {
  const items = [item(memo('a', 'x #교육/임용')), item(memo('b', 'y #교육학'))];
  assert.deepEqual(searchMemos(items, '#교육').map((h) => h.memo.id), ['a']);
  assert.deepEqual(searchMemos(items, '#교육/임용').map((h) => h.memo.id), ['a']);
  const items2 = [item(memo('a', 'x #교육/임용')), item(memo('c', 'z #교육'))];
  assert.deepEqual(searchMemos(items2, '#교육').map((h) => h.memo.id).sort(), ['a', 'c']);
});

test('역링크와 관련 메모', () => {
  const a = item(memo('a', '# 제텔카스텐\n#방법론'));
  const b = item(memo('b', '# 노트\n[[제텔카스텐]] 참고 #방법론'));
  const c = item(memo('c', '# 기타\n#방법론 #정리'));
  assert.deepEqual(backlinks([a, b, c], a).map((x) => x.memo.id), ['b']);
  assert.deepEqual(relatedMemos([a, b, c], a).map((x) => x.memo.id).sort(), ['b', 'c']);
});

test('D-day', () => {
  const now = new Date(2026, 9, 19, 15).getTime();
  assert.equal(daysLeft('2026-10-19', now), 0);
  assert.equal(dday('2026-10-22', now), 'D-3');
  assert.equal(dday('2026-10-18', now), 'D+1');
  assert.equal(dday('', now), '');
});

test('공유 받은 값 → 메모', () => {
  assert.deepEqual(sharedToMemo({ title: '기사', text: '좋은 글 https://a.com/x', url: '' }),
    { body: '# 기사\n\n좋은 글 https://a.com/x', sourceUrl: 'https://a.com/x' });
  assert.deepEqual(sharedToMemo({ text: 'https://a.com' }), { body: 'https://a.com', sourceUrl: 'https://a.com' });
  assert.deepEqual(sharedToMemo({ title: '제목', url: 'https://b.com' }), { body: '# 제목\n\nhttps://b.com', sourceUrl: 'https://b.com' });
});

test('마크다운: HTML은 막고, 위험한 링크는 안 만듦', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n[x](javascript:alert(1)) <img src=x onerror=1>');
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('href="javascript'));
  const q = renderMarkdown('[a](https://x.com/"onmouseover="1)');
  assert.ok(!/href="[^"]*"onmouseover/.test(q));
});

test('마크다운: 제목·목록·할 일·링크·태그·이미지', () => {
  const html = renderMarkdown('# 제목\n- [ ] 할 일\n- [x] 끝\n- 항목\n1. 하나\n**굵게** [[메모]] #태그 https://a.com\n![](img:abc)',
    { hasTitle: (t) => t === '없음' });
  assert.match(html, /<h1>제목<\/h1>/);
  assert.match(html, /<input type="checkbox" data-line="1">/);
  assert.match(html, /class="task done"/);
  assert.match(html, /<\/ul>\n<ul>\n<li>항목<\/li>\n<\/ul>\n<ol>\n<li>하나<\/li>/);
  assert.match(html, /<strong>굵게<\/strong>/);
  assert.match(html, /class="wikilink missing" data-link="메모"/);
  assert.match(html, /data-tag="태그"/);
  assert.match(html, /<a href="https:\/\/a.com"/);
  assert.match(html, /data-img="abc"/);
});

test('마크다운: 코드 블록 안은 그대로', () => {
  const html = renderMarkdown('```\n# 아님 <b>\n```');
  assert.equal(html, '<pre><code># 아님 &lt;b&gt;</code></pre>');
});

test('할 일 체크 토글', () => {
  assert.equal(toggleTask('a\n- [ ] b', 1), 'a\n- [x] b');
  assert.equal(toggleTask('- [x] b', 0), '- [ ] b');
});

test('마크다운 내보내기와 가져오기', () => {
  const colls = { p: { id: 'p', kind: 'project', name: '이사 "준비"' } };
  const m = memo('m1', '# 짐 싸기\n![](img:i1)', { collectionId: 'p', sourceUrl: 'https://x.com', createdAt: 0, updatedAt: 1000 });
  const md = memoToMarkdown(m, colls, { i1: 'webp' });
  assert.match(md, /^---\nid: m1\npara: project\ncollection: "이사 \\"준비\\""/);
  assert.match(md, /!\[\]\(images\/i1\.webp\)/);
  const back = markdownToMemo(md, '짐 싸기.md');
  assert.equal(back.body, '# 짐 싸기\n![](images/i1.webp)');
  assert.equal(back.sourceUrl, 'https://x.com');
  assert.equal(back.updatedAt, 1000);
  assert.equal(markdownToMemo('본문만', '파일이름.md').body, '# 파일이름\n\n본문만');
});

test('파일 이름', () => {
  assert.equal(safeFileName('a/b:c?'), 'a b c');
  assert.deepEqual(uniqueNames(['가', '가', '나', '가']), ['가', '가 (2)', '나', '가 (3)']);
});

test('ZIP: 구조와 CRC', () => {
  const zip = makeZip([{ name: '한글.md', data: 'hello' }], new Date(2026, 0, 1));
  const v = new DataView(zip.buffer);
  assert.equal(v.getUint32(0, true), 0x04034b50);
  assert.equal(v.getUint32(14, true), 0x3610a686); // crc32("hello")
  assert.equal(v.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(v.getUint16(zip.length - 12, true), 1);
});

test('가져오기 병합은 더 최근 것', () => {
  const r = mergeById([{ id: 1, updatedAt: 5, v: 'old' }, { id: 2, updatedAt: 5 }], [{ id: 1, updatedAt: 9, v: 'new' }, { id: 2, updatedAt: 1 }, { id: 3, updatedAt: 1 }]);
  assert.equal(r.added, 1);
  assert.equal(r.updated, 1);
  assert.equal(r.list.find((x) => x.id === 1).v, 'new');
});

const COLLS = {
  p1: { id: 'p1', kind: 'project', name: '이사 준비' },
  a1: { id: 'a1', kind: 'area', name: '수업' },
  old: { id: 'old', kind: 'project', name: '이사 2024', archived: true },
};

test('빠른 입력: +이름은 프로젝트·영역, !는 고정, 나머지는 그대로', () => {
  assert.deepEqual(parseCapture('박스 20개 +이사 !', COLLS), { body: '박스 20개', collectionId: 'p1', pinned: true });
  assert.deepEqual(parseCapture('지도안 #임용 +수업', COLLS), { body: '지도안 #임용', collectionId: 'a1', pinned: false });
  assert.deepEqual(parseCapture('a+b 1+1 +없음', COLLS), { body: 'a+b 1+1 +없음', collectionId: null, pinned: false });
  assert.deepEqual(parseCapture('정말!', COLLS), { body: '정말!', collectionId: null, pinned: false });
});

test('컬렉션 찾기: 같은 이름 > 앞부분 > 포함, 띄어쓰기 무시', () => {
  const list = Object.values(COLLS).filter((c) => !c.archived);
  assert.equal(findCollection(list, '수업').id, 'a1');
  assert.equal(findCollection(list, '이사').id, 'p1');
  assert.equal(findCollection(list, '이사준비').id, 'p1');
  assert.equal(findCollection(list, '준비').id, 'p1');
  assert.equal(findCollection(list, '건강'), null);
});

test('검색: +프로젝트로 거르기', () => {
  const items = [item(memo('a', '박스', { collectionId: 'p1' })), item(memo('b', '박스'))];
  assert.deepEqual(searchMemos(items, '+이사', COLLS).map((h) => h.memo.id), ['a']);
  assert.deepEqual(searchMemos(items, '박스 +이사준비', COLLS).map((h) => h.memo.id), ['a']);
});

test('찾기로 쓸 글인지', () => {
  assert.equal(isSearchLike('계좌'), true);
  assert.equal(isSearchLike('  '), false);
  assert.equal(isSearchLike('첫 줄\n둘째 줄'), false);
  assert.equal(isSearchLike('가'.repeat(41)), false);
});

test('메모 종류', () => {
  assert.equal(memoKind(memo(1, '# 캡처\n![](img:a)')), 'image');
  assert.equal(memoKind(memo(1, '장보기\n- [ ] 우유')), 'task');
  assert.equal(memoKind(memo(1, '# 기사\n\nhttps://a.com', { sourceUrl: 'https://a.com' })), 'link');
  assert.equal(memoKind(memo(1, '계좌번호\n국민 123')), 'snippet');
  assert.equal(memoKind(memo(1, '# 긴 글\n하나\n둘\n셋')), 'note');
});

test('미리보기: 형광펜 먼저, 기호는 지움', () => {
  assert.equal(previewText('# 제목\n긴 글 ==핵심 하나== 그리고 ==핵심 둘=='), '핵심 하나 · 핵심 둘');
  assert.equal(previewText('# 제목\n- [[다른 메모|별칭]] **굵게** ![](img:a)'), '다른 메모 굵게 🖼');
});

test('다시 보기: 2주 넘은 것 중 하루 동안 같은 것', () => {
  const now = Date.UTC(2026, 9, 19, 3);
  const old = (id) => item(memo(id, id, { updatedAt: now - 30 * 86400000 }));
  const items = [old('a'), old('b'), old('c'), item(memo('new', 'x', { updatedAt: now }))];
  const pick = pickResurface(items, now);
  assert.ok(['a', 'b', 'c'].includes(pick.memo.id));
  assert.equal(pickResurface(items, now + 3600000).memo.id, pick.memo.id);
  assert.notEqual(pickResurface(items, now, 1).memo.id, pick.memo.id);
  assert.equal(pickResurface([items[3]], now), null);
});

test('날짜 묶음 이름', () => {
  const now = new Date(2026, 9, 19, 10).getTime();
  assert.equal(dayLabel(new Date(2026, 9, 19, 1).getTime(), now), '오늘');
  assert.equal(dayLabel(new Date(2026, 9, 18, 23).getTime(), now), '어제');
  assert.equal(dayLabel(new Date(2026, 9, 16).getTime(), now), '10월 16일 (금)');
  assert.equal(dayLabel(new Date(2025, 2, 2).getTime(), now), '2025년 3월 2일');
});

test('키워드: 설명 꼴 알아보기', () => {
  assert.deepEqual(entryOf('PARA: 프로젝트·영역·자료·보관으로 나누는 정리법'), { keyword: 'PARA', desc: '프로젝트·영역·자료·보관으로 나누는 정리법' });
  assert.deepEqual(entryOf('積読:사 놓고 안 읽은 책 #일본어'), { keyword: '積読', desc: '사 놓고 안 읽은 책' });
  assert.deepEqual(entryOf('# 제텔카스텐 : 메모 상자'), { keyword: '제텔카스텐', desc: '메모 상자' });
  assert.deepEqual(entryOf('\n장소법：기억을 장소에 붙이는 법'), { keyword: '장소법', desc: '기억을 장소에 붙이는 법' });
  assert.equal(entryOf('https://a.com/x'), null);
  assert.equal(entryOf('회의 9:30'), null);
  assert.equal(entryOf('12:00'), null);
  assert.equal(entryOf('그냥 한 줄 메모'), null);
});

test('키워드 메모: 제목·미리보기·종류', () => {
  assert.equal(memoTitle('積読: 사 놓고 안 읽은 책'), '積読');
  assert.equal(previewText('積読: 사 놓고 안 읽은 책\n예) 서재 가득'), '사 놓고 안 읽은 책 예) 서재 가득');
  assert.equal(memoKind(memo(1, '積読: 사 놓고 안 읽은 책')), 'keyword');
  assert.equal(memoKind(memo(1, '긴 글: 설명\n둘\n셋\n넷')), 'note');
});

test('키워드로 [[링크]]가 이어짐', () => {
  const a = item(memo('a', '장소법: 기억을 장소에 붙이는 법'));
  const b = item(memo('b', '기억의 궁전: [[장소법]]의 다른 이름'));
  assert.deepEqual(backlinks([a, b], a).map((x) => x.memo.id), ['b']);
});
