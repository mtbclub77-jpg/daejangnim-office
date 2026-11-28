/* =========================================================
   app.js — 대장님 비서실 화면 로직
   ========================================================= */
import { createStore, MEMBERS, CHANNELS, ROOMS, STATUSES, ADVISOR_STATUSES, TASK_STATUS, memberById } from './store.js?v76';
import { FIREBASE_CONFIG } from './firebase-config.js?v76';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const ASSISTANTS = MEMBERS.filter(m => !m.chief && m.active);
const ADVISORS = ASSISTANTS.filter(m => m.advisor);
const SEATS = MEMBERS.filter(m => !m.active);
const MSG_LIMIT = 50;   // 채널당 한 번에 받는 최근 메시지 수

let store = null;
const state = {
  view: 'map',
  motion: 'on',
  notify: localStorage.getItem('office.notify') === 'on',
  channel: 'command',
  sender: 'daejangnim',
  members: {},
  tasks: {},
  library: {},
  limits: {},
  schedules: {},
  messages: { command: [], meeting: [], lounge: [] },
  loadedChannels: new Set(),
  seen: { command: 0, meeting: 0, lounge: 0 },
  unread: { command: 0, meeting: 0, lounge: 0 },
  activeRoom: null,
  storeMode: 'connect',
  connected: null,
  loaded: false,
};

/* ---------------- 좌표 (평면도, %) ---------------- */
const COORDS = {
  command: { label: [54, 9.6], anchor: [73, 33], slots: [[73, 25]], owners: ['daejangnim'] },
  meeting: { label: [16, 9.6], anchor: [24, 26], slots: [[16, 18.5], [31, 18.5], [24, 35]], owners: ['jigo', 'keugo', 'gu'] },
  work:    { label: [14, 51], anchor: [34, 70], slots: [[19, 61], [48.5, 61], [33.75, 82]], owners: ['maeng', 'daeng', 'staff4'] },
  lounge:  { label: [83, 51], anchor: [83, 71], slots: [[83, 62], [83, 81]] },
};

/* 상태 → 애니메이션 키 */
const STATUS_KEY = { '작업 중': 'busy', '한도 소진': 'off', '자문 대기': 'adv', '재실': 'idle', '대기 중': 'idle' };
const statusKey = s => STATUS_KEY[s] || 'idle';

/* ---------------- 시간 ---------- */
const pad = n => String(n).padStart(2, '0');
function fmtTime(ts) {
  const d = new Date(ts), h = d.getHours();
  return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${pad(d.getMinutes())}`;
}
function fmtDay(ts) {
  const d = new Date(ts), n = new Date();
  const s = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((s(n) - s(d)) / 86400000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '어제';
  return `${d.getFullYear() !== n.getFullYear() ? d.getFullYear() + '년 ' : ''}${d.getMonth() + 1}월 ${d.getDate()}일`;
}
function timeAgo(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  if (d < 60000) return '방금';
  if (d < 3600000) return `${Math.floor(d / 60000)}분 전`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}시간 전`;
  return `${Math.floor(d / 86400000)}일 전`;
}

/* ---------------- 상태 헬퍼 ---------------- */
function memState(id) {
  const m = memberById(id), s = state.members[id] || {};
  return { status: s.status || m.defaultStatus, room: s.room || m.defaultRoom };
}
function statusPillCls(status, active = true) {
  if (!active) return 'empty';
  if (status === '작업 중') return 'busy';
  if (status === '한도 소진') return 'off';
  if (status === '자문 대기') return 'adv';
  if (status === '재실') return 'on';
  return 'on';
}

/* 마지막 활동 — 저장된 lastSeen과 실제 기록(메시지·작업·메모) 중 가장 최근 시각 */
function lastSeenOf(id) {
  let t = Number((state.members[id] || {}).lastSeen) || 0;
  Object.values(state.messages || {}).forEach(arr => (arr || []).forEach(m => {
    if (m && m.senderId === id && m.ts > t) t = m.ts;
  }));
  Object.values(state.tasks || {}).forEach(x => {
    if (x && x.assignee === id && x.ts > t) t = x.ts;
  });
  Object.values(state.library || {}).forEach(x => {
    if (x && x.by === id && x.ts > t) t = x.ts;
  });
  return t;
}
function fmtAbsolute(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${fmtTime(ts)}`;
}
function lastSeenText(m) {
  const t = lastSeenOf(m.id);
  if (t) return timeAgo(t);
  return m.advisor ? '자문 대기' : '기록 없음';
}
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('is-on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('is-on'), 2200);
}

/* =========================================================
   오피스 맵
   ========================================================= */
function renderMap() {
  const active = MEMBERS.filter(m => m.active);
  const busy = ASSISTANTS.filter(a => !a.advisor).filter(a => memState(a.id).status === '작업 중').length;
  const off = ASSISTANTS.filter(a => !a.advisor).filter(a => memState(a.id).status === '한도 소진').length;
  const waiting = ASSISTANTS.filter(a => !a.advisor).length - busy - off;
  const advOn = ADVISORS.filter(a => memState(a.id).status !== '한도 소진').length;

  let head;
  if (busy && waiting) head = `대장님, 비서 ${busy}명 작업 중 · ${waiting}명 대기 중이에요`;
  else if (busy) head = `대장님, 비서 ${busy}명이 작업 중이에요`;
  else if (off === ASSISTANTS.filter(a => !a.advisor).length) head = '대장님, 비서들이 한도를 다 썼어요';
  else head = `대장님, 비서 ${waiting || ASSISTANTS.filter(a => !a.advisor).length}명이 대기 중이에요`;
  $('#mapHeadline').textContent = head;
  $('#mapSub').textContent = ADVISORS.length
    ? `${ADVISORS.map(a => a.label).join('·')} ${advOn}명 대기 — 밍인턴이 웹으로 자문·조사 후 회의실에 결과를 올려요.`
    : '방을 눌러 들어가 보세요. 방마다 비서들이 일하고 있어요.';

  const lastEl = $('#mapLastSeen');
  if (lastEl) renderLastSeen();

  const roomsOn = Object.keys(ROOMS).filter(r => active.some(m => memState(m.id).room === r)).length;
  $('#roomsOn').textContent = roomsOn;
  $('#peopleOn').textContent = active.length;
  $('#seatsEmpty').textContent = SEATS.length;
  const seatChip = $('#chipSeats');
  if (seatChip) seatChip.hidden = SEATS.length === 0;
  const seatLegend = $('#legendSeat');
  if (seatLegend) seatLegend.hidden = SEATS.length === 0;

  renderOverlay();
  renderMiniList();
  if (state.activeRoom) renderRoomSheet(state.activeRoom);
}

/* 배너의 마지막 활동 줄만 갱신 — 메시지·작업·메모가 늦게 로드돼도 바로 반영 */
function refreshStatusSeen() {
  if (state.view === 'status') renderStatus();
}

function renderLastSeen() {
  const lastEl = $('#mapLastSeen');
  if (!lastEl) return;
  lastEl.innerHTML = '<span class="bl-lbl">마지막 활동</span>' + ASSISTANTS.map(a => {
    const t = lastSeenOf(a.id);
    return `<span class="bl-item" title="${t ? esc(fmtAbsolute(t)) : ''}"><b>${esc(a.label)}</b> ${esc(lastSeenText(a))}</span>`;
  }).join('');
}

function coords() { return COORDS; }

/* 움직임 토글 상태를 화면에 반영 */
function applyMotion() {
  const on = state.motion !== 'off';
  $('#stage').dataset.motion = on ? 'on' : 'off';
  const btn = $('#motionToggle');
  if (btn) {
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
  }
  const st = $('#motionState');
  if (st) st.textContent = on ? 'ON' : 'OFF';
}

function positionsFor(roomKey) {
  const c = coords()[roomKey];
  const inRoom = MEMBERS.filter(m => memState(m.id).room === roomKey);
  const map = {};
  if (c.slots) {
    // 방마다 정해 둔 자리 주인(owners)을 먼저 앉히고, 나머지는 빈자리 순서대로
    const owners = c.owners || [];
    const taken = new Set();
    owners.forEach((id, i) => {
      const m = inRoom.find(x => x.id === id);
      if (m && !map[m.id] && i < c.slots.length) { map[m.id] = c.slots[i]; taken.add(i); }
    });
    const free = c.slots.map((_, i) => i).filter(i => !taken.has(i));
    inRoom.filter(m => !map[m.id]).forEach((m, k) => {
      map[m.id] = c.slots[free.length ? free[k % free.length] : k % c.slots.length];
    });
  }
  // 자리가 모자라면 방 중앙 기준으로 흩뿌리되 무대 밖으로 나가지 않게 가둡니다
  const used = Object.values(map);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  inRoom.forEach(m => {
    if (map[m.id]) return;
    const i = used.length;
    map[m.id] = [
      clamp(c.anchor[0] + (i - (inRoom.length - 1) / 2) * 16, 8, 92),
      clamp(c.anchor[1] + (i % 2 ? 5 : -5), 5, 94),
    ];
    used.push(map[m.id]);
  });
  return map;
}

const TAG_NODES = new Map();   // key → 실제 버튼 요소 (방 이동 시 위치가 미끄러지도록 재사용)

function renderOverlay() {
  const c = coords();
  const host = $('#overlay');
  const want = new Map();

  // 방 라벨
  Object.entries(ROOMS).forEach(([key, r]) => {
    const pos = c[key].label;
    const n = MEMBERS.filter(m => m.active && memState(m.id).room === key).length;
    want.set('room:' + key, {
      cls: `tag tag-room ${state.activeRoom === key ? 'is-on' : ''}`,
      title: `${r.name} · ${n ? n + '명' : '비어 있음'}`,
      left: pos[0], top: pos[1], bob: null,
      attrs: { 'data-room': key },
      inner: `<span class="room-ico">${r.icon}</span>${esc(r.name)}`,
    });
  });

  // 인원 라벨 (빈자리 포함) — 상태에 따라 숨쉬기/타이핑 애니메이션
  Object.keys(ROOMS).forEach(room => {
    const posMap = positionsFor(room);
    MEMBERS.filter(m => memState(m.id).room === room).forEach((m, i) => {
      const p = posMap[m.id] || c[room].anchor;
      const st = memState(m.id);
      const dot = m.chief ? 'is-wait' : statusPillCls(st.status, m.active);
      const key = m.chief ? 'chief' : (m.active ? statusKey(st.status) : 'empty');
      const label = m.active ? esc(m.label) : `${esc(m.name)} <em>(예정)</em>`;
      const typing = m.active && !m.chief && st.status === '작업 중'
        ? '<span class="type-dots" aria-hidden="true"><i></i><i></i><i></i></span>'
        : '';
      want.set('member:' + m.id, {
        cls: `tag ${m.active ? 'tag-member' : 'tag-seat'} st-${key}`,
        title: `${m.label} · ${m.chief ? '총괄' : (m.active ? st.status : '충원 예정')}`,
        left: p[0], top: p[1], bob: (-((i % 3) * 1.25)).toFixed(2) + 's',
        attrs: { 'data-member': m.id, 'data-room': room },
        inner: `${m.chief ? '<span>👑</span>' : `<i class="tag-dot ${dot}"></i>`}<span class="tag-nm">${label}</span>${typing}`,
      });
    });
  });

  // 없어진 라벨 제거
  Array.from(TAG_NODES.keys()).forEach(key => {
    if (want.has(key)) return;
    const el = TAG_NODES.get(key);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    TAG_NODES.delete(key);
  });

  // 새로 만들거나, 같은 요소를 움직여 자리 이동을 애니메이션으로 보여 줍니다
  want.forEach((v, key) => {
    const sig = v.cls + '|' + v.title + '|' + v.inner;
    let el = TAG_NODES.get(key);
    if (!el) {
      el = document.createElement('button');
      el.type = 'button';
      Object.entries(v.attrs).forEach(([a, b]) => el.setAttribute(a, b));
      el.className = v.cls;
      el.title = v.title;
      el.style.left = v.left + '%';
      el.style.top = v.top + '%';
      if (v.bob) el.style.setProperty('--bob', v.bob);
      el.dataset.sig = sig;
      el.innerHTML = v.inner;
      TAG_NODES.set(key, el);
      host.appendChild(el);
      return;
    }
    el.style.left = v.left + '%';
    el.style.top = v.top + '%';
    Object.entries(v.attrs).forEach(([a, b]) => { if (el.getAttribute(a) !== b) el.setAttribute(a, b); });
    if (el.dataset.sig !== sig) {
      el.className = v.cls;
      el.title = v.title;
      el.dataset.sig = sig;
      el.innerHTML = v.inner;
    }
  });
}

function renderMiniList() {
  const host = $('#memberMiniList');
  host.innerHTML = MEMBERS.map(m => {
    const st = memState(m.id);
    const room = ROOMS[st.room] || ROOMS.work;
    return `<button class="mini-row" data-member="${m.id}">
      <span class="mini-av">${m.emoji}</span>
      <span class="mini-txt">
        <b>${esc(m.label)}${m.advisor ? ` <span class="badge-delegate">${esc(m.badge || '자문 고문')}</span>` : ''} <span class="mini-role">${esc(m.role)}</span></b>
        <span>${room.icon} ${room.name} · ${esc(m.area)}</span>
      </span>
      <span class="mini-right"><span class="pill ${m.chief ? 'is-wait' : statusPillCls(st.status, m.active)}">${esc(m.chief ? '최종 결정' : (m.active ? st.status : '충원 예정'))}</span></span>
    </button>`;
  }).join('');
}

function renderRoomSheet(roomKey) {
  const r = ROOMS[roomKey];
  const people = MEMBERS.filter(m => memState(m.id).room === roomKey);
  const sheet = $('#roomSheet');
  const chOf = { command: 'command', meeting: 'meeting', lounge: 'lounge' }[roomKey];
  sheet.hidden = false;
  sheet.innerHTML = `
    <h3><span>${r.icon} ${esc(r.name)}</span><button type="button" data-sheet="close" aria-label="닫기">✕</button></h3>
    <div class="sheet-people">
      ${people.length ? people.map(m => `<span class="sheet-person">${m.emoji} ${esc(m.label)} · <b style="color:var(--muted);font-weight:600">${esc(m.chief ? '총괄' : (m.active ? memState(m.id).status : '충원 예정'))}</b></span>`).join('')
        : '<span class="sheet-person">아직 아무도 없어요</span>'}
    </div>
    <div class="sheet-actions">
      ${chOf ? `<button class="primary-btn" type="button" data-sheet="chat" data-channel="${chOf}">💬 이 방에서 대화</button>` : ''}
      ${roomKey === 'work' ? `<button class="ghost-btn" type="button" data-sheet="tasks">📋 작업실 열기</button>` : ''}
      <button class="ghost-btn" type="button" data-sheet="status">📊 비서현황</button>
    </div>`;
}

/* =========================================================
   회의실
   ========================================================= */
function renderChatHud() {
  const hud = $('#chatHud');
  if (!hud) return;
  const tasks = Object.values(state.tasks || {}).filter(Boolean);
  const doing = tasks.filter(t => t.status === 'doing').length;
  const waiting = tasks.filter(t => t.status === 'waiting').length;
  const done = tasks.filter(t => t.status === 'done').length;
  const on = MEMBERS.filter(m => m.active && memState(m.id).status !== '한도 소진').length;
  hud.innerHTML = `
    <button class="hud-pill is-doing" type="button" data-hud="tasks">⚡ 진행 <b>${doing}</b></button>
    <button class="hud-pill" type="button" data-hud="tasks">⏳ 대기 <b>${waiting}</b></button>
    <button class="hud-pill is-done" type="button" data-hud="tasks">✅ 완료 <b>${done}</b></button>
    <button class="hud-pill is-on" type="button" data-hud="status">🟢 출근 <b>${on}명</b></button>
  `;
}

function renderChat(scrollBottom = false) {
  const ch = state.channel;
  $('#chanTitle').textContent = CHANNELS[ch].label;
  const on = MEMBERS.filter(m => m.active && memState(m.id).status !== '한도 소진').length;
  $('#chanOn').textContent = `ON ${on}명`;
  renderChatHud();

  const arr = state.messages[ch] || [];
  const list = $('#chatList');
  if (!arr.length) {
    list.innerHTML = `<div class="msg-empty">아직 대화가 없어요.<br><b>첫 메시지</b>를 보내 보세요.</div>`;
  } else {
    let html = '', day = '';
    arr.forEach(m => {
      const d = fmtDay(m.ts);
      if (d !== day) { html += `<div class="day-sep">${esc(d)}</div>`; day = d; }
      html += msgHtml(m);
    });
    list.innerHTML = html;
  }
  if (scrollBottom) {
    const sc = $('#chatScroll');
    requestAnimationFrame(() => { sc.scrollTop = sc.scrollHeight; });
  }
}

function msgHtml(m) {
  const mb = memberById(m.senderId);
  const me = m.senderId === 'daejangnim';
  const text = m.text ? esc(m.text).replace(/@([가-힣A-Za-z0-9_]+)/g, '<span class="m-mention">@$1</span>') : '';
  const imgHtml = m.img ? `<img class="m-img" src="${esc(m.img)}" alt="첨부 사진" loading="lazy">` : '';
  const fileHtml = m.file ? `<a class="m-file" href="${esc(m.file.data)}" download="${esc(m.file.name)}">📎 ${esc(m.file.name)} <span>(${Math.max(1, Math.round((m.file.size || 0) / 1024))}KB)</span></a>` : '';
  const ackCls = (m.ack === '전달됨' || m.ack === '처리 중') ? 'is-wait' : (m.ack === '실패' ? 'is-err' : '');
  const ackHtml = (me && m.ack) ? `<span class="m-ack ${ackCls}">${esc(m.ack)}</span>` : '';
  return `<div class="msg ${me ? 'me' : ''}">
      <span class="m-av">${mb.emoji}</span>
      <div class="m-body">
        <div class="m-meta"><b>${esc(mb.label)}</b><span>${esc(mb.role || '')}</span><span>${fmtTime(m.ts)}</span>${ackHtml}<button class="m-to-task" type="button" data-to-task="${esc(m.id)}" title="작업실 카드로 등록">📋 작업등록</button></div>
        <div class="m-bubble">${imgHtml}${fileHtml}${text ? `<div>${text}</div>` : ''}</div>
      </div>
    </div>`;
}

function renderHeartbeat() {
  const el = $('#hbWarn');
  if (!el) return;
  const ts = state.heartbeat && state.heartbeat.ts;
  if (!ts) { el.hidden = true; return; }
  const ageMs = Date.now() - ts;
  if (ageMs > 12 * 60 * 1000) {
    el.innerHTML = `<span>⚠️ <b>자동 감시 멈춤</b> · 마지막 확인 ${esc(timeAgo(ts))} (한도 소진·퇴근 상태일 수 있음)</span>`;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

function onMessages(channel, obj) {
  const arr = Object.entries(obj || {})
    .map(([id, v]) => Object.assign({ id }, v))
    .filter(m => m && typeof m.ts === 'number')
    .sort((a, b) => a.ts - b.ts)
    .slice(-MSG_LIMIT);
  state.messages[channel] = arr;
  const maxTs = arr.length ? arr[arr.length - 1].ts : 0;

  if (!state.loadedChannels.has(channel)) {
    state.loadedChannels.add(channel);
    state.seen[channel] = maxTs;
  } else {
    const prevMax = state.seen[channel] || 0;
    const incoming = arr.filter(m => m.ts > prevMax && m.senderId !== 'daejangnim');
    if (incoming.length && state.notify) {
      notifyIncoming(incoming[incoming.length - 1]);
    }
    const open = state.view === 'chat' && state.channel === channel;
    if (open) {
      state.seen[channel] = maxTs;
    } else {
      const missed = arr.filter(m => m.ts > state.seen[channel]).length;
      if (missed) state.unread[channel] = (state.unread[channel] || 0) + missed;
    }
  }
  updateBadge();
  renderLastSeen();
  refreshStatusSeen();
  if (state.view === 'chat' && state.channel === channel) {
    const sc = $('#chatScroll');
    const atBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 90;
    renderChat(atBottom);
  }
}

function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [587.33, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.11;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.24);
    });
  } catch {}
}

function notifyIncoming(m) {
  playChime();
  const mb = memberById(m.senderId);
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try {
      new Notification(`${mb.emoji} ${mb.label}`, {
        body: m.text.slice(0, 120),
        icon: 'assets/icon-192.png?v50',
        tag: 'daejangnim-office-msg',
      });
    } catch {}
  }
}

function renderNotifyBtn() {
  const b = $('#notifyBtn');
  if (!b) return;
  b.classList.toggle('is-on', state.notify);
  b.textContent = state.notify ? '🔔 알림' : '🔕 알림';
}

function updateBadge() {
  const total = Object.values(state.unread).reduce((a, b) => a + b, 0);
  const b = $('#badgeChat');
  b.hidden = total === 0;
  b.title = total ? `새 메시지 ${total}건` : '';
}
function markChannelSeen(channel) {
  state.seen[channel] = (state.messages[channel] || []).reduce((a, m) => Math.max(a, m.ts), 0);
  state.unread[channel] = 0;
  updateBadge();
}

function renderSenderChips() {
  const mentions = ASSISTANTS.filter(a => !a.advisor).map(a => '@' + a.label);
  $('#mentionRow').innerHTML = mentions.map(m => `<button class="mention" type="button" data-mention="${m}">${esc(m)}</button>`).join('');
}

function renderAttachPreview() {
  const host = $('#attachPreview');
  if (!host) return;
  const att = state.pendingAttach;
  if (!att) { host.hidden = true; host.innerHTML = ''; return; }
  host.innerHTML = `<span>${att.kind === 'image' ? '🖼️' : '📎'} ${esc(att.name)}</span><button type="button" id="attachClear" aria-label="첨부 취소">✕</button>`;
  host.hidden = false;
  const clr = $('#attachClear');
  if (clr) clr.addEventListener('click', () => { state.pendingAttach = null; renderAttachPreview(); });
}

function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const maxSide = 1000;
        let w = img.width, h = img.height;
        if (w > maxSide || h > maxSide) {
          if (w >= h) { h = Math.round(h * maxSide / w); w = maxSide; }
          else { w = Math.round(w * maxSide / h); h = maxSide; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve({ kind: 'image', name: file.name, data: canvas.toDataURL('image/jpeg', 0.74) });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function readSmallFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve({ kind: 'file', name: file.name, size: file.size, data: reader.result });
    reader.readAsDataURL(file);
  });
}

function getMsgText(el) {
  return (el.innerText || '').replace(/\u00a0/g, ' ');
}
function placeCaretAtEnd(el) {
  if (!el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}
function insertPlainTextAtCaret(text) {
  const el = $('#msgInput');
  if (!el) return;
  el.focus();
  if (!document.execCommand || !document.execCommand('insertText', false, text)) {
    el.textContent = getMsgText(el) + text;
    placeCaretAtEnd(el);
  }
}

async function sendMessage() {
  const input = $('#msgInput');
  const text = getMsgText(input).trim();
  const att = state.pendingAttach;
  if ((!text && !att) || !store) return;
  const sender = memberById(state.sender);
  input.textContent = '';
  autoGrow(input);
  state.pendingAttach = null;
  renderAttachPreview();
  const payload = { senderId: sender.id, text, ts: Date.now() };
  if (att && att.kind === 'image') payload.img = att.data;
  if (att && att.kind === 'file') payload.file = { name: att.name, size: att.size, data: att.data };
  try {
    await store.push(`channels/${state.channel}/messages`, payload);
    store.update(`members/${sender.id}`, { lastSeen: Date.now() }).catch(() => {});
    markChannelSeen(state.channel);
  } catch (e) {
    console.error(e);
    toast('전송 실패 — 연결을 확인해 주세요');
  }
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

/* =========================================================
   작업실
   ========================================================= */
function renderTasks() {
  const groups = { doing: [], waiting: [], done: [] };
  Object.entries(state.tasks || {}).forEach(([id, t]) => {
    if (!t) return;
    const s = groups[t.status] ? t.status : 'waiting';
    groups[s].push(Object.assign({ id }, t));
  });
  Object.values(groups).forEach(g => g.sort((a, b) => (b.ts || 0) - (a.ts || 0)));

  const col = (key) => {
    const g = groups[key];
    const isDone = key === 'done';
    const collapsed = isDone && !state.doneOpen;
    const body = collapsed
      ? `<button type="button" class="col-empty" data-toggle-done style="width:100%;cursor:pointer">완료된 ${g.length}건 펼쳐보기 ▾</button>`
      : (g.length
        ? g.map(t => {
            const a = t.assignee === 'all' ? { emoji: '👥', label: '전체' } : memberById(t.assignee);
            const lastUpd = t.updatedAt || t.ts || 0;
            const isStale = key === 'doing' && lastUpd && (Date.now() - lastUpd > 24 * 60 * 60 * 1000);
            const badges = [
              t.kind ? `<span class="t-badge">${esc(t.kind)}</span>` : '',
              t.due ? `<span class="t-badge is-due">📅 ${esc(t.due)}</span>` : '',
              isStale ? `<span class="t-badge is-stale">⏳ 정체 24h+</span>` : '',
            ].filter(Boolean).join('');
            return `<div class="task ${isDone ? 'is-done' : ''} ${isStale ? 'is-stale' : ''}">
              <div class="task-txt">${badges ? `<div class="task-badges">${badges}</div>` : ''}${esc(t.title)}</div>
              <div class="task-meta">
                <span class="task-who">${a.emoji} ${esc(a.label)} · ${timeAgo(t.ts)}</span>
                <span class="task-btns">
                  <button class="tb" data-task="${t.id}" data-act="left" title="이전 단계" aria-label="이전 단계">◀</button>
                  <button class="tb" data-task="${t.id}" data-act="right" title="다음 단계" aria-label="다음 단계">▶</button>
                  <button class="tb del" data-task="${t.id}" data-act="del" title="삭제" aria-label="삭제">✕</button>
                </span>
              </div>
            </div>`;
          }).join('')
        : `<div class="col-empty">비어 있어요</div>`);
    const headRight = isDone
      ? `<button type="button" data-toggle-done style="font-size:12px;color:var(--muted);cursor:pointer">${g.length}건 ${state.doneOpen ? '접기 ▴' : '펼치기 ▾'}</button>`
      : `<span>${g.length}건</span>`;
    return `<section class="col ${key}">
      <div class="col-head"><b><i></i>${TASK_STATUS[key]}</b>${headRight}</div>
      <div class="col-body">${body}</div>
    </section>`;
  };

  $('#kanban').innerHTML = col('doing') + col('waiting') + col('done');
  $('#kanban').querySelectorAll('[data-toggle-done]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.doneOpen = !state.doneOpen;
      renderTasks();
    });
  });
}

function fillAssigneeOptions() {
  const sel = $('#taskAssignee');
  const opts = [`<option value="all">👥 전체</option>`]
    .concat(ASSISTANTS.map(a => `<option value="${a.id}">${a.emoji} ${esc(a.label)}</option>`));
  sel.innerHTML = opts.join('');
}

async function addTask(ev) {
  ev.preventDefault();
  const title = $('#taskTitle').value.trim();
  if (!title) { $('#taskTitle').focus(); return; }
  const assignee = $('#taskAssignee').value;
  const status = $('#taskStatus').value;
  const kind = ($('#taskKind') && $('#taskKind').value) || '신규';
  const due = ($('#taskDue') && $('#taskDue').value.trim()) || '';
  const now = Date.now();
  await store.push('tasks', { title, assignee, status, kind, due, ts: now, updatedAt: now });
  $('#taskTitle').value = '';
  if ($('#taskDue')) $('#taskDue').value = '';
  $('#taskForm').hidden = true;
  toast('작업을 등록했어요');
}

const ORDER = ['doing', 'waiting', 'done'];
async function taskAction(id, act) {
  const t = (state.tasks || {})[id];
  if (!t) return;
  if (act === 'del') {
    await store.remove(`tasks/${id}`);
    toast('작업을 삭제했어요');
    return;
  }
  const i = ORDER.indexOf(t.status || 'waiting');
  const ni = act === 'left' ? Math.max(0, i - 1) : Math.min(ORDER.length - 1, i + 1);
  if (ni === i) return;
  await store.update(`tasks/${id}`, { status: ORDER[ni], updatedAt: Date.now() });
}

function renderBriefing() {
  const el = $('#briefCard');
  if (!el) return;
  const all = Object.values(state.tasks || {}).filter(Boolean);
  const doingN = all.filter(t => t.status === 'doing').length;
  const waitN = all.filter(t => t.status === 'waiting').length;
  const doneN = all.filter(t => t.status === 'done').length;
  const b = state.briefing || {};
  const open = state.briefOpen !== false;
  const doneTxt = b.doneSummary || `완료 ${doneN}건`;
  const todoTxt = b.todoSummary || (doingN || waitN ? `진행 ${doingN}건 · 대기 ${waitN}건` : '대기 작업 없음');
  const warnTxt = b.warnSummary || '특이사항 없음';
  el.innerHTML = `
    <div class="brief-head">
      <b>📊 30초 일일 브리핑</b>
      <div class="brief-right">
        <span class="brief-counts">진행 ${doingN} · 대기 ${waitN} · 완료 ${doneN}</span>
        <button type="button" class="brief-toggle" id="briefToggle">${open ? '접기 ▴' : '펼치기 ▾'}</button>
      </div>
    </div>
    ${open ? `<div class="brief-body">
      <div><b>✅ 완료</b><span>${esc(doneTxt)}</span></div>
      <div><b>📌 오늘</b><span>${esc(todoTxt)}</span></div>
      <div><b>⚠️ 주의</b><span>${esc(warnTxt)}</span></div>
    </div>` : ''}`;
  const btn = $('#briefToggle');
  if (btn) btn.addEventListener('click', () => { state.briefOpen = !open; renderBriefing(); });
}

/* =========================================================
   비서현황 / 한도 / 메모
   ========================================================= */
function renderStatus() {
  const host = $('#statusGrid');
  host.innerHTML = MEMBERS.map(m => {
    const st = memState(m.id);
    const opts = m.chief ? ['재실', ...STATUSES] : m.advisor ? ADVISOR_STATUSES : STATUSES;
    const statusBtns = opts.map(s =>
      `<button class="sbtn ${st.status === s && m.active ? 'is-on' : ''}" data-status="${s}" data-member="${m.id}" ${m.active ? '' : 'disabled style="opacity:.4"'}>${s}</button>`
    ).join('');
    const roomBtns = Object.entries(ROOMS).map(([k, r]) =>
      `<button class="rbtn ${st.room === k ? 'is-on' : ''}" data-room-set="${k}" data-member="${m.id}">${r.icon} ${r.name}</button>`
    ).join('');
    const seen = lastSeenOf(m.id);
    const seenTxt = seen ? timeAgo(seen) : (m.advisor ? '자문 대기' : '기록 없음');
    const activeTasks = !m.chief ? Object.values(state.tasks || {})
      .filter(t => t && t.assignee === m.id && (t.status === 'doing' || t.status === 'waiting'))
      .sort((a, b) => (a.status === 'doing' ? -1 : 1) - (b.status === 'doing' ? -1 : 1)) : [];
    const schedRaw = state.schedules[m.id];
    const schedList = Array.isArray(schedRaw) ? schedRaw : (schedRaw && typeof schedRaw === 'object' ? Object.values(schedRaw) : []);
    const workBlock = (!m.chief && m.active) ? `
      <div class="mcard-work">
        <div class="mcard-work-sec">
          <span class="mcard-lbl">진행 업무</span>
          <div class="mcard-work-items">${activeTasks.length ? activeTasks.slice(0, 4).map(t =>
            `<div class="mcard-witem"><span class="wbadge ${t.status === 'doing' ? 'doing' : 'wait'}">${t.status === 'doing' ? '진행 중' : '대기'}</span><span>${esc(t.title)}</span></div>`
          ).join('') + (activeTasks.length > 4 ? `<div class="muted">외 ${activeTasks.length - 4}건</div>` : '') : '<span class="muted">현재 배정된 작업 없음</span>'}</div>
        </div>
        <div class="mcard-work-sec">
          <span class="mcard-lbl">정기 스케줄</span>
          <div class="mcard-work-items">${schedList.length ? schedList.map(s =>
            `<div class="mcard-witem"><span class="wbadge sched">루틴</span><span>${esc(s)}</span></div>`
          ).join('') : '<span class="muted">상시 호출 대기</span>'}</div>
        </div>
      </div>` : '';
    const pillText = m.chief ? '최종 결정' : (m.active ? st.status : '충원 예정');
    const pillCls = m.chief ? 'is-wait' : statusPillCls(st.status, m.active);
    const controlsBlock = m.chief ? '' : `
      <div class="mcard-row">
        <span class="mcard-lbl">상태</span>
        <div class="status-btns">${statusBtns}</div>
      </div>
      <div class="mcard-row" style="margin-top:9px">
        <span class="mcard-lbl">있는 방</span>
        <div class="room-btns">${roomBtns}</div>
      </div>`;
    return `<article class="mcard ${m.active ? '' : 'is-empty'}">
      <div class="mcard-top">
        <span class="mcard-av" data-accent="${m.accent || ''}">${m.emoji}</span>
        <span class="mcard-name"><b>${esc(m.label)}</b><span>${esc(m.role)}${m.chief ? ' · 총괄' : ''}</span></span>
        <span class="pill ${pillCls}">${esc(pillText)}</span>
      </div>
      <div class="mcard-area">${esc(m.area)}</div>
      ${workBlock}
      <div class="mcard-meta">
        ${m.advisor ? `<span class="badge-delegate">${esc(m.badge || '자문 고문')}</span>` : ''}
        <span class="mcard-seen" title="${seen ? esc(fmtAbsolute(seen)) : ''}">마지막 활동 <b>${esc(seenTxt)}</b></span>
      </div>
      ${controlsBlock}
    </article>`;
  }).join('');
  $('#statusUpdated').textContent = state.loaded ? '실시간 반영 중' : '불러오는 중…';
}

function renderLimits() {
  const list = MEMBERS.filter(m => m.active && !m.chief);
  $('#limitsList').innerHTML = list.map(m => {
    const l = state.limits[m.id] || { memo: '', updatedAt: 0 };
    const st = memState(m.id);
    const isOff = st.status === '한도 소진' || l.state === '퇴근';
    return `<article class="lcard">
      <div class="lcard-top">
        <span class="mcard-av">${m.emoji}</span>
        <b>${esc(m.label)}</b>
        <span class="pill ${isOff ? 'off' : 'on'}">${isOff ? '퇴근' : '출근'}</span>
      </div>
      <div class="sbtns" style="margin:8px 0">
        <button class="sbtn ${!isOff ? 'is-on' : ''}" type="button" data-att-btn="출근" data-member="${m.id}">출근 (사용량 있음)</button>
        <button class="sbtn ${isOff ? 'is-on' : ''}" data-status="한도 소진" type="button" data-att-btn="퇴근" data-member="${m.id}">퇴근 (한도 소진)</button>
      </div>
      <div class="linputs">
        <label class="field grow"><span>메모</span><input type="text" maxlength="80" value="${esc(l.memo || '')}" data-limit-field="memo" data-member="${m.id}"></label>
        <button class="lsave" type="button" data-limit-save="${m.id}">저장</button>
      </div>
      <div class="lupdated">${l.updatedAt ? '마지막 갱신 ' + timeAgo(l.updatedAt) : '아직 기록 없음'}</div>
    </article>`;
  }).join('');
}

function renderLibrary() {
  const arr = Object.entries(state.library || {})
    .map(([id, v]) => Object.assign({ id }, v || {}))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  $('#libCount').textContent = arr.length ? `총 ${arr.length}건` : '';
  $('#libList').innerHTML = arr.length ? arr.map(item => `
    <div class="lib-item">
      <div class="lib-body">
        <div class="lib-title">${esc(item.title || '제목 없음')}</div>
        <div class="lib-meta">${item.tag ? `<span class="lib-tag">${esc(item.tag)}</span>` : ''}${item.by ? esc(memberById(item.by).label) : ''} · ${timeAgo(item.ts)}</div>
      </div>
      <div class="lib-acts">
        ${item.url ? `<a class="lib-open" href="${esc(item.url)}" target="_blank" rel="noopener">열기 ↗</a>` : ''}
        <button class="memo-del" type="button" data-lib-del="${item.id}" aria-label="삭제">✕</button>
      </div>
    </div>`).join('') : `<div class="col-empty">아직 등록된 자료가 없어요. 비서실이 만든 문서가 여기 자동으로 쌓입니다.</div>`;
}

/* =========================================================
   연결 상태 / 라우팅
   ========================================================= */
function updateConnPill() {
  const pill = $('#connPill'), txt = $('#connText');
  pill.classList.remove('is-local', 'is-off');
  if (state.storeMode === 'local') {
    pill.classList.add('is-local');
    txt.textContent = '기기 저장';
    $('#footMode').textContent = '기기 저장 모드 · 이 기기에만 저장돼요';
  } else if (state.connected) {
    txt.textContent = '실시간 연결';
    $('#footMode').textContent = 'Firebase 실시간 연결';
  } else {
    pill.classList.add('is-off');
    txt.textContent = '다시 연결 중';
    $('#footMode').textContent = '연결 대기 중… (보낸 내용은 연결되면 전송돼요)';
  }
}

function applyRoute() {
  const raw = location.hash.replace(/^#/, '') || 'map';
  const [v, ch] = raw.split('/');
  const view = ['map', 'chat', 'tasks', 'status', 'limits', 'library'].includes(v) ? v : 'map';
  if (view === 'chat') {
    state.channel = 'command';
  }
  state.view = view;
  $$('.tab').forEach(b => {
    const on = b.dataset.view === view;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', String(on));
  });
  $$('.view').forEach(s => s.classList.toggle('is-on', s.id === 'view-' + view));

  if (view === 'chat') { markChannelSeen(state.channel); renderChat(true); }
  if (view === 'map') renderMap();
  if (view === 'tasks') renderTasks();
  if (view === 'status') renderStatus();
  if (view === 'limits') renderLimits();
  if (view === 'library') renderLibrary();
}

function go(view, channel) {
  const h = view === 'chat' && channel ? `#chat/${channel}` : `#${view}`;
  if (location.hash === h) applyRoute();
  else location.hash = h;
}

/* =========================================================
   이벤트
   ========================================================= */
function wire() {
  // 탭
  $('#tabs').addEventListener('click', e => {
    const t = e.target.closest('.tab');
    if (t) go(t.dataset.view);
  });
  window.addEventListener('hashchange', applyRoute);

  // 움직임 토글
  $('#motionToggle').addEventListener('click', () => {
    state.motion = state.motion === 'on' ? 'off' : 'on';
    localStorage.setItem('office.motion', state.motion);
    applyMotion();
  });

  // 맵 오버레이 / 멤버 리스트
  $('#overlay').addEventListener('click', e => {
    const tag = e.target.closest('.tag');
    if (!tag) return;
    if (tag.dataset.member) {
      openRoom(tag.dataset.room);
      toast(`${memberById(tag.dataset.member).label} · ${memState(tag.dataset.member).status}`);
      return;
    }
    openRoom(tag.dataset.room);
  });
  $('#memberMiniList').addEventListener('click', e => {
    const row = e.target.closest('.mini-row');
    if (row) go('status');
  });
  $('#roomSheet').addEventListener('click', e => {
    const b = e.target.closest('[data-sheet]');
    if (!b) return;
    const act = b.dataset.sheet;
    if (act === 'close') { state.activeRoom = null; $('#roomSheet').hidden = true; renderOverlay(); return; }
    if (act === 'chat') { go('chat', b.dataset.channel); return; }
    if (act === 'tasks') { go('tasks'); return; }
    if (act === 'status') { go('status'); }
  });

  // 상단 강제 새로고침
  $('#refreshBtn').addEventListener('click', async () => {
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.update()));
      }
    } catch {}
    location.replace(location.pathname + '?r=' + Date.now() + (location.hash || ''));
  });

  // 상단 알림 토글
  renderNotifyBtn();
  $('#notifyBtn').addEventListener('click', async () => {
    if (!state.notify && 'Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch {}
    }
    state.notify = !state.notify;
    localStorage.setItem('office.notify', state.notify ? 'on' : 'off');
    renderNotifyBtn();
    if (state.notify) {
      playChime();
      toast('🔔 새 메시지 알림을 켰습니다');
    } else {
      toast('🔕 알림을 껐습니다');
    }
  });

  // 상단 상황판 점프 & 말풍선 원클릭 작업등록
  $('#chatHud').addEventListener('click', e => {
    const b = e.target.closest('[data-hud]');
    if (b) go(b.dataset.hud);
  });
  $('#chatList').addEventListener('click', async e => {
    const b = e.target.closest('[data-to-task]');
    if (!b || !store) return;
    const msg = (state.messages[state.channel] || []).find(m => m.id === b.dataset.toTask);
    if (!msg) return;
    const raw = msg.text.replace(/^(@[가-힣A-Za-z0-9_]+\s*)+/, '').trim() || msg.text.trim();
    const title = raw.length > 56 ? raw.slice(0, 56) + '…' : raw;
    const mentioned = ASSISTANTS.find(a => msg.text.includes('@' + a.label));
    const assignee = mentioned ? mentioned.id : (msg.senderId !== 'daejangnim' ? msg.senderId : 'staff4');
    try {
      await store.push('tasks', { title, assignee, status: 'waiting', ts: Date.now() });
      renderChatHud();
      toast(`📋 작업실에 등록했습니다 (${memberById(assignee).label})`);
    } catch {
      toast('작업 등록 실패');
    }
  });

  // 멘션
  $('#mentionRow').addEventListener('click', e => {
    const b = e.target.closest('.mention');
    if (!b) return;
    const input = $('#msgInput');
    const cur = getMsgText(input);
    input.textContent = cur + (cur && !cur.endsWith(' ') ? ' ' : '') + b.dataset.mention + ' ';
    input.focus();
    const sel = window.getSelection();
    if (sel) { sel.selectAllChildren(input); sel.collapseToEnd(); }
    autoGrow(input);
  });

  // 입력/전송
  const input = $('#msgInput');
  // iOS 구버전 Safari가 plaintext-only를 해석하지 못하면 편집 불가가 되므로 true로 대체합니다(붙여넣기는 평문으로 정리)
  if (input.getAttribute('contenteditable') === 'plaintext-only' && !input.isContentEditable) {
    input.setAttribute('contenteditable', 'true');
  }
  input.addEventListener('input', () => {
    if (!getMsgText(input).replace(/\n/g, '').trim() && !input.querySelector('img')) input.innerHTML = '';
    autoGrow(input);
  });
  input.addEventListener('paste', e => {
    const dt = e.clipboardData || window.clipboardData;
    if (!dt) return;
    const txt = dt.getData('text/plain');
    if (txt == null) return;
    e.preventDefault();
    insertPlainTextAtCaret(txt);
    if (!getMsgText(input).replace(/\n/g, '').trim()) input.innerHTML = '';
    autoGrow(input);
  });
  input.addEventListener('focus', () => {
    document.body.classList.add('kb-open');
    fitViewport();
    setTimeout(fitViewport, 120);
    setTimeout(fitViewport, 350);
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement !== input) {
        document.body.classList.remove('kb-open');
        fitViewport();
      }
    }, 120);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width:760px)').matches) {
      e.preventDefault();
      sendMessage();
    }
  });
  $('#sendBtn').addEventListener('click', sendMessage);
  if ($('#attachBtn') && $('#fileInput')) {
    $('#attachBtn').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        if (f.type && f.type.startsWith('image/')) {
          state.pendingAttach = await compressImageFile(f);
        } else {
          if (f.size > 1.5 * 1024 * 1024) { toast('파일은 1.5MB 이하만 첨부돼요 (큰 파일은 피클 채팅 이용)'); return; }
          state.pendingAttach = await readSmallFile(f);
        }
        renderAttachPreview();
      } catch {
        toast('파일을 읽지 못했어요');
      }
    });
  }
  $('#chatList').addEventListener('click', e => {
    const img = e.target.closest('.m-img');
    if (img && $('#imgModal') && $('#imgModalSrc')) {
      $('#imgModalSrc').src = img.src;
      $('#imgModal').hidden = false;
    }
  });
  if ($('#imgModal')) {
    $('#imgModal').addEventListener('click', () => { $('#imgModal').hidden = true; });
  }

  // 작업실
  $('#taskFormToggle').addEventListener('click', () => {
    $('#taskForm').hidden = !$('#taskForm').hidden;
    if (!$('#taskForm').hidden) $('#taskTitle').focus();
  });
  $('#taskCancel').addEventListener('click', () => { $('#taskForm').hidden = true; });
  $('#taskForm').addEventListener('submit', addTask);
  $('#kanban').addEventListener('click', e => {
    const b = e.target.closest('[data-task]');
    if (b) taskAction(b.dataset.task, b.dataset.act);
  });

  // 비서현황
  $('#statusGrid').addEventListener('click', async e => {
    const s = e.target.closest('.sbtn');
    if (s && !s.disabled) {
      await store.update(`members/${s.dataset.member}`, { status: s.dataset.status, lastSeen: Date.now() });
      toast(`${memberById(s.dataset.member).label} → ${s.dataset.status}`);
      return;
    }
    const r = e.target.closest('.rbtn');
    if (r) {
      await store.update(`members/${r.dataset.member}`, { room: r.dataset.roomSet, lastSeen: Date.now() });
      toast(`${memberById(r.dataset.member).label} → ${ROOMS[r.dataset.roomSet].name}`);
    }
  });

  // 출퇴근 (구 AI한도)
  $('#limitsList').addEventListener('click', async e => {
    const att = e.target.closest('[data-att-btn]');
    if (att) {
      const id = att.dataset.member;
      const val = att.dataset.attBtn;
      const m = memberById(id);
      const now = Date.now();
      const memoEl = $(`[data-limit-field="memo"][data-member="${id}"]`);
      const memo = memoEl ? memoEl.value.trim() : '';
      const isOff = val === '퇴근';
      await Promise.all([
        store.update(`limits/${id}`, { state: val, memo, updatedAt: now }),
        store.update(`members/${id}`, {
          status: isOff ? '한도 소진' : (m.advisor ? '자문 대기' : '대기 중'),
          room: isOff ? 'lounge' : (m.defaultRoom || 'work'),
          lastSeen: now,
        }),
      ]);
      toast(`${m.label} · ${val} 처리했어요`);
      return;
    }
    const b = e.target.closest('[data-limit-save]');
    if (!b) return;
    const id = b.dataset.limitSave;
    const memoEl = $(`[data-limit-field="memo"][data-member="${id}"]`);
    await store.update(`limits/${id}`, { memo: memoEl ? memoEl.value.trim() : '', updatedAt: Date.now() });
    toast('메모를 저장했어요');
  });

  // 자료함
  $('#libForm').addEventListener('submit', async e => {
    e.preventDefault();
    const title = $('#libTitle').value.trim();
    const url = $('#libUrl').value.trim();
    if (!title && !url) return;
    await store.push('library', { title: title || url, url, tag: '직접 추가', by: 'daejangnim', ts: Date.now() });
    $('#libTitle').value = '';
    $('#libUrl').value = '';
    toast('📚 자료함에 추가했습니다');
  });
  $('#libList').addEventListener('click', async e => {
    const b = e.target.closest('[data-lib-del]');
    if (!b) return;
    await store.remove(`library/${b.dataset.libDel}`);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && state.activeRoom) { state.activeRoom = null; $('#roomSheet').hidden = true; renderOverlay(); }
  });
}

function openRoom(room) {
  state.activeRoom = room;
  renderRoomSheet(room);
  renderOverlay();
  const sheet = $('#roomSheet');
  if (sheet.scrollIntoView) sheet.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* =========================================================
   시작
   ========================================================= */
function subscribe() {
  store.watch('members', v => {
    state.members = v || {};
    state.loaded = true;
    renderMap(); renderStatus(); renderChat();
  });
  store.watch('tasks', v => { state.tasks = v || {}; renderTasks(); renderBriefing(); renderLastSeen(); refreshStatusSeen(); });
  store.watch('library', v => { state.library = v || {}; renderLibrary(); renderLastSeen(); refreshStatusSeen(); });
  store.watch('limits', v => { state.limits = v || {}; renderLimits(); });
  store.watch('schedules', v => { state.schedules = v || {}; refreshStatusSeen(); });
  store.watch('heartbeat', v => { state.heartbeat = v || null; renderHeartbeat(); });
  store.watch('briefing', v => { state.briefing = v || null; renderBriefing(); });
  setInterval(renderHeartbeat, 30000);
  Object.keys(CHANNELS).forEach(ch => {
    store.watch(`channels/${ch}/messages`, v => onMessages(ch, v), null, { limit: MSG_LIMIT });
  });
  if (store.watchConnection) {
    store.watchConnection(ok => { state.connected = ok; updateConnPill(); });
  }
}

/* 모바일 키보드가 올라와도 입력창이 가려지지 않게 화면 높이를 맞춥니다 */
function fitViewport() {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  const top = vv ? vv.offsetTop : 0;
  document.documentElement.style.setProperty('--app-h', Math.round(h) + 'px');
  document.documentElement.style.setProperty('--app-top', Math.round(top) + 'px');
  const focused = document.activeElement && document.activeElement.id === 'msgInput';
  const kb = focused || (vv && window.screen && vv.height < window.screen.height * 0.68);
  document.body.classList.toggle('kb-open', !!kb);
  if (kb) {
    window.scrollTo(0, 0);
    const sc = $('#chatScroll');
    if (sc) requestAnimationFrame(() => { sc.scrollTop = sc.scrollHeight; });
  }
}

const LOCK_HASH = '8800ef05211ae307359cb7edc992c7f172cc34d92b7d926d71f57bfcadf1c254';

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function ensureUnlocked() {
  const appRoot = $('#appRoot');
  const gate = $('#lockGate');
  if (localStorage.getItem('office.unlocked') === LOCK_HASH) {
    if (appRoot) appRoot.hidden = false;
    return Promise.resolve();
  }
  if (!gate) {
    if (appRoot) appRoot.hidden = false;
    return Promise.resolve();
  }
  gate.hidden = false;
  const input = $('#lockInput');
  const err = $('#lockErr');
  const form = $('#lockForm');
  const card = form.closest('.lock-card');
  setTimeout(() => input && input.focus(), 60);

  return new Promise(resolve => {
    async function tryUnlock() {
      const val = (input.value || '').trim();
      if (!val) return;
      const h = await sha256Hex(val);
      if (h === LOCK_HASH) {
        localStorage.setItem('office.unlocked', LOCK_HASH);
        gate.hidden = true;
        if (appRoot) appRoot.hidden = false;
        resolve();
      } else {
        err.textContent = '비밀번호가 맞지 않아요';
        input.value = '';
        card.classList.remove('is-shake');
        void card.offsetWidth;
        card.classList.add('is-shake');
        input.focus();
      }
    }
    input.addEventListener('input', () => {
      err.textContent = '';
      if (input.value.trim().length === 6) tryUnlock();
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      tryUnlock();
    });
  });
}

async function boot() {
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitViewport);
    window.visualViewport.addEventListener('scroll', fitViewport);
    fitViewport();
  }
  await ensureUnlocked();
  const savedMotion = localStorage.getItem('office.motion');
  if (savedMotion === 'off' || savedMotion === 'on') state.motion = savedMotion;
  applyMotion();

  renderSenderChips();
  fillAssigneeOptions();
  renderMap();
  renderChat();
  wire();
  updateConnPill();

  try {
    store = await createStore(FIREBASE_CONFIG);
    state.storeMode = store.mode;
    updateConnPill();
    subscribe();
    applyRoute();
  } catch (e) {
    console.error('[boot] store failed', e);
    state.storeMode = 'local';
    updateConnPill();
    toast('데이터 연결에 문제가 있어요');
  }
}

boot();
