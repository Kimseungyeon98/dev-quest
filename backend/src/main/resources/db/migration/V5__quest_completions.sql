-- 퀘스트 완료 기록: 언제 어떤 퀘스트를 끝냈는지. 연속 학습일(스트릭)·이번 주 기록·주간 랭킹이 이 표를 써요.
-- 진행도를 저장할 때 서버가 이전과 비교해서 새로 끝낸 퀘스트를 기록하고, 초기화로 빠진 퀘스트는 지워요.
-- live = false 는 이 기능 전에 끝낸 퀘스트라 시각을 추정한 기록이에요 (스트릭·주간 랭킹에서 빼요).
create table quest_completions (
    user_id      bigint       not null references users (id) on delete cascade,
    course_id    varchar(30)  not null,
    quest_id     varchar(100) not null,
    xp           int          not null,
    completed_at timestamptz  not null,
    live         boolean      not null default true,
    primary key (user_id, course_id, quest_id)
);
create index ix_quest_completions_user_time on quest_completions (user_id, completed_at);
create index ix_quest_completions_live_time on quest_completions (completed_at) where live;
