-- 계정
-- password_hash 는 나중에 SSO 로만 가입한 계정(비밀번호 없음)을 위해 NULL 을 허용해요.
-- SSO 를 붙일 때는 user_identities(provider, subject, user_id) 테이블을 따로 만들어 연결해요.
create table users (
    id            bigint generated always as identity primary key,
    username      varchar(20)  not null,
    password_hash varchar(100),
    created_at    timestamptz  not null default now(),
    updated_at    timestamptz  not null default now()
);
-- 아이디는 대소문자를 구분하지 않고 하나만 (Dev 와 dev 는 같은 아이디)
create unique index ux_users_username_lower on users (lower(username));

-- 과목별 진행도: 각 과목 앱이 저장하던 JSON 을 그대로 보관해요.
-- version 은 다른 기기에서 더 최근에 저장한 기록을 덮어쓰지 않도록 비교하는 값이에요.
create table progress (
    user_id    bigint       not null references users (id) on delete cascade,
    course_id  varchar(30)  not null,
    data       jsonb        not null,
    version    bigint       not null default 0,
    updated_at timestamptz  not null default now(),
    primary key (user_id, course_id)
);
