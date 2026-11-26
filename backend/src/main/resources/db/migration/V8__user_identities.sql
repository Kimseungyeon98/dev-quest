-- SSO(구글·깃허브·카카오 등) 로그인 연결: 계정 하나에 여러 로그인 방식을 붙일 수 있어요.
--   provider + subject(그 서비스의 사용자 고유 id)가 같으면 같은 사람이에요. 이메일은 바뀔 수 있어서 참고용으로만 둬요.
--   SSO 로만 가입한 계정은 users.password_hash 가 비어 있어요 (V1 에서 NULL 허용).
create table user_identities (
    id            bigint generated always as identity primary key,
    user_id       bigint       not null references users (id) on delete cascade,
    provider      varchar(30)  not null,
    subject       varchar(200) not null,
    email         varchar(200),
    display_name  varchar(100),
    created_at    timestamptz  not null default now(),
    last_login_at timestamptz,
    constraint ux_user_identities_provider_subject unique (provider, subject),
    constraint ux_user_identities_user_provider unique (user_id, provider)
);
create index ix_user_identities_user on user_identities (user_id);
