-- Record id cleanup and the id prefix guard (registry paging and ID cleanup
-- brief, items 2-4).
--
-- A record id's prefix is the brand slug of its manufacturer
-- (organizations.slug). 21 records didn't follow that: USL under uslinc/,
-- us-linc/ and usl-inc/; QSC under qsys/, qsc-audio/ and qsc-audio-products/;
-- DIS under dis-digital-conference-systems/; and an Extreme Networks switch kit
-- under crestron/. This migration
--
--   1. renames 15 of them (private.rename_record_id from 0012: registry id,
--      the document's "id", revisions, record requests, a redirect), and
--   2. merges 6 duplicates into the copy under the brand slug
--      (private.merge_record_ids below): the survivor keeps its id and history,
--      takes the more complete document as a new revision ("merged from
--      <old id>"), the loser's history and any open submissions move to the
--      survivor, the loser row is deleted and its id redirects to the survivor.
--
-- A rename or merge is not a removal: nothing goes into registry_removals
-- (the 0012 trigger already skips renames with a redirect; merges set
-- odio.merged_record for their delete). Every old id is in record_redirects,
-- so pages, downloads and the API answer it with a 308 and
-- /api/v1/redirects lists it.
--
-- Then the guard: a BEFORE trigger rejects any registry insert or update of
-- id/manufacturer whose id prefix isn't the brand slug (id_prefix_mismatch).
-- The migration aborts if a rename target already exists, if a merge survivor
-- is missing, or if any id is still off its brand slug afterwards.
--
-- private.brand_slug also strips accents now ("Société Générale" ->
-- "societe-generale", like the SDK's brandSlug and Genie's brand_slug). Stored
-- slugs don't change; every brand today is ASCII.
--
-- Idempotent: pairs already handled are skipped (their redirects are kept).

-- ---------------------------------------------------------------------------
-- Brand slugs: accents stripped (the 490 characters whose canonical
-- decomposition is one ASCII letter or digit plus combining marks, generated
-- from Unicode NFD), then lowercase, "&" -> " and ", anything else -> "-".
-- The SDK's brandSlug and Genie's brand_slug apply the same rule.
-- ---------------------------------------------------------------------------
create or replace function private.brand_slug(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select trim(both '-' from regexp_replace(
    replace(
      lower(translate(regexp_replace(coalesce(p_name, ''), '[̀-ͯ]', '', 'g'),
                      'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǦǧǨǩǪǫǬǭǰǴǵǸǹǺǻȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆẇẈẉẊẋẌẍẎẏẐẑẒẓẔẕẖẗẘẙẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹKÅ',
                      'aaaaaaceeeeiiiinooooouuuuyaaaaaaceeeeiiiinooooouuuuyyaaaaaaccccccccddeeeeeeeeeegggggggghhiiiiiiiiijjkkllllllnnnnnnoooooorrrrrrssssssssttttuuuuuuuuuuuuwwyyyzzzzzzoouuaaiioouuuuuuuuuuaaaaggkkoooojggnnaaaaaaeeeeiiiioooorrrruuuusstthhaaeeooooooooyyaabbbbbbccddddddddddeeeeeeeeeeffgghhhhhhhhhhiiiikkkkkkllllllllmmmmmmnnnnnnnnoooooooopppprrrrrrrrssssssssssttttttttuuuuuuuuuuvvvvwwwwwwwwwwxxxxyyzzzzzzhtwyaaaaaaaaaaaaaaaaaaaaaaaaeeeeeeeeeeeeeeeeiiiioooooooooooooooooooooooouuuuuuuuuuuuuuyyyyyyyyka')),
      '&', ' and '),
    '[^a-z0-9]+', '-', 'g'));
$$;

revoke all on function private.brand_slug(text) from public;

-- ---------------------------------------------------------------------------
-- A merge deletes the duplicate row; that delete is not a removal.
-- (Supersedes 0012's version: same rules, plus the merge flag.)
-- ---------------------------------------------------------------------------
create or replace function public.registry_record_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    -- private.merge_record_ids sets odio.merged_record to the id it folds away.
    if coalesce(current_setting('odio.merged_record', true), '') is distinct from old.id then
      insert into public.registry_removals (id, kind, manufacturer)
      values (old.id, old.kind, old.manufacturer);
    end if;
    return old;
  elsif tg_op = 'UPDATE' and new.id is distinct from old.id then
    if not exists (
      select 1 from public.record_redirects r
      where r.old_id = old.id and r.new_id = new.id
    ) then
      insert into public.registry_removals (id, kind, manufacturer)
      values (old.id, old.kind, old.manufacturer);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.registry_record_removal() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Merge a duplicate record into the copy that keeps its id. Service role /
-- migrations only. Returns false when there is nothing to do (already merged).
--   p_take       whose document the survivor keeps: 'survivor' or 'loser'
--   p_copy_keys  top-level document keys taken from the other copy
--                (e.g. '{power}' when only that copy has a power block)
--   p_category   a controlled category to set (document and column)
-- ---------------------------------------------------------------------------
create or replace function private.merge_record_ids(
  p_loser     text,
  p_survivor  text,
  p_take      text default 'survivor',
  p_copy_keys text[] default '{}',
  p_category  text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  l       public.registry%rowtype;
  s       public.registry%rowtype;
  src     public.registry%rowtype;
  other   public.registry%rowtype;
  v_doc   jsonb;
  v_ident jsonb;
  v_key   text;
  v_rev   uuid;
begin
  if p_loser = p_survivor then
    raise exception 'merge_record_ids: loser and survivor are the same (%)', p_loser;
  end if;
  if p_take not in ('survivor', 'loser') then
    raise exception 'merge_record_ids: p_take must be survivor or loser, not %', p_take;
  end if;

  select * into s from public.registry where id = p_survivor;
  select * into l from public.registry where id = p_loser;
  if l.id is null then
    -- Already merged (or never existed): keep the redirect when the survivor is live.
    if s.id is not null then
      insert into public.record_redirects (old_id, new_id) values (p_loser, p_survivor)
      on conflict (old_id) do nothing;
    end if;
    return false;
  end if;
  if s.id is null then
    raise exception 'merge_record_ids: survivor % does not exist; not merging %', p_survivor, p_loser;
  end if;

  insert into public.record_redirects (old_id, new_id) values (p_loser, p_survivor)
  on conflict (old_id) do update set new_id = excluded.new_id;

  -- The merged document: the chosen copy, plus any keys taken from the other,
  -- under the survivor's id.
  if p_take = 'loser' then
    src := l; other := s;
  else
    src := s; other := l;
  end if;
  v_doc := src.document;
  foreach v_key in array coalesce(p_copy_keys, '{}'::text[]) loop
    if other.document ? v_key then
      v_doc := jsonb_set(v_doc, array[v_key], other.document -> v_key, true);
    end if;
  end loop;
  v_doc := jsonb_set(v_doc, '{id}', to_jsonb(p_survivor), true);
  if p_category is not null and jsonb_typeof(v_doc -> 'device') = 'object' then
    v_doc := jsonb_set(v_doc, '{device,category}', to_jsonb(p_category), true);
  end if;
  v_ident := coalesce(v_doc -> 'device', v_doc -> 'bundle', v_doc -> 'cable', '{}'::jsonb);

  -- The loser's history and any open submissions now belong to the survivor.
  update public.record_revisions
     set record_id = p_survivor,
         document = case
           when jsonb_typeof(document) = 'object' and document ? 'id'
             then jsonb_set(document, '{id}', to_jsonb(p_survivor))
           else document
         end,
         status = case when status = 'published' then 'superseded' else status end
   where record_id = p_loser;

  -- The merge is the survivor's new published revision.
  update public.record_revisions
     set status = 'superseded'
   where record_id = p_survivor and status = 'published';
  insert into public.record_revisions
    (record_id, document, manufacturer, source_type, source_org_id, status,
     change_note, reviewer, reviewed_at)
  values
    (p_survivor, v_doc, s.manufacturer, src.source_type, src.source_org_id, 'published',
     'merged from ' || p_loser, 'OpenDeviceIO', now())
  returning id into v_rev;

  -- The registry row, derived from the merged document like deriveRegistryRow
  -- (lib/odio-row.ts): connectors/transports are every string under those keys.
  update public.registry
     set document          = v_doc,
         model             = v_ident ->> 'model',
         category          = coalesce(p_category, v_ident ->> 'category'),
         product_line      = v_ident ->> 'productLine',
         sku               = v_ident ->> 'sku',
         odio_version      = coalesce(v_doc ->> 'odioVersion', src.odio_version),
         validation_status = src.validation_status,
         source_type       = src.source_type,
         source_org_id     = src.source_org_id,
         port_count        = case when s.kind = 'device' and jsonb_typeof(v_doc -> 'ports') = 'array'
                                  then jsonb_array_length(v_doc -> 'ports') end,
         connectors        = coalesce((select array_agg(distinct v collate "C" order by v collate "C")
                                         from jsonb_path_query(v_doc, '$.**.connector') j,
                                              lateral (select j #>> '{}' as v) x
                                        where jsonb_typeof(j) = 'string'), '{}'),
         transports        = coalesce((select array_agg(distinct v collate "C" order by v collate "C")
                                         from jsonb_path_query(v_doc, '$.**.transport') j,
                                              lateral (select j #>> '{}' as v) x
                                        where jsonb_typeof(j) = 'string'), '{}'),
         current_revision_id = v_rev
   where id = p_survivor;

  update public.record_requests
     set record_ids = (select array_agg(distinct x) from unnest(array_replace(record_ids, p_loser, p_survivor)) x)
   where p_loser = any (record_ids);

  -- Anything that pointed at the loser now points at the survivor (no chains).
  update public.record_redirects set new_id = p_survivor where new_id = p_loser;

  -- Delete the duplicate. Not a removal (see registry_record_removal).
  perform set_config('odio.merged_record', p_loser, true);
  delete from public.registry where id = p_loser;
  perform set_config('odio.merged_record', '', true);

  return true;
end;
$$;

revoke all on function private.merge_record_ids(text, text, text, text[], text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The 21 records
-- ---------------------------------------------------------------------------
do $$
declare
  r     record;
  v_bad text;
begin
  drop table if exists _odio_renames;
  create temp table _odio_renames (old_id text, new_id text) on commit drop;
  insert into _odio_renames values
    ('usl-inc/jsd',                               'usl/jsd'),
    ('qsys/ad-c8t-zb',                            'qsc/ad-c8t-zb'),
    ('qsys/nc-12x80',                             'qsc/nc-12x80'),
    ('qsys/nc-pro15x',                            'qsc/nc-pro15x'),
    ('qsys/nl-p4',                                'qsc/nl-p4'),
    ('qsys/core-110f@v2',                         'qsc/core-110f@v2'),
    ('qsys/core-610',                             'qsc/core-610'),
    ('qsys/seervision-server',                    'qsc/seervision-server'),
    ('qsc-audio/ad-c42t',                         'qsc/ad-c42t'),
    ('qsc-audio/cx6t',                            'qsc/cx6t'),
    ('qsc-audio/md-f122-64r',                     'qsc/md-f122-64r'),
    ('qsc-audio/rave-160s',                       'qsc/rave-160s'),
    ('qsc-audio-products/cx4',                    'qsc/cx4'),
    ('dis-digital-conference-systems/dm-6680-f',  'dis/dm-6680-f'),
    ('crestron/cen-extrm-220-24p-kit',            'extreme-networks/cen-extrm-220-24p-kit');

  drop table if exists _odio_merges;
  create temp table _odio_merges (loser text, survivor text, take text, copy_keys text[], category text) on commit drop;
  insert into _odio_merges values
    -- USL: survivor ids under usl/
    ('uslinc/cm-10b',   'usl/cm-10b',    'loser',    '{}',      null),                -- 17 ports vs 4
    ('us-linc/dat-100', 'usl/dat-100',   'survivor', '{}',      'av/test-equipment'), -- normalizeCategory of both copies
    ('us-linc/mmp-10',  'usl/mmp-10',    'survivor', '{}',      'av/test-equipment'),
    ('uslinc/pca',      'usl/pca',       'survivor', '{}',      null),                -- English productLine
    -- QSC: survivor ids under qsc/
    ('qsys/ad-c6t-zb',  'qsc/ad-c6t-zb', 'survivor', '{power}', null),                -- 2 ports vs 1; power from qsys/
    ('qsys/rmp-100',    'qsc/rmp-100',   'loser',    '{}',      null);                -- qsys/ document is more complete

  -- Check everything before touching anything.
  for r in select * from _odio_renames loop
    if exists (select 1 from public.registry where id = r.old_id)
       and exists (select 1 from public.registry where id = r.new_id) then
      raise exception 'record id cleanup aborted: % already exists (would collide with %)', r.new_id, r.old_id;
    end if;
  end loop;
  for r in select * from _odio_merges loop
    if exists (select 1 from public.registry where id = r.loser)
       and not exists (select 1 from public.registry where id = r.survivor) then
      raise exception 'record id cleanup aborted: merge survivor % is missing (for %)', r.survivor, r.loser;
    end if;
  end loop;

  for r in select * from _odio_renames loop
    perform private.rename_record_id(r.old_id, r.new_id);
  end loop;
  for r in select * from _odio_merges loop
    perform private.merge_record_ids(r.loser, r.survivor, r.take, r.copy_keys, r.category);
  end loop;

  -- Every id is now under its brand slug, or nothing is committed.
  select string_agg(g.id, ', ' order by g.id) into v_bad
    from public.registry g
    join public.organizations o on o.kind = 'manufacturer' and o.manufacturer = g.manufacturer
   where split_part(g.id, '/', 1) <> o.slug;
  if v_bad is not null then
    raise exception 'record id cleanup aborted: ids still off their brand slug: %', v_bad;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The guard: an id's prefix must be its manufacturer's brand slug.
-- ---------------------------------------------------------------------------
create or replace function public.registry_check_id_prefix()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_slug   text;
  v_prefix text;
begin
  if new.manufacturer is null or btrim(new.manufacturer) = '' then
    return new;
  end if;
  -- The brand's profile (created now for a new brand, as 0010's trigger would).
  v_org := private.ensure_brand_org(new.manufacturer);
  select slug into v_slug from public.organizations where id = v_org;
  v_prefix := split_part(new.id, '/', 1);
  if v_slug is not null and v_prefix is distinct from v_slug then
    raise exception using
      errcode = 'check_violation',
      message = format('id_prefix_mismatch: id prefix %L doesn''t match brand slug %L', v_prefix, v_slug),
      hint    = format('Use %s/%s', v_slug, substr(new.id, length(v_prefix) + 2));
  end if;
  return new;
end;
$$;

revoke all on function public.registry_check_id_prefix() from public, anon, authenticated;

drop trigger if exists registry_id_prefix_check on public.registry;
create trigger registry_id_prefix_check
  before insert or update of id, manufacturer on public.registry
  for each row execute function public.registry_check_id_prefix();
