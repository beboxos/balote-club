-- Balote Club : profils (pseudo réservé avec mot de passe, avatar). Migration ADDITIVE : ne touche
-- ni parties ni coups. À exécuter dans l'éditeur SQL du projet, après schema.sql. Rejouable.
--
-- Projet partagé avec d'autres jeux : tout est préfixé bal_.
-- Modèle : on joue sans compte avec un pseudo libre. Réserver un pseudo crée un profil protégé par
-- un mot de passe (bcrypt) ; l'identité anonyme de l'appareil y est alors liée. Un pseudo réservé ne
-- peut être pris par personne d'autre. Aucun accès direct aux tables : uniquement les fonctions.

create extension if not exists pgcrypto;

create table if not exists public.bal_profils (
  id           uuid primary key default gen_random_uuid(),
  pseudo       text not null check (char_length(pseudo) between 3 and 14),
  secret_hash  text not null,
  avatar       text check (avatar is null or char_length(avatar) <= 20000),
  cree_par     uuid,
  cree_le      timestamptz not null default now(),
  essais       int not null default 0,
  bloque_jusqu timestamptz
);
-- Pseudo unique sans tenir compte des majuscules.
create unique index if not exists bal_profils_pseudo on public.bal_profils (lower(pseudo));

create table if not exists public.bal_liens (
  uid       uuid primary key references auth.users (id) on delete cascade,
  profil_id uuid not null references public.bal_profils (id) on delete cascade,
  lie_le    timestamptz not null default now()
);
create index if not exists bal_liens_profil on public.bal_liens (profil_id);

alter table public.bal_profils enable row level security;
alter table public.bal_liens enable row level security;
revoke all on public.bal_profils, public.bal_liens from anon, authenticated;

-- ---------------------------------------------------------------- Validations

create or replace function public.bal_pseudo_valide(p text)
returns boolean language sql immutable as $$
  select p is not null
     and char_length(btrim(p)) between 3 and 14
     and btrim(p) ~ '^[[:alnum:]À-ÖØ-öø-ÿ _.-]+$'
     and lower(translate(btrim(p), 'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñ',
                                   'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'))
         !~ '(merde|pute|connard|connasse|salope|encule|nique|fdp|batard|nazi|hitler|fuck|shit|bitch|cunt|nigg|dick|pussy|asshole|whore|porn)';
$$;

-- Avatar : numéro de portrait fourni par le jeu (« 01 »…) ou petite image encodée (≤ 20 000 caractères).
create or replace function public.bal_avatar_valide(a text)
returns boolean language sql immutable as $$
  select a is null
      or a ~ '^[0-9]{2}$'
      or (char_length(a) <= 20000 and a ~ '^data:image/(webp|jpeg);base64,[A-Za-z0-9+/=]+$');
$$;

-- ---------------------------------------------------------------- Fonctions publiques

-- 'invalide' | 'libre' | 'reserve' | 'a_moi' (réservé et lié à cet appareil).
create or replace function public.bal_pseudo_statut(p_pseudo text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v public.bal_profils;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.bal_pseudo_valide(p_pseudo) then return 'invalide'; end if;
  select * into v from public.bal_profils where lower(pseudo) = lower(btrim(p_pseudo));
  if not found then return 'libre'; end if;
  if exists (select 1 from public.bal_liens where uid = auth.uid() and profil_id = v.id) then return 'a_moi'; end if;
  return 'reserve';
end $$;

create or replace function public.bal_reserver(p_pseudo text, p_mdp text, p_avatar text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if not public.bal_pseudo_valide(p_pseudo) then return json_build_object('ok', false, 'error', 'invalide'); end if;
  if p_mdp is null or char_length(p_mdp) < 4 or char_length(p_mdp) > 64 then
    return json_build_object('ok', false, 'error', 'mdp');
  end if;
  if not public.bal_avatar_valide(p_avatar) then return json_build_object('ok', false, 'error', 'avatar'); end if;
  -- Limite anti-squat : 3 pseudos réservés par identité d'appareil.
  if (select count(*) from public.bal_profils where cree_par = auth.uid()) >= 3 then
    return json_build_object('ok', false, 'error', 'limite');
  end if;
  insert into public.bal_profils (pseudo, secret_hash, avatar, cree_par)
  values (btrim(p_pseudo), crypt(p_mdp, gen_salt('bf')), p_avatar, auth.uid())
  returning id into v_id;
  insert into public.bal_liens (uid, profil_id) values (auth.uid(), v_id)
  on conflict (uid) do update set profil_id = excluded.profil_id, lie_le = now();
  return json_build_object('ok', true, 'pseudo', btrim(p_pseudo), 'avatar', p_avatar);
exception when unique_violation then
  return json_build_object('ok', false, 'error', 'pris');
end $$;

-- Retrouver son pseudo sur un autre appareil. 5 erreurs de mot de passe = blocage 15 minutes.
create or replace function public.bal_connecter(p_pseudo text, p_mdp text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v public.bal_profils;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select * into v from public.bal_profils where lower(pseudo) = lower(btrim(coalesce(p_pseudo, ''))) for update;
  if not found then return json_build_object('ok', false, 'error', 'inconnu'); end if;
  if v.bloque_jusqu is not null and v.bloque_jusqu > now() then
    return json_build_object('ok', false, 'error', 'bloque');
  end if;
  if p_mdp is null or v.secret_hash <> crypt(p_mdp, v.secret_hash) then
    update public.bal_profils
    set essais = case when essais + 1 >= 5 then 0 else essais + 1 end,
        bloque_jusqu = case when essais + 1 >= 5 then now() + interval '15 minutes' else bloque_jusqu end
    where id = v.id;
    return json_build_object('ok', false, 'error', 'mdp');
  end if;
  update public.bal_profils set essais = 0, bloque_jusqu = null where id = v.id;
  insert into public.bal_liens (uid, profil_id) values (auth.uid(), v.id)
  on conflict (uid) do update set profil_id = excluded.profil_id, lie_le = now();
  return json_build_object('ok', true, 'pseudo', v.pseudo, 'avatar', v.avatar);
end $$;

create or replace function public.bal_deconnecter()
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  delete from public.bal_liens where uid = auth.uid();
end $$;

-- Profil lié à cet appareil, ou null.
create or replace function public.bal_mon_profil()
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v public.bal_profils;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select p.* into v from public.bal_profils p join public.bal_liens l on l.profil_id = p.id where l.uid = auth.uid();
  if not found then return null; end if;
  return json_build_object('pseudo', v.pseudo, 'avatar', v.avatar);
end $$;

create or replace function public.bal_changer_avatar(p_avatar text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if p_avatar is null or not public.bal_avatar_valide(p_avatar) then return json_build_object('ok', false, 'error', 'avatar'); end if;
  update public.bal_profils set avatar = p_avatar
  where id = (select profil_id from public.bal_liens where uid = auth.uid());
  if not found then return json_build_object('ok', false, 'error', 'non_connecte'); end if;
  return json_build_object('ok', true);
end $$;

-- Profil vérifié d'un adversaire (identité d'appareil connue par le salon) : pseudo et avatar du
-- profil réservé qui lui est lié, ou null s'il joue avec un pseudo libre.
create or replace function public.bal_profil_de(p_uid uuid)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v public.bal_profils;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  select p.* into v from public.bal_profils p join public.bal_liens l on l.profil_id = p.id where l.uid = p_uid;
  if not found then return null; end if;
  return json_build_object('pseudo', v.pseudo, 'avatar', v.avatar);
end $$;

-- ---------------------------------------------------------------- Droits

revoke all on function public.bal_pseudo_valide(text), public.bal_avatar_valide(text) from public, anon, authenticated;
revoke all on function public.bal_pseudo_statut(text) from public, anon;
revoke all on function public.bal_reserver(text, text, text) from public, anon;
revoke all on function public.bal_connecter(text, text) from public, anon;
revoke all on function public.bal_deconnecter() from public, anon;
revoke all on function public.bal_mon_profil() from public, anon;
revoke all on function public.bal_changer_avatar(text) from public, anon;
revoke all on function public.bal_profil_de(uuid) from public, anon;
grant execute on function public.bal_pseudo_statut(text) to authenticated;
grant execute on function public.bal_reserver(text, text, text) to authenticated;
grant execute on function public.bal_connecter(text, text) to authenticated;
grant execute on function public.bal_deconnecter() to authenticated;
grant execute on function public.bal_mon_profil() to authenticated;
grant execute on function public.bal_changer_avatar(text) to authenticated;
grant execute on function public.bal_profil_de(uuid) to authenticated;
