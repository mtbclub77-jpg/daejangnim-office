/* =========================================================
   store.js — 데이터 계층
   - Firebase Realtime Database 실시간 동기화
   - 연결이 안 되면 자동으로 기기 저장(localStorage) 모드로 동작
   두 모드는 완전히 같은 인터페이스를 씁니다.
   ========================================================= */

const FB_APP = 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
const FB_DB = 'https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js';
const ROOT = 'office';
const LS_KEY = 'daejangnim-office-v1';

/* ---------------- 멤버 설정 (여기에 한 줄 추가하면 사원이 늘어나고, active:false면 빈자리) ---------------- */
export const MEMBERS = [
  { id:'daejangnim', name:'김현준', label:'대장님', emoji:'👑', role:'지휘실 · 총괄 의사결정', chief:true, active:true, accent:'gold',
    area:'최종 의사결정 · 방향 지시 · 결재', defaultRoom:'command', defaultStatus:'재실' },
  { id:'maeng', name:'맹대리', label:'맹대리', emoji:'💼', role:'총괄 · 조정 (메인 비서)', active:true, accent:'blue',
    area:'일상·실무 지원 및 최종 보고 · 보안·GitHub·게이트 관리 · 매일 21:00 업데이트 회의 주관 및 산출물 검수·중계', defaultRoom:'work', defaultStatus:'대기 중' },
  { id:'daeng', name:'댕주임', label:'댕주임', emoji:'🐕', role:'제작 · 모니터링 (서브 비서)', active:true, accent:'warm',
    area:'매일 11:00 블로그·쇼츠·릴스·스레드 원고/카드 제작 및 토요일 주간 초안 7편 · 시트·뉴스 모니터링(09/14/19시)·리뷰', defaultRoom:'work', defaultStatus:'대기 중' },
  { id:'gu', name:'잼이사', label:'잼이사', emoji:'💎', role:'임원실 · 자료조사·요약', active:true, advisor:true, accent:'indigo',
    badge:'임원', area:'Gemini — 구글 검색 기반 1차 자료조사·요약 · Google Tasks 보조 · 밍인턴 대리 발신', defaultRoom:'meeting', defaultStatus:'자문 대기' },
  { id:'jigo', name:'지고문', label:'지고문', emoji:'🧠', role:'임원실 · 기획·구조 설계', active:true, advisor:true, accent:'mint',
    badge:'자문 고문', area:'ChatGPT — 기획·구조 설계 자문 및 1차 교차검증 · 밍인턴 대리 발신', defaultRoom:'meeting', defaultStatus:'자문 대기' },
  { id:'keugo', name:'클고문', label:'클고문', emoji:'🦉', role:'임원실 · 보안·리스크 검증', active:true, advisor:true, accent:'amber',
    badge:'자문 고문', area:'Claude — 보안·리스크·논리·프롬프트 검증 · 밍인턴 대리 발신', defaultRoom:'meeting', defaultStatus:'자문 대기' },
  { id:'staff4', name:'밍인턴', label:'밍인턴', emoji:'🌱', role:'웹앱 · 채널 운영 · 기록 (막내 인턴)', active:true, accent:'mint',
    area:'비서실 웹앱(daejangnim-office) 개발·배포 및 패치방 공지 · @golfjun2026 스레드·SNS 성장 루틴 · 매일 22:00 노션 일지 마감', defaultRoom:'work', defaultStatus:'대기 중' },
];

export const CHANNELS = {
  command: { label:'💬 통합 회의실', short:'통합 회의실', icon:'💬', desc:'대장님 지시 · 전체 보고 통합 채널' },
  updates: { label:'🛠️ 패치방', short:'패치방', icon:'🛠️', desc:'맹대리 · 밍인턴 · 임원단 비서실 패치 및 배포 안내' },
};

export const ROOMS = {
  command: { icon:'🎯', name:'대표실' },
  meeting: { icon:'🏛️', name:'임원실' },
  work:    { icon:'💼', name:'사무실' },
  lounge:  { icon:'🛏️', name:'당직실' },
};

export const STATUSES = ['대기 중', '작업 중', '한도 소진'];
export const ADVISOR_STATUSES = ['자문 대기', '작업 중', '한도 소진'];
export const TASK_STATUS = { doing:'진행 중', waiting:'대기', done:'완료' };

export const memberById = id => MEMBERS.find(m => m.id === id) || { id, name:id, emoji:'🙂', label:id, active:true };

/* ---------------- 초기 시드 ---------------- */
export function seedData() {
  const now = Date.now();
  const min = m => now - m * 60000;
  const mk = (senderId, text, ts) => ({ senderId, text, ts, id: 'seed-' + ts + '-' + senderId });
  return {
    meta: { createdAt: now, seeded: true, version: 1 },
    members: {
      daejangnim:{ status:'재실',      room:'command' },
      maeng:     { status:'대기 중',    room:'work' },
      daeng:     { status:'대기 중',    room:'work' },
      gu:        { status:'대기 중',    room:'work' },
      jigo:      { status:'자문 대기',  room:'meeting' },
      keugo:     { status:'자문 대기',  room:'meeting' },
      staff4:    { status:'충원 예정',  room:'work' },
    },
    channels: {
      command: { messages: {
        'seed-a1': mk('maeng', '대장님, 비서실 문 열었습니다.\n오피스 맵 · 회의실 · 작업실 · 메모 전부 실시간으로 연결해 뒀어요. 폰이나 PC 어디서 보셔도 바로 같이 바뀝니다.', min(95)),
        'seed-a2': mk('daeng', '저도 대기 중입니다! 블로그 초안과 뉴스 리서치는 제가 맡을게요. 지시만 주세요 🐕', min(88)),
        'seed-a3': mk('daejangnim', '좋아. 오늘은 12월 마감자료 준비부터 시작하자.', min(80)),
        'seed-a4': mk('maeng', '네, 대장님. 마감자료 초안 제가 잡고 작업실에 올려 두겠습니다. 시작하면 바로 보고드릴게요.', min(76)),
      } },
      meeting: { messages: {
        'seed-b1': mk('maeng', '공지 — 이번 주 금요일 15시 주간회의 자료는 제가 취합합니다. 각 담당은 목요일 18시까지 공유해 주세요.', min(240)),
      } },
      lounge: { messages: {
        'seed-c1': mk('daeng', '잠깐 커피 한 잔 하고 올게요 ☕', min(300)),
      } },
    },
    tasks: {
      'seed-t1': { title:'12월 마감자료 초안 정리', assignee:'maeng', status:'doing',   ts: min(90) },
      'seed-t2': { title:'블로그 주간 초안 3편 작성', assignee:'daeng', status:'waiting', ts: min(120) },
      'seed-t3': { title:'주간회의 자료 취합',        assignee:'maeng', status:'waiting', ts: min(200) },
      'seed-t4': { title:'비서실 웹페이지 오픈',      assignee:'all',   status:'done',    ts: min(30) },
    },
    memos: {
      'seed-n1': { text:'작업 지시를 받으면 시작 전에 "실행하겠습니다" 먼저 보고하기', done:false, by:'maeng', ts:min(400) },
      'seed-n2': { text:'금요일 15시 주간회의 — 자료는 목요일까지 취합', done:false, by:'maeng', ts:min(300) },
      'seed-n3': { text:'비서실 웹페이지 배포 완료 (11/27)', done:true, by:'maeng', ts:min(60) },
    },
    limits: {
      maeng: { used:42, limit:100, memo:'일정·문서 위주, 조사는 댕주임에게 분배', updatedAt: min(70) },
      daeng: { used:18, limit:100, memo:'블로그·뉴스 리서치 담당', updatedAt: min(70) },
    },
  };
}

/* =========================================================
   Firebase 백엔드
   ========================================================= */
class FirebaseStore {
  constructor(mod, db) { this.mod = mod; this.db = db; this.mode = 'firebase'; }
  _ref(p) { return this.mod.ref(this.db, p ? ROOT + '/' + p : ROOT); }

  watch(path, cb, onErr, opts) {
    const base = this._ref(path);
    const target = (opts && opts.limit && this.mod.query && this.mod.limitToLast)
      ? this.mod.query(base, this.mod.limitToLast(opts.limit))
      : base;
    return this.mod.onValue(target,
      snap => cb(snap.val()),
      err => { console.warn('[fb]', path, err); onErr && onErr(err); });
  }
  async get(path) {
    const snap = await this.mod.get(this._ref(path));
    return snap.val();
  }
  async set(path, val) { await this.mod.set(this._ref(path), val); }
  async update(path, patch) { await this.mod.update(this._ref(path), patch); }
  async push(path, val) {
    const r = await this.mod.push(this._ref(path), val);
    return r.key;
  }
  async remove(path) { await this.mod.remove(this._ref(path)); }
  watchConnection(cb) {
    return this.mod.onValue(this.mod.ref(this.db, '.info/connected'), s => cb(!!s.val()));
  }
}

/* =========================================================
   기기 저장 백엔드 (Firebase 불가 시)
   ========================================================= */
class LocalStore {
  constructor() {
    this.mode = 'local';
    this.watchers = new Set();
    this.state = this._load();
    this.bc = ('BroadcastChannel' in window) ? new BroadcastChannel('daejangnim-office') : null;
    if (this.bc) this.bc.onmessage = () => { this.state = this._load(); this._emit(); };
    window.addEventListener('storage', e => {
      if (e.key === LS_KEY) { this.state = this._load(); this._emit(); }
    });
  }
  _load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.members) return parsed;
      }
    } catch (e) { console.warn('[local] load failed', e); }
    const s = seedData();
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {}
    return s;
  }
  _save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.state)); } catch (e) { console.warn(e); }
    this._emit();
    if (this.bc) this.bc.postMessage({ t:'sync' });
  }
  _emit() {
    this.watchers.forEach(w => { try { w.cb(w.get()); } catch (e) { console.warn(e); } });
  }
  _parts(path) { return path.split('/').filter(Boolean); }
  _read(path) {
    let cur = this.state;
    for (const p of this._parts(path)) { if (cur == null) return null; cur = cur[p]; }
    return cur === undefined ? null : cur;
  }
  _write(path, val) {
    const parts = this._parts(path);
    if (!parts.length) { this.state = val; return; }
    let cur = this.state;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
      cur = cur[k];
    }
    const last = parts[parts.length - 1];
    if (val === null) delete cur[last]; else cur[last] = val;
  }

  watch(path, cb, onErr, opts) {
    const limit = opts && opts.limit ? opts.limit : 0;
    const read = () => {
      const v = this._read(path);
      if (!limit || !v || typeof v !== 'object') return v;
      const keys = Object.keys(v).sort();
      const keep = keys.slice(Math.max(0, keys.length - limit));
      const out = {};
      keep.forEach(k => { out[k] = v[k]; });
      return out;
    };
    const w = { cb, get: read };
    this.watchers.add(w);
    queueMicrotask(() => cb(read()));
    return () => this.watchers.delete(w);
  }
  async get(path) { return this._read(path); }
  async set(path, val) { this._write(path, val); this._save(); }
  async update(path, patch) {
    const cur = this._read(path) || {};
    const next = Object.assign({}, cur, patch);
    Object.keys(patch).forEach(k => { if (patch[k] === null) delete next[k]; });
    this._write(path, next); this._save();
  }
  async push(path, val) {
    const key = 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this._write(path + '/' + key, val); this._save();
    return key;
  }
  async remove(path) { this._write(path, null); this._save(); }
  watchConnection(cb) { cb(false); return () => {}; }
}

/* =========================================================
   생성 + 시드 보장
   ========================================================= */
export async function createStore(config) {
  let store = null;
  if (config && config.databaseURL) {
    try {
      const [appMod, dbMod] = await Promise.all([import(FB_APP), import(FB_DB)]);
      const app = appMod.initializeApp(config);
      const db = dbMod.getDatabase(app);
      const probe = new FirebaseStore(dbMod, db);
      const ok = await Promise.race([
        probe.get('meta').then(v => true).catch(() => false),
        new Promise(res => setTimeout(() => res(false), 7000)),
      ]);
      if (ok) store = probe;
      else console.warn('[store] firebase 응답 없음 → 기기 저장 모드');
    } catch (e) {
      console.warn('[store] firebase 초기화 실패 → 기기 저장 모드', e);
    }
  }
  if (!store) store = new LocalStore();
  try { await ensureSeed(store); } catch (e) { console.warn('[store] seed check failed', e); }
  try { await migrateLegacyMembers(store); } catch (e) { console.warn('[store] member migration failed', e); }
  return store;
}

/* 사원3·사원4(빈자리) 데이터를 지사원·클사원으로 옮깁니다 (한 번만, 채팅·작업·메모는 그대로) */
const LEGACY_IDS = { jisa: 'jigo', keul: 'keugo' };
async function migrateLegacyMembers(store) {
  if (store.mode === 'local') return;
  const meta = await store.get('meta');
  if (meta && meta.legacyMigratedV24) return;
  const [members, tasks, memos, limits] = await Promise.all([
    store.get('members'), store.get('tasks'), store.get('memos'), store.get('limits'),
  ]);
  const patch = {};
  let touched = false;

  Object.entries(LEGACY_IDS).forEach(([oldId, newId]) => {
    const oldV = (members || {})[oldId];
    if (!oldV) return;
    touched = true;
    if (!(members || {})[newId]) {
      const keep = oldV.status && oldV.status !== '충원 예정' ? oldV.status : '자문 대기';
      patch['members/' + newId] = { status: keep, room: 'meeting' };
      if (typeof oldV.lastSeen === 'number') patch['members/' + newId].lastSeen = oldV.lastSeen;
    }
    patch['members/' + oldId] = null;
  });

  if (touched) {
    Object.entries(tasks || {}).forEach(([id, t]) => {
      if (t && LEGACY_IDS[t.assignee]) patch['tasks/' + id + '/assignee'] = LEGACY_IDS[t.assignee];
    });
    Object.entries(memos || {}).forEach(([id, m]) => {
      if (m && LEGACY_IDS[m.by]) patch['memos/' + id + '/by'] = LEGACY_IDS[m.by];
    });
    Object.entries(LEGACY_IDS).forEach(([oldId, newId]) => {
      if (limits && limits[oldId] && !limits[newId]) {
        patch['limits/' + newId] = limits[oldId];
        patch['limits/' + oldId] = null;
      }
    });
  }
  patch['meta/legacyMigratedV24'] = true;
  await store.update('', patch);
}

/* 처음 한 번만 기본 데이터를 채웁니다 (이미 데이터가 있으면 건드리지 않음) */
async function ensureSeed(store) {
  if (store.mode === 'local') return;             // LocalStore는 자체 시드 보유
  const meta = await store.get('meta');
  if (meta && meta.seeded) return;
  const seed = seedData();
  const messages = seed.channels;
  const build = (obj, prefix) => {
    const out = {};
    Object.entries(obj).forEach(([k, v]) => { out[prefix + k] = v; });
    return out;
  };
  const flat = {};
  Object.assign(flat, build(seed.members, 'members/'));
  Object.assign(flat, build(seed.tasks, 'tasks/'));
  Object.assign(flat, build(seed.memos, 'memos/'));
  Object.assign(flat, build(seed.limits, 'limits/'));
  Object.assign(flat, build(messages.command.messages, 'channels/command/messages/'));
  Object.assign(flat, build(messages.meeting.messages, 'channels/meeting/messages/'));
  Object.assign(flat, build(messages.lounge.messages, 'channels/lounge/messages/'));
  flat['meta'] = seed.meta;
  await store.update('', flat);
}
