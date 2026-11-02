-- Balote Club — schéma Supabase (Postgres 15+). À exécuter dans l'éditeur SQL du projet.
-- Rejouable : création idempotente, policies et fonctions remplacées.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- Tables

create table if not exists public.parties (
  id       uuid primary key default gen_random_uuid(),
  code     text not null unique check (code ~ '^[A-Z0-9]{5}$'),
  hote     uuid not null references auth.users (id) on delete cascade,
  invite   uuid references auth.users (id) on delete set null,
  seed     bigint not null,
  statut   text not null default 'attente' check (statut in ('attente', 'en_cours', 'fin', 'abandon')),
  cree_le  timestamptz not null default now(),
  maj_le   timestamptz not null default now(),
  check (invite is null or invite <> hote)
);

create table if not exists public.coups (
  id         bigserial primary key,
  partie_id  uuid not null references public.parties (id) on delete cascade,
  auteur     uuid not null references auth.users (id) on delete cascade,
  seq        int not null check (seq >= 0),
  angle      float8 not null check (angle >= 0 and angle < 36000),
  puissance  float8 not null check (puissance >= 0 and puissance <= 1),
  cree_le    timestamptz not null default now()
);

-- Un seul coup par numéro de séquence : bloque les doublons côté serveur.
create unique index if not exists coups_partie_seq on public.coups (partie_id, seq);
create index if not exists parties_code on public.parties (code);

alter table public.parties enable row level security;
alter table public.coups enable row level security;

-- Droits table explicites (les projets récents n'en accordent plus par défaut) ; les
-- policies RLS ci-dessous filtrent ensuite ligne par ligne.
revoke all on public.parties, public.coups from anon;
grant select on public.parties to authenticated;
grant select, insert on public.coups to authenticated;
grant usage on sequence public.coups_id_seq to authenticated;

-- ---------------------------------------------------------------- Fonctions

create or replace function public.est_membre(p_partie uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.parties
    where id = p_partie and auth.uid() is not null and (hote = auth.uid() or invite = auth.uid())
  );
$$;

-- Prochain numéro de coup attendu : impose une séquence continue côté serveur.
create or replace function public.prochain_seq(p_partie uuid)
returns int
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(max(seq), -1) + 1 from public.coups where partie_id = p_partie;
$$;

create or replace function public.creer_partie()
returns setof public.parties
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise';
  end if;
  loop
    v_code := '';
    for i in 1..5 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.parties where code = v_code);
  end loop;
  -- Graine serveur sur 31 bits : jamais fournie par le client.
  return query
    insert into public.parties (code, hote, seed)
    values (v_code, auth.uid(), floor(random() * 2147483647)::bigint)
    returning *;
end;
$$;

create or replace function public.rejoindre_partie(p_code text)
returns setof public.parties
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.parties;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise';
  end if;
  select * into v from public.parties where code = upper(p_code) for update;
  if not found then
    raise exception 'Salon inexistant';
  end if;
  if v.statut in ('fin', 'abandon') then
    raise exception 'Partie terminée';
  end if;
  if v.hote = auth.uid() then
    raise exception 'Auto-jointure refusée : vous êtes le propre hôte de ce salon';
  end if;
  -- Reprise par l'invité déjà inscrit (rechargement) : autorisée.
  if v.invite = auth.uid() then
    return query select * from public.parties where id = v.id;
    return;
  end if;
  if v.invite is not null or v.statut <> 'attente' then
    raise exception 'Salon plein';
  end if;
  return query
    update public.parties
    set invite = auth.uid(), statut = 'en_cours', maj_le = now()
    where id = v.id
    returning *;
end;
$$;

-- Clôture par un membre (fin normale ou abandon). Écart documenté dans NOTES.md.
create or replace function public.cloturer_partie(p_id uuid, p_statut text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_statut not in ('fin', 'abandon') then
    raise exception 'Statut invalide';
  end if;
  if not public.est_membre(p_id) then
    raise exception 'Accès refusé';
  end if;
  update public.parties
  set statut = p_statut, maj_le = now()
  where id = p_id and statut in ('attente', 'en_cours');
end;
$$;

revoke all on function public.creer_partie() from public, anon;
revoke all on function public.rejoindre_partie(text) from public, anon;
revoke all on function public.cloturer_partie(uuid, text) from public, anon;
grant execute on function public.creer_partie() to authenticated;
grant execute on function public.rejoindre_partie(text) to authenticated;
grant execute on function public.cloturer_partie(uuid, text) to authenticated;
grant execute on function public.est_membre(uuid) to authenticated;
revoke all on function public.prochain_seq(uuid) from public, anon;
grant execute on function public.prochain_seq(uuid) to authenticated;

-- ---------------------------------------------------------------- Policies

drop policy if exists parties_lecture on public.parties;
create policy parties_lecture on public.parties
  for select to authenticated
  using (hote = auth.uid() or invite = auth.uid());

-- Les salons en attente ne sont pas listables : on ne rejoint que par le code exact,
-- via la RPC rejoindre_partie.

-- Aucune policy insert/update/delete sur parties : tout passe par les RPC.

drop policy if exists coups_lecture on public.coups;
create policy coups_lecture on public.coups
  for select to authenticated
  using (public.est_membre(partie_id));

drop policy if exists coups_insertion on public.coups;
create policy coups_insertion on public.coups
  for insert to authenticated
  with check (
    auteur = auth.uid()
    and public.est_membre(partie_id)
    and exists (select 1 from public.parties p where p.id = partie_id and p.statut = 'en_cours')
    and seq = public.prochain_seq(partie_id)
  );

-- Point d'accroche futur : Edge Function « valider_partie » (re-simulation serveur du
-- journal « coups » à partir de « parties.seed »), non implémentée en v1.

-- ---------------------------------------------------------------- Realtime

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'coups'
  ) then
    alter publication supabase_realtime add table public.coups;
  end if;
end;
$$;
