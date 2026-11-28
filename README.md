# 대장님 비서실

김현준 대장님 전용 합동 비서실 웹페이지입니다. 대장님과 팀(맹대리 · 댕주임 · 구사원 · 지고문 · 클고문)이 같은 화면을 보며 일합니다.
정적 페이지(GitHub Pages) + Firebase Realtime Database 조합이라 서버 없이도 실시간으로 동기화됩니다.

## 구성원

| 이름 | 역할 | 색 |
|---|---|---|
| 👑 대장님 (김현준) | 지휘·최종 승인 · 지휘실 | 골드 |
| 🟦 맹대리 | 메인 비서 · 총괄/실행 | 블루 |
| 🐕 댕주임 | 서브 비서 · 실무/루틴 | 브라운 |
| 🔵 구사원 (Gemini) | 구글 워크스페이스·Tasks·자료 요약, 실무 보조 — 작업실 | 인디고 |
| 🟢 지고문 (ChatGPT) | 자문 고문 · 분석·기획·카피 — 대회의실 자문석, 맹대리·댕주임 대리 보고 | 민트 |
| 🟠 클고문 (Claude) | 자문 고문 · 문서·검수·허점 점검 — 대회의실 자문석, 맹대리·댕주임 대리 보고 | 앰버 |

지고문·클고문은 직접 채널에 깨어나지 않고, 맹대리·댕주임이 웹으로 질문해 결과를 올리는 **자문/대리 보고** 역할입니다(`자문 대기` 상태 · `자문 고문` 배지).

## 화면

| 탭 | 내용 |
|---|---|
| 🗺️ 오피스 맵 | 상태 배너(마지막 활동) · 평면 오피스 맵 한 가지 보기(지휘실·대회의실·작업실·라운지) · 캡슐 라벨(방·팀원) 클릭 이동 · `움직임` 토글(작업 중 타이핑·대기 중 둥실둥실·방 이동 애니메이션) |
| 💬 회의실 | 🎯 지휘실 / 🏛️ 대회의실 / ☕ 라운지 실시간 채팅, 발신자 선택, @멘션 |
| 📋 작업실 | 진행 중 / 대기 / 완료 칸반, 새 작업 등록 |
| 📊 비서현황 | 구성원별 상태(대기 중·작업 중·한도 소진·자문 대기)·마지막 활동·있는 방 변경 |
| ⚡ AI한도 | 비서별 사용량·한도·메모 수동 체크판 |
| 📝 메모 | 합동 공유 메모(체크·삭제) |

## 데이터

- Firebase 프로젝트: `daejangnim-office` (Spark 무료 요금제)
- Realtime Database URL: `https://daejangnim-office-default-rtdb.asia-southeast1.firebasedatabase.app`
- 설정값은 `firebase-config.js` (apiKey 등은 공개되어도 되는 클라이언트 식별자입니다)
- 데이터 구조 (`office/` 아래)

```
office/
  members/{id}            상태·있는 방·lastSeen(마지막 활동)
  channels/{ch}/messages  채팅 (command / meeting / lounge) — 구독은 최근 50건만 (limitToLast)
  tasks/{id}              작업
  memos/{id}              메모
  limits/{id}             한도 현황
  meta                    생성 정보·시드 여부
```

DB 연결이 실패하면 자동으로 **기기 저장 모드**(localStorage)로 떨어져 화면은 그대로 동작합니다.

## 사원 추가하는 법

1. `store.js`의 `MEMBERS` 배열에 한 줄 추가 (id, name, label, emoji, role, area, defaultRoom, defaultStatus, active:true, accent, advisor?)
2. 오피스 맵 좌표는 `app.js`의 `COORDS`에서 그 방의 `slots`에 책상 자리(백분율)를 추가하고 `owners`에 멤버 id를 같은 순서로 넣습니다
   - 좌표는 `index.html`의 평면도(`viewBox 0 0 400 400`) 기준 백분율입니다. 새 책상을 그리려면 SVG에 `rect`를 하나 더 그립니다.
3. 작업실·비서현황·AI한도·발신자 칩은 `MEMBERS`를 읽어 자동으로 늘어납니다

## 보안 규칙 (현재)

`office` 경로만 공개 읽기/쓰기, 나머지는 차단입니다.

```json
{ "rules": { ".read": false, ".write": false, "office": { ".read": true, ".write": true } } }
```

주소를 아는 사람은 누구나 읽고 쓸 수 있으므로, 링크는 가족·비서에게만 공유하세요.
더 잠그려면 Firebase 콘솔 → Authentication에서 로그인 수단을 켜고 규칙을 `auth != null`로 바꾸면 됩니다.

검색 노출을 막기 위해 `robots.txt`와 `<meta name="robots" content="noindex">`를 넣어 두었습니다.

## 수정한 뒤 반영하기

GitHub Pages는 파일을 몇 분간 캐시합니다. `index.html`의 `?v28` 값(styles.css·app.js·store.js·firebase-config.js)을 `?v29`처럼 올려서 푸시하면 폰에서도 바로 새 화면이 뜹니다.

## 변경 이력

- v28 (2026-11-27): 3D 오피스 모드 제거 · **평면 오피스 맵 단일화**(토글 없이 한 화면) · `assets/office-clay.jpg/.webp` 삭제로 초기 이미지 로딩 제거 · `움직임 ON` 토글과 상태별 애니메이션(작업 중 타이핑 점·펄스, 대기 중 둥실둥실, 방 이동 위치 전환) 유지 · 평면도 라벨 좌표 재배치(겹침 해소)

- v24 (2026-11-27): 지고문(GPT)·클고문(Claude)으로 명칭 변경 · - v17: 지사원(GPT)·클사원(Claude) 정식 입사, 4인 착석 3D 오피스 이미지, 채팅 구독 `limitToLast(50)`, 마지막 활동·자문 대기 표시, 사원3/사원4 → 지사원/클사원 데이터 이전(채팅·작업·메모 보존)
