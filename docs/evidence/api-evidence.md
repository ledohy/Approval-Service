# API 증거 (자동 생성)

생성: 2026-11-24T05:28:35.453Z · Node v24.22.3 · 각 시나리오는 새 임시 DB에서 실행 · JWT는 Bearer ***로 가림

## E1 타인의 대기 취소 거부 (T07)

준비:
- 요청: `POST /api/events/1/applications` · 행위자 **alice** (Authorization: Bearer ***)
- 응답: **HTTP 201** · Location `/api/applications/1`

## E1 결과

관련 규칙: R1 신원과 권한 — 본인만 대기 취소

- 요청: `POST /api/applications/1/cancel` · 행위자 **bob** (Authorization: Bearer ***)
- 응답: **HTTP 403** · code `FORBIDDEN`

요청 전후 비교 (applications·application_history 전체 행): **동일 — 데이터 불변** · 이력 1건 → 1건

```json
{
  "applications": [
    {
      "id": 1,
      "event_id": 1,
      "user_id": 1,
      "status": "PENDING",
      "created_at": "2026-11-24T05:28:35.683Z"
    }
  ],
  "approvedCount": {
    "event1": 0,
    "event2": 0
  },
  "history": [
    {
      "id": 1,
      "application_id": 1,
      "actor_id": 1,
      "action": "APPLY",
      "from_status": null,
      "to_status": "PENDING",
      "reason": null,
      "cause_history_id": null
    }
  ]
}
```

## E2 오래된 화면의 승인 거부 (U02·T10)

준비:
- 요청: `POST /api/events/1/applications` · 행위자 **alice** (Authorization: Bearer ***)
- 응답: **HTTP 201** · Location `/api/applications/1`
- 요청: `POST /api/applications/1/cancel` · 행위자 **alice** (Authorization: Bearer ***)
- 응답: **HTTP 200**

## E2 결과 — 운영자가 취소 전 화면에서 승인

관련 규칙: R8 최신 상태 — 서버가 DB 상태(CANCELLED)로 판단

- 요청: `POST /api/applications/1/approve` · 행위자 **manager1** (Authorization: Bearer ***)
- 응답: **HTTP 409** · code `INVALID_STATE`

요청 전후 비교 (applications·application_history 전체 행): **동일 — 데이터 불변** · 이력 2건 → 2건

```json
{
  "applications": [
    {
      "id": 1,
      "event_id": 1,
      "user_id": 1,
      "status": "CANCELLED",
      "created_at": "2026-11-24T05:28:35.886Z"
    }
  ],
  "approvedCount": {
    "event1": 0,
    "event2": 0
  },
  "history": [
    {
      "id": 1,
      "application_id": 1,
      "actor_id": 1,
      "action": "APPLY",
      "from_status": null,
      "to_status": "PENDING",
      "reason": null,
      "cause_history_id": null
    },
    {
      "id": 2,
      "application_id": 1,
      "actor_id": 1,
      "action": "CANCEL",
      "from_status": "PENDING",
      "to_status": "CANCELLED",
      "reason": null,
      "cause_history_id": null
    }
  ]
}
```

## E3 정원 초과 직접 승인 거부 (T13)

준비 (행사 2 정원 1명):
- 요청: `POST /api/events/2/applications` · 행위자 **alice** (Authorization: Bearer ***)
- 응답: **HTTP 201** · Location `/api/applications/1`
- 요청: `POST /api/events/2/applications` · 행위자 **bob** (Authorization: Bearer ***)
- 응답: **HTTP 201** · Location `/api/applications/2`
- 요청: `POST /api/applications/1/approve` · 행위자 **manager2** (Authorization: Bearer ***)
- 응답: **HTTP 200**

## E3 결과

관련 규칙: R4 정원 — APPROVED 수가 정원 이상이면 409

- 요청: `POST /api/applications/2/approve` · 행위자 **manager2** (Authorization: Bearer ***)
- 응답: **HTTP 409** · code `CAPACITY_FULL`

요청 전후 비교 (applications·application_history 전체 행): **동일 — 데이터 불변** · 이력 3건 → 3건

```json
{
  "applications": [
    {
      "id": 1,
      "event_id": 2,
      "user_id": 1,
      "status": "APPROVED",
      "created_at": "2026-11-24T05:28:36.090Z"
    },
    {
      "id": 2,
      "event_id": 2,
      "user_id": 2,
      "status": "PENDING",
      "created_at": "2026-11-24T05:28:36.093Z"
    }
  ],
  "approvedCount": {
    "event1": 0,
    "event2": 1
  },
  "history": [
    {
      "id": 1,
      "application_id": 1,
      "actor_id": 1,
      "action": "APPLY",
      "from_status": null,
      "to_status": "PENDING",
      "reason": null,
      "cause_history_id": null
    },
    {
      "id": 2,
      "application_id": 2,
      "actor_id": 2,
      "action": "APPLY",
      "from_status": null,
      "to_status": "PENDING",
      "reason": null,
      "cause_history_id": null
    },
    {
      "id": 3,
      "application_id": 1,
      "actor_id": 4,
      "action": "APPROVE",
      "from_status": "PENDING",
      "to_status": "APPROVED",
      "reason": null,
      "cause_history_id": null
    }
  ]
}
```

## E4 승인 취소 → 다음 대기자 자동 승급 (U04·T18·T25)

준비: 행사 2에 alice·bob·charlie 순서로 신청, alice 승인
- 요청: `POST /api/events/2/applications` · 행위자 **alice** (Authorization: Bearer ***)
- 응답: **HTTP 201** · Location `/api/applications/1`
- 요청: `POST /api/events/2/applications` · 행위자 **bob** (Authorization: Bearer ***)
- 응답: **HTTP 201** · Location `/api/applications/2`
- 요청: `POST /api/events/2/applications` · 행위자 **charlie** (Authorization: Bearer ***)
- 응답: **HTTP 201** · Location `/api/applications/3`
- 요청: `POST /api/applications/1/approve` · 행위자 **manager2** (Authorization: Bearer ***)
- 응답: **HTTP 200**

실행:
- 요청: `POST /api/applications/1/revoke` · 행위자 **manager2** (Authorization: Bearer ***) · 본문 `{"reason":"  운영 사정으로 승인 취소  "}`
- 응답: **HTTP 200**
- revoked: id 1 REVOKED · promoted: id 2 APPROVED

요청 후 DB:

```json
{
  "applications": [
    {
      "id": 1,
      "event_id": 2,
      "user_id": 1,
      "status": "REVOKED",
      "created_at": "2026-11-24T05:28:36.293Z"
    },
    {
      "id": 2,
      "event_id": 2,
      "user_id": 2,
      "status": "APPROVED",
      "created_at": "2026-11-24T05:28:36.298Z"
    },
    {
      "id": 3,
      "event_id": 2,
      "user_id": 5,
      "status": "PENDING",
      "created_at": "2026-11-24T05:28:36.301Z"
    }
  ],
  "approvedCount": {
    "event1": 0,
    "event2": 1
  },
  "history": [
    {
      "id": 1,
      "application_id": 1,
      "actor_id": 1,
      "action": "APPLY",
      "from_status": null,
      "to_status": "PENDING",
      "reason": null,
      "cause_history_id": null
    },
    {
      "id": 2,
      "application_id": 2,
      "actor_id": 2,
      "action": "APPLY",
      "from_status": null,
      "to_status": "PENDING",
      "reason": null,
      "cause_history_id": null
    },
    {
      "id": 3,
      "application_id": 3,
      "actor_id": 5,
      "action": "APPLY",
      "from_status": null,
      "to_status": "PENDING",
      "reason": null,
      "cause_history_id": null
    },
    {
      "id": 4,
      "application_id": 1,
      "actor_id": 4,
      "action": "APPROVE",
      "from_status": "PENDING",
      "to_status": "APPROVED",
      "reason": null,
      "cause_history_id": null
    },
    {
      "id": 5,
      "application_id": 1,
      "actor_id": 4,
      "action": "REVOKE",
      "from_status": "APPROVED",
      "to_status": "REVOKED",
      "reason": "운영 사정으로 승인 취소",
      "cause_history_id": null
    },
    {
      "id": 6,
      "application_id": 2,
      "actor_id": 4,
      "action": "AUTO_APPROVE",
      "from_status": "PENDING",
      "to_status": "APPROVED",
      "reason": null,
      "cause_history_id": 5
    }
  ]
}
```

확인: bob(id 2) 승급 · charlie 대기 유지 · AUTO_APPROVE.cause_history_id(5) = REVOKE.id(5) · 사유 trim 저장 → **일치**

## E5 대기자 없는 승인 취소 (U05·T17)

준비:
- 요청: `POST /api/events/2/applications` · 행위자 **alice** (Authorization: Bearer ***)
- 응답: **HTTP 201** · Location `/api/applications/1`
- 요청: `POST /api/applications/1/approve` · 행위자 **manager2** (Authorization: Bearer ***)
- 응답: **HTTP 200**

실행:
- 요청: `POST /api/applications/1/revoke` · 행위자 **manager2** (Authorization: Bearer ***) · 본문 `{"reason":"행사 장소 변경"}`
- 응답: **HTTP 200**
- promoted: null

```json
{
  "applications": [
    {
      "id": 1,
      "event_id": 2,
      "user_id": 1,
      "status": "REVOKED",
      "created_at": "2026-11-24T05:28:36.504Z"
    }
  ],
  "approvedCount": {
    "event1": 0,
    "event2": 0
  },
  "history": [
    {
      "id": 1,
      "application_id": 1,
      "actor_id": 1,
      "action": "APPLY",
      "from_status": null,
      "to_status": "PENDING",
      "reason": null,
      "cause_history_id": null
    },
    {
      "id": 2,
      "application_id": 1,
      "actor_id": 4,
      "action": "APPROVE",
      "from_status": "PENDING",
      "to_status": "APPROVED",
      "reason": null,
      "cause_history_id": null
    },
    {
      "id": 3,
      "application_id": 1,
      "actor_id": 4,
      "action": "REVOKE",
      "from_status": "APPROVED",
      "to_status": "REVOKED",
      "reason": "행사 장소 변경",
      "cause_history_id": null
    }
  ]
}
```

확인: REVOKED · 승인 인원 0 · promoted=null → **일치**

## E6 대기 등록 시각이 같을 때 ID 오름차순 (T19)

준비: 행사 1에 alice 승인, charlie·bob 순서로 신청 후 두 대기자의 created_at을 같은 값으로 맞춤
- 요청: `POST /api/events/1/applications` · 행위자 **alice** (Authorization: Bearer ***)
- 응답: **HTTP 201** · Location `/api/applications/1`
- 요청: `POST /api/applications/1/approve` · 행위자 **manager1** (Authorization: Bearer ***)
- 응답: **HTTP 200**
- 요청: `POST /api/events/1/applications` · 행위자 **charlie** (Authorization: Bearer ***)
- 응답: **HTTP 201** · Location `/api/applications/2`
- 요청: `POST /api/events/1/applications` · 행위자 **bob** (Authorization: Bearer ***)
- 응답: **HTTP 201** · Location `/api/applications/3`
- (테스트용 직접 SQL) charlie id 2, bob id 3의 created_at = 2026-11-01T00:00:00.000Z

실행:
- 요청: `POST /api/applications/1/revoke` · 행위자 **manager1** (Authorization: Bearer ***) · 본문 `{"reason":"순서 확인용 승인 취소"}`
- 응답: **HTTP 200**
- promoted id 2 (기대: 더 작은 ID 2) → **일치**

## E7 AUTO_APPROVE 이력 저장 실패 → 전체 롤백 (T29)

준비: 행사 1에 alice 승인, bob 대기
- 요청: `POST /api/events/1/applications` · 행위자 **alice** (Authorization: Bearer ***)
- 응답: **HTTP 201** · Location `/api/applications/1`
- 요청: `POST /api/applications/1/approve` · 행위자 **manager1** (Authorization: Bearer ***)
- 응답: **HTTP 200**
- 요청: `POST /api/events/1/applications` · 행위자 **bob** (Authorization: Bearer ***)
- 응답: **HTTP 201** · Location `/api/applications/2`
- (임시 DB에만) AUTO_APPROVE 이력 INSERT 시 오류를 내는 트리거 설치

## E7 결과 — 실패 주입 상태에서 승인 취소

관련 규칙: R7 원자성 — REVOKED·REVOKE 이력·APPROVED가 이미 실행된 뒤 마지막 INSERT 실패

- 요청: `POST /api/applications/1/revoke` · 행위자 **manager1** (Authorization: Bearer ***) · 본문 `{"reason":"실패 주입 확인"}`
- 응답: **HTTP 500** · code `INTERNAL_ERROR`

요청 전후 비교 (applications·application_history 전체 행): **동일 — 데이터 불변** · 이력 3건 → 3건

```json
{
  "applications": [
    {
      "id": 1,
      "event_id": 1,
      "user_id": 1,
      "status": "APPROVED",
      "created_at": "2026-11-24T05:28:36.922Z"
    },
    {
      "id": 2,
      "event_id": 1,
      "user_id": 2,
      "status": "PENDING",
      "created_at": "2026-11-24T05:28:36.926Z"
    }
  ],
  "approvedCount": {
    "event1": 1,
    "event2": 0
  },
  "history": [
    {
      "id": 1,
      "application_id": 1,
      "actor_id": 1,
      "action": "APPLY",
      "from_status": null,
      "to_status": "PENDING",
      "reason": null,
      "cause_history_id": null
    },
    {
      "id": 2,
      "application_id": 1,
      "actor_id": 3,
      "action": "APPROVE",
      "from_status": "PENDING",
      "to_status": "APPROVED",
      "reason": null,
      "cause_history_id": null
    },
    {
      "id": 3,
      "application_id": 2,
      "actor_id": 2,
      "action": "APPLY",
      "from_status": null,
      "to_status": "PENDING",
      "reason": null,
      "cause_history_id": null
    }
  ]
}
```

트리거 제거 후 재시도:
- 요청: `POST /api/applications/1/revoke` · 행위자 **manager1** (Authorization: Bearer ***) · 본문 `{"reason":"실패 주입 확인"}`
- 응답: **HTTP 200**
- promoted id 2 (bob 2)

## E8 같은 신청 반복 승인 취소 (T22·T32)

준비:
- 요청: `POST /api/events/2/applications` · 행위자 **alice** (Authorization: Bearer ***)
- 응답: **HTTP 201** · Location `/api/applications/1`
- 요청: `POST /api/events/2/applications` · 행위자 **bob** (Authorization: Bearer ***)
- 응답: **HTTP 201** · Location `/api/applications/2`
- 요청: `POST /api/applications/1/approve` · 행위자 **manager2** (Authorization: Bearer ***)
- 응답: **HTTP 200**
- 요청: `POST /api/applications/1/revoke` · 행위자 **manager2** (Authorization: Bearer ***) · 본문 `{"reason":"첫 번째 승인 취소"}`
- 응답: **HTTP 200**

## E8 결과 — 두 번째 승인 취소

관련 규칙: R8 — REVOKED는 종료 상태, 추가 승급 없음

- 요청: `POST /api/applications/1/revoke` · 행위자 **manager2** (Authorization: Bearer ***) · 본문 `{"reason":"두 번째 승인 취소"}`
- 응답: **HTTP 409** · code `INVALID_STATE`

요청 전후 비교 (applications·application_history 전체 행): **동일 — 데이터 불변** · 이력 5건 → 5건

```json
{
  "applications": [
    {
      "id": 1,
      "event_id": 2,
      "user_id": 1,
      "status": "REVOKED",
      "created_at": "2026-11-24T05:28:37.124Z"
    },
    {
      "id": 2,
      "event_id": 2,
      "user_id": 2,
      "status": "APPROVED",
      "created_at": "2026-11-24T05:28:37.127Z"
    }
  ],
  "approvedCount": {
    "event1": 0,
    "event2": 1
  },
  "history": [
    {
      "id": 1,
      "application_id": 1,
      "actor_id": 1,
      "action": "APPLY",
      "from_status": null,
      "to_status": "PENDING",
      "reason": null,
      "cause_history_id": null
    },
    {
      "id": 2,
      "application_id": 2,
      "actor_id": 2,
      "action": "APPLY",
      "from_status": null,
      "to_status": "PENDING",
      "reason": null,
      "cause_history_id": null
    },
    {
      "id": 3,
      "application_id": 1,
      "actor_id": 4,
      "action": "APPROVE",
      "from_status": "PENDING",
      "to_status": "APPROVED",
      "reason": null,
      "cause_history_id": null
    },
    {
      "id": 4,
      "application_id": 1,
      "actor_id": 4,
      "action": "REVOKE",
      "from_status": "APPROVED",
      "to_status": "REVOKED",
      "reason": "첫 번째 승인 취소",
      "cause_history_id": null
    },
    {
      "id": 5,
      "application_id": 2,
      "actor_id": 4,
      "action": "AUTO_APPROVE",
      "from_status": "PENDING",
      "to_status": "APPROVED",
      "reason": null,
      "cause_history_id": 4
    }
  ]
}
```

## 요약

|ID|결과|
|---|---|
|E1|통과|
|E2|통과|
|E3|통과|
|E4|통과|
|E5|통과|
|E6|통과|
|E7|통과|
|E8|통과|
