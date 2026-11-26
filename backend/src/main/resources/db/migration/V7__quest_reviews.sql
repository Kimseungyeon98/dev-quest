-- 오답 노트: 퀘스트마다 틀린 시도·힌트·정답 보기 횟수와, 오답 노트에서 다시 맞혀 졸업한 시각
--   cleared_at 이 비어 있으면 오답 노트에 보여요. 다시 틀리거나 힌트를 보면 다시 비워져요(노트로 돌아와요)
create table quest_reviews (
    user_id      bigint       not null references users (id) on delete cascade,
    course_id    varchar(30)  not null,
    quest_id     varchar(100) not null,
    wrong_count  int          not null default 0,
    hint_count   int          not null default 0,
    answer_count int          not null default 0,
    first_at     timestamptz  not null default now(),
    last_at      timestamptz  not null default now(),
    solved_at    timestamptz,
    cleared_at   timestamptz,
    primary key (user_id, course_id, quest_id)
);
create index ix_quest_reviews_open on quest_reviews (user_id, last_at desc) where cleared_at is null;
