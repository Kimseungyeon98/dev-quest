-- 닉네임: 랭킹 등 다른 사람에게 보이는 이름이에요. 로그인 아이디는 남에게 보여 주지 않아요.
-- 가입하면 "모험가1234" 같은 기본 닉네임이 붙고, 언제든 바꿀 수 있어요. 대소문자를 구분하지 않고 하나만 써요.
alter table users add column nickname varchar(20);
update users set nickname = '모험가' || id where nickname is null;
alter table users alter column nickname set not null;
create unique index ux_users_nickname_lower on users (lower(nickname));

-- 과목별 점수: 진행도를 저장할 때마다 퀘스트 카탈로그(shared/quests.json)로 다시 계산해 둬요. 랭킹은 이 표로 정렬해요.
-- reached_at 은 XP 가 마지막으로 바뀐 때 — XP 가 같으면 먼저 도달한 사람이 위예요.
create table course_scores (
    user_id    bigint       not null references users (id) on delete cascade,
    course_id  varchar(30)  not null,
    xp         int          not null default 0,
    done_count int          not null default 0,
    reached_at timestamptz  not null default now(),
    primary key (user_id, course_id)
);
create index ix_course_scores_rank on course_scores (course_id, xp desc, reached_at);
