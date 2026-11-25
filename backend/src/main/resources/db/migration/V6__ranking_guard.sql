-- 랭킹 부정 방지: 계정별 랭킹 상태
--   ok      : 랭킹에 보여요 (기본)
--   review  : 너무 빠르게 끝낸 기록이 있어 자동으로 잠시 빠졌어요. 관리자가 확인하고 되돌리거나 숨겨요
--   hidden  : 관리자가 랭킹에서 숨겼어요
--   trusted : 관리자가 확인한 계정이라 자동 검사로 빠지지 않아요
alter table users add column ranking_status varchar(10) not null default 'ok'
    check (ranking_status in ('ok', 'review', 'hidden', 'trusted'));
alter table users add column ranking_note varchar(200);
alter table users add column ranking_status_at timestamptz;
create index ix_users_ranking_status on users (ranking_status) where ranking_status in ('review', 'hidden');
