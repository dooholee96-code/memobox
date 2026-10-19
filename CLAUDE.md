# 메모함 — 작업 메모

개인용 로컬 우선 메모 앱(PWA). 클립보드 + 세컨드브레인(PARA + 제텔카스텐). GitHub Pages(main / root)로 배포.

## 사용자가 정한 것

- 처음 계획(React Native + 크롬 확장 + Next.js + Supabase)은 무거워서 **PWA 하나**로 시작 (2026-10-19)
- 동기화는 **옵시디언처럼 로컬 우선**. 데이터 원본은 기기의 IndexedDB. 서버 없음. 동기화를 붙이더라도 로컬이 원본
- 폰은 아이폰·안드로이드 둘 다 지원 (안드로이드 share_target, 아이폰 단축어 `?text=`)
- 사용자에게 보이는 글(화면, README)은 쉬운 한국어
- **남기는 동선·확인하는 동선 최소화**가 최우선 (2026-10-19). 그래서 화면은 한 줄 흐름: 입력칸 하나(적기+찾기) → 고정 줄(누르면 복사) → 오늘 카드 → 모아보기 칩 → 날짜별 카드. 사이드바·3단 화면은 없앰. 카드는 그 자리에서 펼치고, 편집은 별도 화면(dialog)

## 구조

- `js/core.js` — DOM 없는 순수 함수. 제목(첫 줄), `#태그`(하위 태그 `a/b`), `[[링크]]`, 초성 검색, `paraOf`, 검색 점수, 역링크·관련 메모, 마크다운 렌더(먼저 이스케이프, http(s)/mailto 링크만), ZIP(STORE, UTF-8 이름), md 가져오기/내보내기
- `js/db.js` — IndexedDB `memobox` v1: `memos`, `collections`, `images`(Blob), `meta`
- `js/app.js` — 화면. 프레임워크 없음, 템플릿 문자열 + 이벤트 위임. 겹쳐 뜨는 화면(편집 `#editor`, 시트 `#sheet`)은 `openLayer`/`closeLayer(then)`가 history에 한 칸씩 넣어 폰 뒤로 가기로 닫힘
- 입력칸: `isSearchLike`(한 줄·40자 이하)면 아래 목록을 거름. 저장 시 `parseCapture`로 `+이름`(프로젝트·영역)·`!`(고정)을 떼어 냄. 태그·`+`·초성만 있으면 저장 안 함(찾기 전용). 같은 본문이 있으면 새로 안 만듦
- 공유로 들어온 것(`?title&text&url`)은 편집 화면 없이 바로 받은함에 저장, 같은 주소가 있으면 그 메모를 펼침
- 메모의 `useCount`/`usedAt`(복사), `seenAt`(펼침)은 `updatedAt`을 바꾸지 않음. 고정 줄은 `usedAt` 순, 다시 보기는 `seenAt` 기준
- `sw.js` — 캐시 먼저 보여 주고 뒤에서 갱신. 앱 파일을 바꾸면 `CACHE` 버전을 올릴 것
- PARA: 메모의 `collectionId`(프로젝트/영역) 우선, 없으면 `para`(inbox/resource). `archived` 메모나 보관된 프로젝트의 메모는 보관
- 이미지: 1600px·webp(안 되면 jpeg)로 줄여 `images`에 저장, 본문엔 `![](img:ID)`
- 휴지통 30일 뒤 자동 삭제, 백업 7일 지나면 배너

## 작업할 때

- 판정·검색·렌더 규칙을 바꾸면 `tests/core.test.mjs`를 먼저 고치고 `npm test`
- 새 의존성·빌드 도구는 꼭 필요할 때만
