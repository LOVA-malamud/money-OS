-- Additive Phase A wallet/category setup. Never infer a cash opening balance.
-- Run once, after 202609130001_phase_a.sql. No existing row is updated/deleted.
begin;
set local lock_timeout = '5s';

create function private.add_cash_categories(u uuid) returns void
language plpgsql set search_path='' as $$
declare v jsonb;
begin
  -- Serialize with all normal owner writes. Archived/renamed wallets count too:
  -- do not silently recreate something the owner deliberately configured.
  perform 1 from public.money_datasets where owner_id=u for update;
  if not found then raise exception 'DATASET_REQUIRED'; end if;
  if not exists(select 1 from public.money_entities where owner_id=u and kind='account' and body->>'kind'='cash') then
    perform private.save_entity(u,'account',jsonb_build_object(
      'id',gen_random_uuid(),'name','מזומן','kind','cash','spendable',true,
      'openingKnown',false,'openingDate',null,'archived',false,'revision',1),null);
  end if;
  for v in select value from jsonb_array_elements('[
    {"id":"10000000-0000-4000-8000-000000000011","name":"דלק","kind":"expense","pinned":false,"icon":"fuel","revision":1},
    {"id":"10000000-0000-4000-8000-000000000012","name":"וויד","kind":"expense","pinned":false,"icon":"leaf","revision":1},
    {"id":"10000000-0000-4000-8000-000000000013","name":"אטנט","kind":"expense","pinned":false,"icon":"pill","revision":1}
  ]'::jsonb) loop
    -- Preserve existing categories, including customized default IDs/names.
    if not exists(select 1 from public.money_entities where owner_id=u and kind='category'
      and (id=(v->>'id')::uuid or (body->>'kind'='expense' and btrim(body->>'name')=v->>'name'))) then
      -- A conflicting ID of a different entity kind fails atomically; never overwrite it.
      perform private.save_entity(u,'category',v,null);
    end if;
  end loop;
end $$;
revoke all on function private.add_cash_categories(uuid) from public,anon,authenticated;

-- New installations receive the same defaults exactly once. Restores replace
-- entities, not the dataset row, so old backups remain exact after restoration.
create function private.new_dataset_cash_categories() returns trigger
language plpgsql set search_path='' as $$
begin
  perform private.add_cash_categories(new.owner_id);
  return new;
end $$;
revoke all on function private.new_dataset_cash_categories() from public,anon,authenticated;
create trigger money_dataset_cash_categories after insert on public.money_datasets
for each row execute function private.new_dataset_cash_categories();

-- Upgrade existing installations, with an in-transaction preservation check.
-- Capture comparisons inside PostgreSQL; no financial values are emitted/logged.
do $$
declare u uuid; before_data jsonb; after_data jsonb; key_name text;
begin
  for u in select owner_id from public.money_datasets order by owner_id for update loop
    before_data:=private.snapshot(u);
    perform private.add_cash_categories(u);
    perform private.validate_state(u);
    after_data:=private.snapshot(u);
    foreach key_name in array array['generation','settings','transactions','allocations','debts','obligations','recurrences','operations'] loop
      if before_data->key_name is distinct from after_data->key_name then raise exception 'CASH_UPGRADE_PRESERVATION_FAILED'; end if;
    end loop;
    foreach key_name in array array['accounts','paymentMethods','categories','audit'] loop
      if not ((after_data->key_name) @> (before_data->key_name)) then raise exception 'CASH_UPGRADE_PRESERVATION_FAILED'; end if;
    end loop;
  end loop;
end $$;
commit;
