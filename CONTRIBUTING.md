# 팀원 프로젝트 추가 가이드 (Growth 통합 성과 대시보드)

이 대시보드는 **비교대출 · 신용 · 자산(마이데이터)** 3개 사업 축에, 팀원 각자의 프로젝트/프로모션을 얹어 기여도를 보는 통합 대시보드입니다.
각자 자기 프로젝트 JSON 하나만 추가하면 대시보드에 자동으로 뜨고, **담당자 탭에 본인 이름이 자동 생성**됩니다.

배포 링크: https://dlwldbni.github.io/finda-promo-dashboard-2026/ (비번은 지윤에게)

---

## 추가 방법 (3단계)

1. **`data/<id>.json` 생성** — 아래 스키마대로. `<id>`는 영문 고유값(파일명과 동일).
2. **`data/list.json` 등록** — 해당 축 배열에 `"<id>"` 추가. 예: `"asset": ["asset_mydata_ab"]`
3. **commit + push** → GitHub Actions 자동배포(~20초).

> ⚠ `build_data.js` 는 **실행하지 마세요.** 그건 지윤의 데이터 생성기예요. 팀원 JSON 은 자동으로 보존되니 건드릴 필요 없습니다.
> (저장소 push 권한 필요 — collaborator 초대돼 있어야 함.)

---

## 자산(마이데이터) 축 스키마

**기여도 = (이 프로젝트가 기여한 MAU) ÷ (전체 마이데이터 당월 MAU)**.
전체 MAU(분모)는 지윤 쪽에서 Mixpanel 로 자동 갱신하니, 팀원은 **자기 프로젝트의 월별 기여 MAU** 만 넣으면 됩니다.

```json
{
  "id": "asset_mydata_ab",
  "line": "asset",
  "emoji": "🔗",
  "name": "마이데이터 OO 프로모션",
  "owner": "민주",
  "status": "live",
  "monthly": [
    { "month": "2026-08", "contributedMau": 5000, "connectDone": 1200, "retention": 60 }
  ]
}
```

| 필드 | 설명 |
|---|---|
| `id` | 영문 고유 id (파일명 `data/<id>.json` 과 동일) |
| `line` | `"asset"` 고정 |
| `emoji` / `name` / `owner` | 카드 이모지 / 프로젝트명 / **담당자(본인 이름)** |
| `status` | `"live"`(진행중) 또는 `"done"`(완료) |
| `monthly[]` | 월별 배열. 각 원소: |
| └ `month` | `"YYYY-MM"` |
| └ `contributedMau` | **(필수)** 그 달 이 프로젝트가 기여한 MAU → 기여도 계산 분자 |
| └ 그 외 숫자 지표 | 자유 추가 (예: `connectDone` 연동완료, `retention` 재방문). 카드·상세에 표시됨 |

---

## 참고: 비교대출 축 스키마 (일별)

비교대출은 일별 데이터, 기여도 = 팀 프로젝트 합계 대비 비중.

```json
{
  "id": "loan_xxx", "line": "loan", "emoji": "🎟️",
  "name": "OO 프로모션", "owner": "이름", "status": "done",
  "runs": [
    { "label": "7월", "start": "2026-07-01", "end": "2026-07-31", "granularity": "daily",
      "daily": [
        { "date": "2026-07-01", "inquiry": 100, "apply": 30, "contract": 5, "revenue": 500000 }
      ] }
  ]
}
```

지표 키: `introView`(인트로조회) `inquiry`(한도조회) `apply`(신청) `contract`(약정) `amount`(약정금액) `revenue`(매출) — 있는 것만 넣으면 됨. `approve`/`reject`(가승인/올거절), `creditLoan`/`otherLoan`(신용대출/우수대부) 세부도 넣으면 자동 표기.
