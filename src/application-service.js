import { AppError, missing, forbidden, invalidState } from './errors.js';

// [학생 구현] TODO-01~04: 업무 규칙과 트랜잭션.
// actor는 auth.middleware가 DB에서 다시 읽은 로그인 사용자입니다(요청 본문의 신원·역할은 쓰지 않음).
// 검사 순서: (app.js) 인증 → ID·본문 형식 → (여기) 대상 존재 → 권한 → 현재 상태 → 정원.

const alreadyApplied = () => new AppError(409,'ALREADY_APPLIED','이미 이 행사에 신청한 기록이 있습니다.');
const capacityFull = () => new AppError(409,'CAPACITY_FULL','정원이 모두 찼습니다.');
const SQLITE_CONSTRAINT_UNIQUE = 2067;

export function createApplicationService(repo) {
  const { db } = repo;

  // 모든 변경 요청을 하나의 트랜잭션으로 실행합니다.
  // BEGIN IMMEDIATE: 시작 시점에 쓰기 잠금을 잡아, 검사(SELECT)부터 저장(UPDATE·INSERT)까지
  // 다른 연결(다른 서버 프로세스 포함)의 쓰기가 끼어들지 못하게 합니다(R8 최신 상태).
  // fn 안에서 예외가 나면 업무 거부(4xx)든 저장 오류(500)든 ROLLBACK 후 그대로 다시 던집니다(R7).
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw err;
    }
  }

  // 신청 존재(404) → 행사 담당 운영자 여부(403). approve·revoke 공통.
  function loadForManager(actor, applicationId) {
    const application = repo.application(applicationId);
    if (!application) throw missing('신청');
    const event = repo.event(application.eventId);
    if (actor.role !== 'MANAGER' || event.managerId !== actor.id) throw forbidden();
    return { application, event };
  }

  return {
    // TODO-01: 없음 → PENDING + APPLY 이력
    apply(actor, eventId) {
      try {
        return transaction(() => {
          const event = repo.event(eventId);
          if (!event) throw missing('행사');                              // 404
          if (actor.role !== 'STUDENT') throw forbidden();                 // 403 (R1)
          if (repo.existing(eventId, actor.id)) throw alreadyApplied();    // 409 (R2, CANCELLED·REVOKED 포함)
          const created = repo.insert(eventId, actor.id);
          repo.addHistory({ applicationId: created.id, actorId: actor.id, action: 'APPLY', fromStatus: null, toStatus: 'PENDING' });
          return created;
        });
      } catch (err) {
        // 최종 방어선: UNIQUE(event_id,user_id) 위반은 500이 아니라 명세의 409로 변환(이미 ROLLBACK 완료).
        if (err?.errcode === SQLITE_CONSTRAINT_UNIQUE) throw alreadyApplied();
        throw err;
      }
    },

    // TODO-02: PENDING → CANCELLED + CANCEL 이력 (자동 승급 없음)
    cancel(actor, applicationId) {
      return transaction(() => {
        const application = repo.application(applicationId);
        if (!application) throw missing('신청');                          // 404
        if (application.userId !== actor.id) throw forbidden();           // 403 본인만 (운영자 포함 타인 거부)
        if (application.status !== 'PENDING') throw invalidState();       // 409 APPROVED·종료 상태 거부
        const updated = repo.setStatus(applicationId, 'CANCELLED');
        repo.addHistory({ applicationId, actorId: actor.id, action: 'CANCEL', fromStatus: 'PENDING', toStatus: 'CANCELLED' });
        return updated;
      });
    },

    // TODO-03: PENDING → APPROVED + APPROVE 이력 (운영자가 직접 선택, FIFO 미적용)
    approve(actor, applicationId) {
      return transaction(() => {
        const { application, event } = loadForManager(actor, applicationId);   // 404 → 403
        if (application.status !== 'PENDING') throw invalidState();             // 409 상태가 정원보다 먼저
        if (repo.approvedCount(event.id) >= event.capacity) throw capacityFull(); // 409 (R4)
        const updated = repo.setStatus(applicationId, 'APPROVED');
        repo.addHistory({ applicationId, actorId: actor.id, action: 'APPROVE', fromStatus: 'PENDING', toStatus: 'APPROVED' });
        return updated;
      });
    },

    // TODO-04: APPROVED → REVOKED + REVOKE 이력, 다음 대기자 1명 PENDING → APPROVED + AUTO_APPROVE 이력
    // 신청 2건 + 이력 2건이 한 트랜잭션. reason은 app.js에서 trim·5~200자 검사를 마친 값입니다.
    revoke(actor, applicationId, reason) {
      return transaction(() => {
        const { application } = loadForManager(actor, applicationId);   // 404 → 403
        if (application.status !== 'APPROVED') throw invalidState();      // 409 반복 승인 취소 거부 (R8)

        const revoked = repo.setStatus(applicationId, 'REVOKED');
        const revokeHistoryId = repo.addHistory({
          applicationId, actorId: actor.id, action: 'REVOKE',
          fromStatus: 'APPROVED', toStatus: 'REVOKED', reason
        });

        // 비워진 한 자리만 채웁니다. 기존 빈자리가 더 있어도 최대 1명 (R5).
        const next = repo.nextWaiting(application.eventId);
        let promoted = null;
        if (next) {
          promoted = repo.setStatus(next.id, 'APPROVED');
          repo.addHistory({
            applicationId: next.id, actorId: actor.id, action: 'AUTO_APPROVE',
            fromStatus: 'PENDING', toStatus: 'APPROVED', causeHistoryId: revokeHistoryId
          });
        }
        return { revoked, promoted };
      });
    }
  };
}
