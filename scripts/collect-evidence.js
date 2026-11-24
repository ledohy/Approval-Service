// [학생 추가] 보고서용 API 증거 수집 스크립트.
// 임시 DB·임의 포트로 서버를 띄워 시나리오를 실행하고, HTTP 결과와 요청 전후 DB(상태·승인 인원·이력)를
// docs/evidence/api-evidence.md에 기록합니다. JWT·서명 키는 출력하지 않습니다. 실제 data/app.sqlite는 건드리지 않습니다.
// 실행: node scripts/collect-evidence.js
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

const out = [];
const log = s => out.push(s);
const json = v => '```json\n' + JSON.stringify(v, null, 2) + '\n```';

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'assignment2-evidence-')), db = openDb(join(dir, 'e.sqlite'));
  const server = createApp({ db, secret: randomBytes(48).toString('hex') }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (path, { token, method = 'GET', body } = {}) => {
    const r = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, location: r.headers.get('location'), data: await r.json() };
  };
  const tokens = {};
  for (const n of ['alice', 'bob', 'charlie', 'manager1', 'manager2'])
    tokens[n] = (await req('/api/auth/login', { method: 'POST', body: { username: n, password: 'Classroom123!' } })).data.accessToken;
  const call = async (who, method, path, body) => {
    const r = await req(path, { token: tokens[who], method, body });
    log(`- 요청: \`${method} ${path}\` · 행위자 **${who}** (Authorization: Bearer ***)` + (body && Object.keys(body).length ? ` · 본문 \`${JSON.stringify(body)}\`` : ''));
    log(`- 응답: **HTTP ${r.status}**` + (r.data?.code ? ` · code \`${r.data.code}\`` : '') + (r.location ? ` · Location \`${r.location}\`` : ''));
    return r;
  };
  const state = () => ({
    applications: db.prepare('SELECT id,event_id,user_id,status,created_at FROM applications ORDER BY id').all(),
    approvedCount: Object.fromEntries(db.prepare("SELECT e.id, (SELECT COUNT(*) FROM applications a WHERE a.event_id=e.id AND a.status='APPROVED') n FROM events e").all().map(r => [`event${r.id}`, r.n])),
    history: db.prepare('SELECT id,application_id,actor_id,action,from_status,to_status,reason,cause_history_id FROM application_history ORDER BY id').all()
  });
  const full = () => JSON.stringify({ a: db.prepare('SELECT * FROM applications ORDER BY id').all(), h: db.prepare('SELECT * FROM application_history ORDER BY id').all() });
  const stop = async () => { await new Promise(r => server.close(r)); db.close(); rmSync(dir, { recursive: true, force: true }); };
  return { db, call, state, full, stop };
}

async function unchanged(f, title, rule, fn) {
  log(`\n## ${title}\n\n관련 규칙: ${rule}\n`);
  const before = f.full(), b = f.state();
  await fn();
  const after = f.state(), same = before === f.full();
  log(`\n요청 전후 비교 (applications·application_history 전체 행): **${same ? '동일 — 데이터 불변' : '변경됨'}** · 이력 ${b.history.length}건 → ${after.history.length}건\n`);
  log(json(after));
  return same;
}

const results = [];
const scenarios = [
  ['E1 타인의 대기 취소 거부 (T07)', 'R1', async () => {
    const f = await fixture(); log('\n## E1 타인의 대기 취소 거부 (T07)\n\n준비:');
    const a = (await f.call('alice', 'POST', '/api/events/1/applications', {})).data;
    results.push(['E1', await unchanged(f, 'E1 결과', 'R1 신원과 권한 — 본인만 대기 취소', () => f.call('bob', 'POST', `/api/applications/${a.id}/cancel`, {}))]);
    await f.stop();
  }],
  ['E2 오래된 화면의 승인 거부 (U02·T10)', 'R8', async () => {
    const f = await fixture(); log('\n## E2 오래된 화면의 승인 거부 (U02·T10)\n\n준비:');
    const a = (await f.call('alice', 'POST', '/api/events/1/applications', {})).data;
    await f.call('alice', 'POST', `/api/applications/${a.id}/cancel`, {});
    results.push(['E2', await unchanged(f, 'E2 결과 — 운영자가 취소 전 화면에서 승인', 'R8 최신 상태 — 서버가 DB 상태(CANCELLED)로 판단', () => f.call('manager1', 'POST', `/api/applications/${a.id}/approve`, {}))]);
    await f.stop();
  }],
  ['E3 정원 초과 거부', 'R4', async () => {
    const f = await fixture(); log('\n## E3 정원 초과 직접 승인 거부 (T13)\n\n준비 (행사 2 정원 1명):');
    const a = (await f.call('alice', 'POST', '/api/events/2/applications', {})).data;
    const b = (await f.call('bob', 'POST', '/api/events/2/applications', {})).data;
    await f.call('manager2', 'POST', `/api/applications/${a.id}/approve`, {});
    results.push(['E3', await unchanged(f, 'E3 결과', 'R4 정원 — APPROVED 수가 정원 이상이면 409', () => f.call('manager2', 'POST', `/api/applications/${b.id}/approve`, {}))]);
    await f.stop();
  }],
  ['E4 승인 취소와 자동 승급 (U04)', 'R5·R6', async () => {
    const f = await fixture(); log('\n## E4 승인 취소 → 다음 대기자 자동 승급 (U04·T18·T25)\n\n준비: 행사 2에 alice·bob·charlie 순서로 신청, alice 승인');
    const ids = [];
    for (const n of ['alice', 'bob', 'charlie']) ids.push((await f.call(n, 'POST', '/api/events/2/applications', {})).data.id);
    await f.call('manager2', 'POST', `/api/applications/${ids[0]}/approve`, {});
    log('\n실행:');
    const r = await f.call('manager2', 'POST', `/api/applications/${ids[0]}/revoke`, { reason: '  운영 사정으로 승인 취소  ' });
    log(`- revoked: id ${r.data.revoked.id} ${r.data.revoked.status} · promoted: id ${r.data.promoted?.id} ${r.data.promoted?.status}`);
    const st = f.state(); log('\n요청 후 DB:\n'); log(json(st));
    const rv = st.history.find(h => h.action === 'REVOKE'), au = st.history.find(h => h.action === 'AUTO_APPROVE');
    const ok = r.status === 200 && r.data.promoted?.id === ids[1] && au.cause_history_id === rv.id && rv.reason === '운영 사정으로 승인 취소' && st.applications.find(a => a.id === ids[2]).status === 'PENDING';
    log(`\n확인: bob(id ${ids[1]}) 승급 · charlie 대기 유지 · AUTO_APPROVE.cause_history_id(${au.cause_history_id}) = REVOKE.id(${rv.id}) · 사유 trim 저장 → **${ok ? '일치' : '불일치'}**`);
    results.push(['E4', ok]); await f.stop();
  }],
  ['E5 대기자 없는 승인 취소 (U05)', 'R5', async () => {
    const f = await fixture(); log('\n## E5 대기자 없는 승인 취소 (U05·T17)\n\n준비:');
    const a = (await f.call('alice', 'POST', '/api/events/2/applications', {})).data;
    await f.call('manager2', 'POST', `/api/applications/${a.id}/approve`, {});
    log('\n실행:');
    const r = await f.call('manager2', 'POST', `/api/applications/${a.id}/revoke`, { reason: '행사 장소 변경' });
    const st = f.state(); log(`- promoted: ${JSON.stringify(r.data.promoted)}\n`); log(json(st));
    const ok = r.data.promoted === null && st.approvedCount.event2 === 0 && st.applications[0].status === 'REVOKED';
    log(`\n확인: REVOKED · 승인 인원 0 · promoted=null → **${ok ? '일치' : '불일치'}**`);
    results.push(['E5', ok]); await f.stop();
  }],
  ['E6 created_at 동일 시 ID 순서', 'R5', async () => {
    const f = await fixture(); log('\n## E6 대기 등록 시각이 같을 때 ID 오름차순 (T19)\n\n준비: 행사 1에 alice 승인, charlie·bob 순서로 신청 후 두 대기자의 created_at을 같은 값으로 맞춤');
    const a = (await f.call('alice', 'POST', '/api/events/1/applications', {})).data;
    await f.call('manager1', 'POST', `/api/applications/${a.id}/approve`, {});
    const c = (await f.call('charlie', 'POST', '/api/events/1/applications', {})).data;
    const b = (await f.call('bob', 'POST', '/api/events/1/applications', {})).data;
    f.db.prepare("UPDATE applications SET created_at='2026-11-01T00:00:00.000Z' WHERE id IN (?,?)").run(c.id, b.id);
    log(`- (테스트용 직접 SQL) charlie id ${c.id}, bob id ${b.id}의 created_at = 2026-11-01T00:00:00.000Z\n\n실행:`);
    const r = await f.call('manager1', 'POST', `/api/applications/${a.id}/revoke`, { reason: '순서 확인용 승인 취소' });
    const ok = r.data.promoted?.id === Math.min(c.id, b.id);
    log(`- promoted id ${r.data.promoted?.id} (기대: 더 작은 ID ${Math.min(c.id, b.id)}) → **${ok ? '일치' : '불일치'}**`);
    results.push(['E6', ok]); await f.stop();
  }],
  ['E7 자동 승급 이력 저장 실패 주입', 'R7', async () => {
    const f = await fixture(); log('\n## E7 AUTO_APPROVE 이력 저장 실패 → 전체 롤백 (T29)\n\n준비: 행사 1에 alice 승인, bob 대기');
    const a = (await f.call('alice', 'POST', '/api/events/1/applications', {})).data;
    await f.call('manager1', 'POST', `/api/applications/${a.id}/approve`, {});
    const b = (await f.call('bob', 'POST', '/api/events/1/applications', {})).data;
    f.db.exec("CREATE TRIGGER fail_auto BEFORE INSERT ON application_history WHEN NEW.action='AUTO_APPROVE' BEGIN SELECT RAISE(ABORT,'TEST_INJECTED_FAILURE'); END");
    log('- (임시 DB에만) AUTO_APPROVE 이력 INSERT 시 오류를 내는 트리거 설치');
    const same = await unchanged(f, 'E7 결과 — 실패 주입 상태에서 승인 취소', 'R7 원자성 — REVOKED·REVOKE 이력·APPROVED가 이미 실행된 뒤 마지막 INSERT 실패', () => f.call('manager1', 'POST', `/api/applications/${a.id}/revoke`, { reason: '실패 주입 확인' }));
    f.db.exec('DROP TRIGGER fail_auto'); log('\n트리거 제거 후 재시도:');
    const r = await f.call('manager1', 'POST', `/api/applications/${a.id}/revoke`, { reason: '실패 주입 확인' });
    log(`- promoted id ${r.data.promoted?.id} (bob ${b.id})`);
    results.push(['E7', same && r.status === 200 && r.data.promoted?.id === b.id]); await f.stop();
  }],
  ['E8 반복 승인 취소 거부', 'R8', async () => {
    const f = await fixture(); log('\n## E8 같은 신청 반복 승인 취소 (T22·T32)\n\n준비:');
    const a = (await f.call('alice', 'POST', '/api/events/2/applications', {})).data;
    await f.call('bob', 'POST', '/api/events/2/applications', {});
    await f.call('manager2', 'POST', `/api/applications/${a.id}/approve`, {});
    await f.call('manager2', 'POST', `/api/applications/${a.id}/revoke`, { reason: '첫 번째 승인 취소' });
    results.push(['E8', await unchanged(f, 'E8 결과 — 두 번째 승인 취소', 'R8 — REVOKED는 종료 상태, 추가 승급 없음', () => f.call('manager2', 'POST', `/api/applications/${a.id}/revoke`, { reason: '두 번째 승인 취소' }))]);
    await f.stop();
  }]
];

const origError = console.error; console.error = (...a) => { if (!String(a[0]).includes('TEST_INJECTED_FAILURE')) origError(...a); };
log(`# API 증거 (자동 생성)\n\n생성: ${new Date().toISOString()} · Node ${process.version} · 각 시나리오는 새 임시 DB에서 실행 · JWT는 Bearer ***로 가림`);
for (const [, , fn] of scenarios) await fn();
log('\n## 요약\n\n|ID|결과|\n|---|---|\n' + results.map(([id, ok]) => `|${id}|${ok ? '통과' : '실패'}|`).join('\n'));
const dir = fileURLToPath(new URL('../docs/evidence/', import.meta.url)); mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'api-evidence.md'), out.join('\n') + '\n');
console.log(results.map(([id, ok]) => `${id} ${ok ? 'PASS' : 'FAIL'}`).join('\n'));
