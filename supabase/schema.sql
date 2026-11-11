-- Stroll: schema ban đầu. Dán toàn bộ vào Supabase → SQL Editor → Run.
-- An toàn để chạy lại nhiều lần.

-- ============ Bảng ============
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Người chơi',
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists members_user_idx on public.members(user_id);

create table if not exists public.daily_steps (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  steps integer not null check (steps >= 0 and steps <= 100000),
  source text not null default 'manual',
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
-- Các cột bổ sung (phải có TRƯỚC các hàm bên dưới vì hàm `language sql` kiểm tra cột ngay lúc tạo).
alter table public.daily_steps add column if not exists origins jsonb not null default '{}'::jsonb;
alter table public.daily_steps add column if not exists flags text[] not null default '{}';
alter table public.daily_steps add column if not exists vehicle_steps integer not null default 0;

-- ============ Tự tạo profile khi có user mới ============
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1), 'Người chơi')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ Hàm hỗ trợ (tránh đệ quy RLS) ============
create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members where group_id = gid and user_id = auth.uid()
  );
$$;

-- Hai user có chung nhóm nào không?
create or replace function public.shares_group_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.members a
    join public.members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-- ============ Row Level Security ============
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.members enable row level security;
alter table public.daily_steps enable row level security;

drop policy if exists "profiles: xem bản thân và người cùng nhóm" on public.profiles;
create policy "profiles: xem bản thân và người cùng nhóm" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_group_with(id));

drop policy if exists "profiles: sửa bản thân" on public.profiles;
create policy "profiles: sửa bản thân" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "groups: thành viên xem" on public.groups;
create policy "groups: thành viên xem" on public.groups
  for select to authenticated
  using (public.is_group_member(id) or owner_id = auth.uid());

drop policy if exists "groups: chủ nhóm sửa" on public.groups;
create policy "groups: chủ nhóm sửa" on public.groups
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "groups: chủ nhóm xóa" on public.groups;
create policy "groups: chủ nhóm xóa" on public.groups
  for delete to authenticated
  using (owner_id = auth.uid());

drop policy if exists "members: xem cùng nhóm" on public.members;
create policy "members: xem cùng nhóm" on public.members
  for select to authenticated
  using (user_id = auth.uid() or public.is_group_member(group_id));

drop policy if exists "members: tự rời nhóm" on public.members;
create policy "members: tự rời nhóm" on public.members
  for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "steps: xem bản thân và người cùng nhóm" on public.daily_steps;
create policy "steps: xem bản thân và người cùng nhóm" on public.daily_steps
  for select to authenticated
  using (user_id = auth.uid() or public.shares_group_with(user_id));

-- Số bước KHÔNG cho ghi trực tiếp từ app nữa (chống gian lận): chỉ ghi qua hàm submit_steps có kiểm tra.
drop policy if exists "steps: ghi của bản thân" on public.daily_steps;
drop policy if exists "steps: sửa của bản thân" on public.daily_steps;

-- Không có policy insert cho groups/members: chỉ tạo/tham gia qua các hàm RPC bên dưới.

-- ============ RPC ============
create or replace function public.create_group(group_name text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.groups;
  code text;
  bytes bytea;
  i int;
  tries int := 0;
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập';
  end if;
  loop
    -- Mã 6 ký tự từ bảng chữ cái 32 ký tự, bỏ các ký tự dễ nhầm (0/O, 1/I).
    -- Dùng gen_random_uuid() (có sẵn trong Postgres) nên không cần extension pgcrypto.
    bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    code := '';
    for i in 0..5 loop
      code := code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.groups where invite_code = code);
    tries := tries + 1;
    if tries > 10 then raise exception 'Không tạo được mã mời, thử lại'; end if;
  end loop;

  insert into public.groups (name, invite_code, owner_id)
  values (trim(group_name), code, auth.uid())
  returning * into g;

  insert into public.members (group_id, user_id) values (g.id, auth.uid());
  return g;
end;
$$;

create or replace function public.join_group(code text)
returns public.groups
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.groups;
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập';
  end if;
  select * into g from public.groups where invite_code = upper(trim(code));
  if not found then
    raise exception 'Mã mời không đúng';
  end if;

  -- Khóa theo nhóm để hai người vào cùng lúc không vượt giới hạn.
  perform pg_advisory_xact_lock(hashtext(g.id::text));

  if not exists (select 1 from public.members where group_id = g.id and user_id = auth.uid())
     and (select count(*) from public.members where group_id = g.id) >= 10 then
    raise exception 'Nhóm đã đủ 10 thành viên';
  end if;

  insert into public.members (group_id, user_id)
  values (g.id, auth.uid())
  on conflict do nothing;
  return g;
end;
$$;

-- Số bước của từng thành viên theo từng ngày (kể cả ngày chưa có dữ liệu = 0).
create or replace function public.group_daily_steps(gid uuid, from_day date, to_day date)
returns table (user_id uuid, display_name text, day date, steps integer)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, p.display_name, d::date as day, coalesce(s.steps, 0)::integer as steps
  from public.members m
  join public.profiles p on p.id = m.user_id
  cross join generate_series(from_day, to_day, interval '1 day') d
  left join public.daily_steps s on s.user_id = m.user_id and s.day = d::date
  where m.group_id = gid
    and public.is_group_member(gid)
    and to_day - from_day <= 62
  order by d, p.display_name;
$$;

-- Bảng xếp hạng: tổng bước của từng thành viên trong khoảng ngày, kèm cờ cảnh báo (nếu có).
-- Đổi kiểu trả về nên phải xóa hàm cũ trước.
drop function if exists public.group_leaderboard(uuid, date, date);
create function public.group_leaderboard(gid uuid, from_day date, to_day date)
returns table (user_id uuid, display_name text, avatar_url text, total_steps bigint, flags text[])
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.avatar_url,
    coalesce(sum(s.steps), 0)::bigint as total_steps,
    coalesce((
      select array_agg(distinct f)
      from public.daily_steps s2, unnest(s2.flags) as f
      where s2.user_id = p.id and s2.day between from_day and to_day and f <> 'reset_by_owner'
    ), '{}') as flags
  from public.members m
  join public.profiles p on p.id = m.user_id
  left join public.daily_steps s
    on s.user_id = m.user_id and s.day between from_day and to_day
  where m.group_id = gid
    and public.is_group_member(gid)
  group by p.id, p.display_name, p.avatar_url
  order by total_steps desc, p.display_name;
$$;

-- ============ Chống gian lận: số bước theo giờ + nguồn dữ liệu + cờ cảnh báo ============

create table if not exists public.hourly_steps (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  hour smallint not null check (hour between 0 and 23),
  steps integer not null check (steps between 0 and 12000),
  primary key (user_id, day, hour)
);
alter table public.hourly_steps enable row level security;

drop policy if exists "hourly: xem bản thân và người cùng nhóm" on public.hourly_steps;
create policy "hourly: xem bản thân và người cùng nhóm" on public.hourly_steps
  for select to authenticated
  using (user_id = auth.uid() or public.shares_group_with(user_id));

-- Các ứng dụng được coi là nguồn đếm bước đáng tin. Thêm nguồn mới bằng INSERT ở SQL Editor.
create table if not exists public.trusted_origins (
  package text primary key,
  label text not null
);
alter table public.trusted_origins enable row level security;
drop policy if exists "origins: đọc" on public.trusted_origins;
create policy "origins: đọc" on public.trusted_origins for select to authenticated using (true);

insert into public.trusted_origins (package, label) values
  ('android', 'Hệ thống Android'),
  ('com.sec.android.app.shealth', 'Samsung Health'),
  ('com.google.android.apps.fitness', 'Google Fit'),
  ('com.google.android.gms', 'Google Play services'),
  ('com.fitbit.FitbitMobile', 'Fitbit'),
  ('com.garmin.android.apps.connectmobile', 'Garmin Connect'),
  ('com.xiaomi.hm.health', 'Zepp / Mi Fit'),
  ('com.huawei.health', 'Huawei Health')
on conflict (package) do nothing;

-- Ghi số bước một ngày (24 giá trị theo giờ địa phương của người dùng). Đây là CÁCH DUY NHẤT để ghi số bước.
-- Không từ chối dữ liệu lạ mà gắn cờ để cả nhóm nhìn thấy:
--   hour_high: có giờ > 9000 bước | night: > 2500 bước lúc 0–5h | untrusted_origin: có nguồn ngoài danh sách
--   decreased: tổng giảm > 30% so với lần ghi trước
--   mock_location: có điểm vị trí giả trong lộ trình ngày đó
-- p_vehicle: số bước (theo giờ) app đã xác định là xảy ra trên phương tiện; server trừ khỏi số bước.

drop function if exists public.submit_steps(date, integer[], jsonb, text);
create or replace function public.submit_steps(
  p_day date,
  p_hourly integer[],
  p_origins jsonb default '{}'::jsonb,
  p_source text default 'health_connect',
  p_vehicle integer[] default null
)
returns public.daily_steps
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  total integer := 0;
  raw_total integer := 0;
  veh_total integer := 0;
  night integer := 0;
  v integer;
  veh integer;
  h integer;
  flg text[] := '{}';
  had_prev boolean;
  prev public.daily_steps;
  res public.daily_steps;
begin
  if uid is null then
    raise exception 'Chưa đăng nhập';
  end if;
  if p_hourly is null or coalesce(array_length(p_hourly, 1), 0) <> 24 then
    raise exception 'Cần đủ 24 giá trị theo giờ';
  end if;
  if p_day > current_date + 1 or p_day < current_date - 7 then
    raise exception 'Ngày không hợp lệ';
  end if;
  if p_origins is null or jsonb_typeof(p_origins) <> 'object' or length(p_origins::text) > 4000 then
    p_origins := '{}'::jsonb;
  end if;

  select * into prev from public.daily_steps where user_id = uid and day = p_day;
  had_prev := found; -- FOUND bị vòng lặp bên dưới ghi đè nên lưu lại ngay
  -- Chủ nhóm đã đặt lại ngày này: giữ nguyên, không cho ghi đè.
  if had_prev and 'reset_by_owner' = any (prev.flags) then
    return prev;
  end if;

  if p_vehicle is not null and coalesce(array_length(p_vehicle, 1), 0) <> 24 then
    raise exception 'Cần đủ 24 giá trị đi xe theo giờ';
  end if;

  for h in 1..24 loop
    v := coalesce(p_hourly[h], 0);
    if v < 0 then
      raise exception 'Số bước không hợp lệ';
    end if;
    v := least(v, 12000);
    raw_total := raw_total + v;
    -- Trừ số bước đi xe (không vượt quá số bước của giờ đó)
    veh := least(greatest(coalesce(p_vehicle[h], 0), 0), v);
    veh_total := veh_total + veh;
    v := v - veh;
    if v > 9000 and not ('hour_high' = any (flg)) then
      flg := array_append(flg, 'hour_high');
    end if;
    p_hourly[h] := v;
    total := total + v;
    if h <= 5 then
      night := night + v;
    end if;
  end loop;

  if total > 100000 then
    raise exception 'Số bước vượt giới hạn hợp lý';
  end if;
  if night > 2500 then
    flg := array_append(flg, 'night');
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_origins) as k
    where not exists (select 1 from public.trusted_origins t where t.package = k)
  ) then
    flg := array_append(flg, 'untrusted_origin');
  end if;
  -- So sánh với lần ghi trước theo số bước THÔ (chưa trừ đi xe) để việc lọc đi xe không bị tính là "giảm".
  if had_prev and (prev.steps + prev.vehicle_steps) > 2000 and raw_total < (prev.steps + prev.vehicle_steps) * 0.7 then
    flg := array_append(flg, 'decreased');
  end if;
  if exists (select 1 from public.route_points r where r.user_id = uid and r.day = p_day and r.mocked) then
    flg := array_append(flg, 'mock_location');
  end if;

  insert into public.hourly_steps (user_id, day, hour, steps)
  select uid, p_day, (t.i - 1)::smallint, t.x
  from unnest(p_hourly) with ordinality as t(x, i)
  on conflict (user_id, day, hour) do update set steps = excluded.steps;

  insert into public.daily_steps (user_id, day, steps, vehicle_steps, source, origins, flags, updated_at)
  values (uid, p_day, total, veh_total, left(coalesce(p_source, 'health_connect'), 30), p_origins, flg, now())
  on conflict (user_id, day) do update
    set steps = excluded.steps, vehicle_steps = excluded.vehicle_steps, source = excluded.source,
        origins = excluded.origins, flags = excluded.flags, updated_at = excluded.updated_at
  returning * into res;

  return res;
end;
$$;

-- ============ Lộ trình (điểm GPS trong ngày) ============
-- mode: still (đứng yên) | walk | run | vehicle (xe máy, ô tô, xe đạp...) | unknown. Do app phân loại.
create table if not exists public.route_points (
  user_id uuid not null references public.profiles(id) on delete cascade,
  t timestamptz not null,
  day date not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  acc real,
  speed real,
  mode text not null default 'unknown' check (mode in ('still', 'walk', 'run', 'vehicle', 'unknown')),
  mocked boolean not null default false,
  primary key (user_id, t)
);
create index if not exists route_points_day_idx on public.route_points (user_id, day, t);
alter table public.route_points enable row level security;

-- Chủ nhóm có nhóm chứa người này? (security definer để tránh đệ quy RLS)
create or replace function public.owns_group_with(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.members m
    join public.groups g on g.id = m.group_id
    where m.user_id = target and g.owner_id = auth.uid()
  );
$$;

-- Lộ trình chỉ người đó và chủ nhóm của họ xem được (không phải mọi thành viên).
drop policy if exists "route: xem của mình hoặc chủ nhóm" on public.route_points;
create policy "route: xem của mình hoặc chủ nhóm" on public.route_points
  for select to authenticated
  using (user_id = auth.uid() or public.owns_group_with(user_id));

-- Ghi/cập nhật điểm lộ trình của MỘT ngày. p_points: [{t (ms epoch), lat, lng, acc, speed, mode, mocked}, ...]
create or replace function public.submit_route(p_day date, p_points jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n integer;
begin
  if uid is null then
    raise exception 'Chưa đăng nhập';
  end if;
  if p_day > current_date + 1 or p_day < current_date - 7 then
    raise exception 'Ngày không hợp lệ';
  end if;
  if p_points is null or jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) > 3000 then
    raise exception 'Danh sách điểm không hợp lệ (tối đa 3000 điểm mỗi lần)';
  end if;

  insert into public.route_points (user_id, t, day, lat, lng, acc, speed, mode, mocked)
  select uid, to_timestamp(p.t / 1000.0), p_day, p.lat, p.lng, p.acc, p.speed,
    case when p.mode in ('still', 'walk', 'run', 'vehicle') then p.mode else 'unknown' end,
    coalesce(p.mocked, false)
  from jsonb_to_recordset(p_points) as p(t double precision, lat double precision, lng double precision,
                                         acc real, speed real, mode text, mocked boolean)
  where p.t is not null and p.lat between -90 and 90 and p.lng between -180 and 180
  on conflict (user_id, t) do update set mode = excluded.mode, mocked = excluded.mocked;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- Lấy lộ trình của một người trong một ngày. Quyền xem do RLS ở trên quyết định (chính người đó hoặc chủ nhóm).
create or replace function public.get_route(target uuid, p_day date)
returns table (t timestamptz, lat double precision, lng double precision, acc real, speed real, mode text, mocked boolean)
language sql
stable
as $$
  select r.t, r.lat, r.lng, r.acc, r.speed, r.mode, r.mocked
  from public.route_points r
  where r.user_id = target and r.day = p_day
  order by r.t;
$$;

-- Chủ nhóm đặt số bước của một thành viên trong một ngày về 0 (và khóa ngày đó, đồng bộ sau không ghi đè được).
create or replace function public.owner_reset_steps(gid uuid, target uuid, p_day date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.groups where id = gid and owner_id = auth.uid()) then
    raise exception 'Chỉ chủ nhóm mới có quyền này';
  end if;
  if not exists (select 1 from public.members where group_id = gid and user_id = target) then
    raise exception 'Người này không ở trong nhóm';
  end if;
  delete from public.hourly_steps where user_id = target and day = p_day;
  insert into public.daily_steps (user_id, day, steps, source, flags, updated_at)
  values (target, p_day, 0, 'owner_reset', array['reset_by_owner'], now())
  on conflict (user_id, day) do update
    set steps = 0, vehicle_steps = 0, source = 'owner_reset', flags = array['reset_by_owner'], origins = '{}'::jsonb, updated_at = now();
end;
$$;

-- Số bước theo giờ của mọi thành viên trong một ngày (để vẽ đường đi trong cảnh).
create or replace function public.group_hourly_steps(gid uuid, p_day date)
returns table (user_id uuid, hour smallint, steps integer)
language sql
stable
security definer
set search_path = public
as $$
  select h.user_id, h.hour, h.steps
  from public.hourly_steps h
  join public.members m on m.user_id = h.user_id and m.group_id = gid
  where h.day = p_day and public.is_group_member(gid)
  order by h.user_id, h.hour;
$$;

revoke all on function public.create_group(text) from public, anon;
revoke all on function public.join_group(text) from public, anon;
revoke all on function public.group_leaderboard(uuid, date, date) from public, anon;
revoke all on function public.group_daily_steps(uuid, date, date) from public, anon;
revoke all on function public.submit_steps(date, integer[], jsonb, text, integer[]) from public, anon;
revoke all on function public.submit_route(date, jsonb) from public, anon;
revoke all on function public.get_route(uuid, date) from public, anon;
grant execute on function public.submit_route(date, jsonb) to authenticated;
grant execute on function public.get_route(uuid, date) to authenticated;
revoke all on function public.owner_reset_steps(uuid, uuid, date) from public, anon;
revoke all on function public.group_hourly_steps(uuid, date) from public, anon;
grant execute on function public.group_daily_steps(uuid, date, date) to authenticated;
grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.group_leaderboard(uuid, date, date) to authenticated;
grant execute on function public.submit_steps(date, integer[], jsonb, text, integer[]) to authenticated;
grant execute on function public.owner_reset_steps(uuid, uuid, date) to authenticated;
grant execute on function public.group_hourly_steps(uuid, date) to authenticated;
