-- Lova Money OS Phase A. All money columns are integer agorot.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table private.app_owner (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);
revoke all on private.app_owner from public, anon, authenticated;

create table public.money_datasets (
  owner_id uuid primary key references private.app_owner(user_id),
  generation uuid not null default gen_random_uuid(),
  settings jsonb not null default jsonb_build_object(
    'currency','ILS','timezone','Asia/Jerusalem','trackingStart', (now() at time zone 'Asia/Jerusalem')::date::text,
    'accountsReviewed',false,'debtsReviewed',false,'obligationsReviewed',false,'assetsReviewed',false,
    'lastPaymentMethodId',null,'recentCategoryIds','[]'::jsonb,'revision',1)
);
create table public.money_entities (
  owner_id uuid not null references public.money_datasets(owner_id),
  id uuid not null,
  kind text not null check(kind in ('account','paymentMethod','category','debt','obligation','recurrence')),
  body jsonb not null,
  amount_minor bigint,
  original_minor bigint,
  account_id uuid,
  liability_account_id uuid,
  category_id uuid,
  recurrence_id uuid,
  rule_cancelled boolean not null default false,
  revision integer not null check(revision>0),
  primary key(owner_id,id),
  foreign key(owner_id,account_id) references public.money_entities(owner_id,id) deferrable initially deferred,
  foreign key(owner_id,liability_account_id) references public.money_entities(owner_id,id) deferrable initially deferred,
  foreign key(owner_id,category_id) references public.money_entities(owner_id,id) deferrable initially deferred,
  foreign key(owner_id,recurrence_id) references public.money_entities(owner_id,id) deferrable initially deferred,
  check(amount_minor is null or amount_minor>=0),
  check(original_minor is null or original_minor>=0)
);
create index money_entities_kind on public.money_entities(owner_id,kind);
create unique index money_occurrence_unique on public.money_entities(owner_id,recurrence_id,(body->>'dueDate')) where kind='obligation' and recurrence_id is not null;
create table public.money_transactions (
  owner_id uuid not null references public.money_datasets(owner_id),
  id uuid not null,
  input jsonb not null,
  amount_minor bigint not null,
  principal_minor bigint,
  interest_minor bigint,
  fee_minor bigint,
  account_id uuid not null,
  to_account_id uuid,
  category_id uuid,
  payment_method_id uuid,
  original_transaction_id uuid,
  obligation_id uuid,
  effective_date date not null,
  voided boolean not null default false,
  revision integer not null check(revision>0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check(updated_at>=created_at),
  primary key(owner_id,id),
  foreign key(owner_id,account_id) references public.money_entities(owner_id,id),
  foreign key(owner_id,to_account_id) references public.money_entities(owner_id,id),
  foreign key(owner_id,category_id) references public.money_entities(owner_id,id),
  foreign key(owner_id,payment_method_id) references public.money_entities(owner_id,id),
  foreign key(owner_id,original_transaction_id) references public.money_transactions(owner_id,id) deferrable initially deferred,
  foreign key(owner_id,obligation_id) references public.money_entities(owner_id,id)
);
create index money_transactions_date on public.money_transactions(owner_id,effective_date);
create table public.money_postings (
  owner_id uuid not null,
  transaction_id uuid not null,
  ordinal integer not null,
  account_id text not null,
  amount_minor bigint not null,
  primary key(owner_id,transaction_id,ordinal),
  foreign key(owner_id,transaction_id) references public.money_transactions(owner_id,id) on delete cascade
);
create index money_postings_account on public.money_postings(owner_id,account_id);
create table public.money_allocations (
  owner_id uuid not null,
  id uuid not null,
  transaction_id uuid not null,
  obligation_id uuid not null,
  amount_minor bigint not null check(amount_minor>0),
  primary key(owner_id,id),
  unique(owner_id,transaction_id),
  foreign key(owner_id,transaction_id) references public.money_transactions(owner_id,id) on delete cascade,
  foreign key(owner_id,obligation_id) references public.money_entities(owner_id,id)
);
create table public.money_audit (
  owner_id uuid not null references public.money_datasets(owner_id),
  id uuid not null default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  action text not null,
  before_value jsonb,
  created_at timestamptz not null default clock_timestamp(),
  primary key(owner_id,id)
);
create table public.money_operations (
  owner_id uuid not null references public.money_datasets(owner_id),
  id uuid not null,
  request_hash text not null,
  result jsonb not null,
  primary key(owner_id,id)
);

create function private.is_owner() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.app_owner where user_id=auth.uid())
$$;
create unique index money_debt_account on public.money_entities(owner_id,account_id) where kind='debt';

create function private.save_entity(u uuid,k text,v jsonb,expected integer,restoring boolean default false) returns integer language plpgsql set search_path='' as $$
declare old public.money_entities; i uuid := (v->>'id')::uuid; rev integer; b jsonb; a bigint; orig bigint;
  account_ref uuid; liability_ref uuid; category_ref uuid; recurrence_ref uuid; start_d date; end_d date;
  required_keys text[]; field_name text;
begin
  if k not in ('account','paymentMethod','category','debt','obligation','recurrence') or i is null or jsonb_typeof(v)<>'object' then raise exception 'INVALID_ENTITY'; end if;
  required_keys:=case k
    when 'account' then array['id','name','kind','spendable','openingKnown','openingDate','archived','revision']
    when 'paymentMethod' then array['id','name','accountId','suffix','revision']
    when 'category' then array['id','name','kind','pinned','icon','revision']
    when 'debt' then array['id','accountId','creditor','originalMinor','note','revision']
    when 'obligation' then array['id','title','dueDate','expectedMinor','accountId','liabilityAccountId','categoryId','recurrenceId','cancelled','revision']
    else array['id','title','amountMinor','day','startDate','endDate','accountId','liabilityAccountId','categoryId','active','revision'] end;
  if not (v ?& required_keys) or v-required_keys<>'{}'::jsonb or jsonb_typeof(v->'revision') is distinct from 'number' then raise exception 'INVALID_ENTITY_FIELDS'; end if;
  foreach field_name in array array['name','title','creditor','note','suffix','icon'] loop
    if v ? field_name and jsonb_typeof(v->field_name) is distinct from 'string' then raise exception 'INVALID_ENTITY_TEXT'; end if;
  end loop;
  select * into old from public.money_entities where owner_id=u and id=i;
  if found then
    if old.kind<>k then raise exception 'ENTITY_KIND_IMMUTABLE'; end if;
    if expected is null or expected<>old.revision then raise exception 'REVISION_CONFLICT'; end if;
    rev:=old.revision+1;
  else
    if expected is not null and expected<>0 then raise exception 'REVISION_CONFLICT'; end if;
    rev:=1;
  end if;
  if restoring then rev:=(v->>'revision')::integer; end if;
  if k in ('account','paymentMethod','category') and (coalesce(length(trim(v->>'name')),0)=0 or length(v->>'name')>200) then raise exception 'NAME_REQUIRED'; end if;
  if k in ('obligation','recurrence') and (coalesce(length(trim(v->>'title')),0)=0 or length(v->>'title')>200) then raise exception 'TITLE_REQUIRED'; end if;
  if length(coalesce(v->>'note',''))>10000 then raise exception 'NOTE_TOO_LONG'; end if;
  account_ref:=(v->>'accountId')::uuid; liability_ref:=(v->>'liabilityAccountId')::uuid;
  category_ref:=(v->>'categoryId')::uuid; recurrence_ref:=(v->>'recurrenceId')::uuid;
  perform private.check_ref(u,account_ref,'account'); perform private.check_ref(u,liability_ref,'account');
  perform private.check_ref(u,category_ref,'category'); perform private.check_ref(u,recurrence_ref,'recurrence');
  if liability_ref is not null and not exists(select 1 from public.money_entities where owner_id=u and id=liability_ref and body->>'kind' in ('loan','credit_card')) then raise exception 'LIABILITY_REQUIRED'; end if;
  if k in ('obligation','recurrence') then
    if account_ref is not null and not exists(select 1 from public.money_entities where owner_id=u and id=account_ref and body->>'kind' in ('bank','cash','savings','credit_card')) then raise exception 'INVALID_PAYMENT_ACCOUNT'; end if;
    if liability_ref is not null and account_ref is not null and not exists(select 1 from public.money_entities where owner_id=u and id=account_ref and body->>'kind' in ('bank','cash','savings')) then raise exception 'INVALID_PAYMENT_ACCOUNT'; end if;
    if category_ref is not null and not exists(select 1 from public.money_entities where owner_id=u and id=category_ref and body->>'kind'='expense') then raise exception 'CATEGORY_KIND_MISMATCH'; end if;
  end if;
  b:=v - array['id','revision','amountMinor','expectedMinor','originalMinor'];
  if k='account' then
    if v->>'kind' not in ('bank','cash','savings','credit_card','loan','asset') or v->>'kind' is null then raise exception 'INVALID_ACCOUNT_KIND'; end if;
    if jsonb_typeof(v->'spendable') is distinct from 'boolean' or jsonb_typeof(v->'openingKnown') is distinct from 'boolean' or jsonb_typeof(v->'archived') is distinct from 'boolean' then raise exception 'INVALID_ACCOUNT_FLAGS'; end if;
    if (v->>'spendable')::boolean and v->>'kind' not in ('bank','cash','savings') then raise exception 'NOT_SPENDABLE_ACCOUNT'; end if;
    if old.id is not null and v->>'kind'<>old.body->>'kind' then raise exception 'ACCOUNT_KIND_IMMUTABLE'; end if;
    if not restoring and ((old.id is null and ((v->>'openingKnown')::boolean or v->>'openingDate' is not null)) or
      (old.id is not null and (v->'openingKnown' is distinct from old.body->'openingKnown' or v->'openingDate' is distinct from old.body->'openingDate'))) then raise exception 'OPENING_REQUIRES_LEDGER_ENTRY'; end if;
    if v->>'openingDate' is not null then perform private.valid_date(v->>'openingDate'); end if;
  elsif k='paymentMethod' then
    if account_ref is null then raise exception 'ACCOUNT_REQUIRED'; end if;
    if length(coalesce(v->>'suffix',''))>4 then raise exception 'INVALID_SUFFIX'; end if;
    if not exists(select 1 from public.money_entities where owner_id=u and id=account_ref and body->>'kind' in ('bank','cash','savings','credit_card')) then raise exception 'INVALID_PAYMENT_ACCOUNT'; end if;
    if old.id is not null and account_ref is distinct from old.account_id and exists(select 1 from public.money_transactions where owner_id=u and payment_method_id=i) then raise exception 'PAYMENT_ACCOUNT_IN_USE'; end if;
  elsif k='category' then
    if v->>'kind' not in ('expense','income') or v->>'kind' is null or jsonb_typeof(v->'pinned') is distinct from 'boolean' then raise exception 'INVALID_CATEGORY'; end if;
    if length(v->>'icon')>100 then raise exception 'TEXT_TOO_LONG'; end if;
    if old.id is not null and v->>'kind'<>old.body->>'kind' then raise exception 'CATEGORY_KIND_IMMUTABLE'; end if;
  elsif k='debt' then
    if account_ref is null or not exists(select 1 from public.money_entities where owner_id=u and id=account_ref and body->>'kind' in ('loan','credit_card')) then raise exception 'LIABILITY_REQUIRED'; end if;
    if coalesce(length(trim(v->>'creditor')),0)=0 or length(v->>'creditor')>200 then raise exception 'CREDITOR_REQUIRED'; end if;
    orig:=private.money(v->'originalMinor',true);
  elsif k='obligation' then
    perform private.valid_date(v->>'dueDate'); a:=private.money(v->'expectedMinor',true);
    if jsonb_typeof(v->'cancelled') is distinct from 'boolean' then raise exception 'INVALID_OBLIGATION'; end if;
    if old.id is not null and recurrence_ref is distinct from old.recurrence_id then raise exception 'RECURRENCE_LINK_IMMUTABLE'; end if;
    if a is not null and a<(select coalesce(sum(x.amount_minor),0) from public.money_allocations x join public.money_transactions t on t.owner_id=x.owner_id and t.id=x.transaction_id where x.owner_id=u and x.obligation_id=i and not t.voided) then raise exception 'OBLIGATION_BELOW_PAID'; end if;
  elsif k='recurrence' then
    start_d:=private.valid_date(v->>'startDate'); end_d:=case when v->>'endDate' is not null then private.valid_date(v->>'endDate') end;
    if end_d<start_d or (v->>'day')::integer not between 1 and 31 or v->>'day' is null or jsonb_typeof(v->'active') is distinct from 'boolean' then raise exception 'INVALID_RECURRENCE'; end if;
    if start_d < ((now() at time zone 'Asia/Jerusalem')::date-interval '50 years')::date then raise exception 'RECURRENCE_HISTORY_TOO_LONG'; end if;
    a:=private.money(v->'amountMinor',true);
  end if;
  if a<0 or orig<0 then raise exception 'NEGATIVE_OBLIGATION'; end if;
  insert into public.money_entities(owner_id,id,kind,body,amount_minor,original_minor,account_id,liability_account_id,category_id,recurrence_id,revision)
    values(u,i,k,b,a,orig,account_ref,liability_ref,category_ref,recurrence_ref,rev)
  on conflict(owner_id,id) do update set body=excluded.body,amount_minor=excluded.amount_minor,original_minor=excluded.original_minor,
    account_id=excluded.account_id,liability_account_id=excluded.liability_account_id,category_id=excluded.category_id,recurrence_id=excluded.recurrence_id,revision=excluded.revision,rule_cancelled=false;
  if not restoring then perform private.audit(u,k,i::text,case when old.id is null then 'create' else 'edit' end,case when old.id is not null then private.entity_json(old) end); end if;
  return rev;
end $$;
revoke all on function private.is_owner() from public;
grant execute on function private.is_owner() to authenticated;
do $$ declare n text; begin
  foreach n in array array['money_datasets','money_entities','money_transactions','money_postings','money_allocations','money_audit','money_operations'] loop
    execute format('alter table public.%I enable row level security', n);
    execute format('revoke all on public.%I from public, anon, authenticated', n);
    execute format('grant select on public.%I to authenticated', n);
    execute format('create policy owner_read on public.%I for select to authenticated using (owner_id = (select auth.uid()) and (select private.is_owner()))', n);
  end loop;
end $$;

create function private.require_owner() returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid := auth.uid(); begin
  if u is null or not exists(select 1 from private.app_owner where user_id=u) then
    raise exception 'OWNER_REQUIRED' using errcode='42501';
  end if;
  return u;
end $$;
create function private.money(v jsonb, optional boolean default false) returns bigint language plpgsql immutable set search_path='' as $$
begin
  if v is null or v='null'::jsonb then
    if optional then return null; else raise exception 'MONEY_REQUIRED'; end if;
  end if;
  if jsonb_typeof(v)<>'string' or (v#>>'{}') !~ '^(0|-?[1-9][0-9]*)$' then raise exception 'INVALID_INTEGER_MONEY'; end if;
  return (v#>>'{}')::bigint;
exception when numeric_value_out_of_range then raise exception 'MONEY_OUT_OF_RANGE';
end $$;
create function private.valid_date(v text) returns date language plpgsql immutable set search_path='' as $$
declare d date; begin
  if v is null or v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_DATE'; end if;
  d:=v::date;
  if d::text<>v or d<'1900-01-01' or d>'2200-12-31' then raise exception 'INVALID_DATE'; end if;
  return d;
end $$;
create function private.entity_json(e public.money_entities) returns jsonb language sql stable set search_path='' as $$
  select e.body || jsonb_build_object('id',e.id,'revision',e.revision) ||
    case e.kind
      when 'debt' then jsonb_build_object('originalMinor',e.original_minor::text,'accountId',e.account_id)
      when 'paymentMethod' then jsonb_build_object('accountId',e.account_id)
      when 'obligation' then jsonb_build_object('expectedMinor',e.amount_minor::text,'accountId',e.account_id,'liabilityAccountId',e.liability_account_id,'categoryId',e.category_id,'recurrenceId',e.recurrence_id)
      when 'recurrence' then jsonb_build_object('amountMinor',e.amount_minor::text,'accountId',e.account_id,'liabilityAccountId',e.liability_account_id,'categoryId',e.category_id)
      else '{}'::jsonb end
$$;
create function private.input_json(t public.money_transactions) returns jsonb language sql stable set search_path='' as $$
  select t.input || jsonb_build_object('amountMinor',t.amount_minor::text,'accountId',t.account_id) ||
    case when t.to_account_id is not null then jsonb_build_object('toAccountId',t.to_account_id) else '{}'::jsonb end ||
    case when t.category_id is not null then jsonb_build_object('categoryId',t.category_id) else '{}'::jsonb end ||
    case when t.payment_method_id is not null then jsonb_build_object('paymentMethodId',t.payment_method_id) else '{}'::jsonb end ||
    case when t.original_transaction_id is not null then jsonb_build_object('originalTransactionId',t.original_transaction_id) else '{}'::jsonb end ||
    case when t.obligation_id is not null then jsonb_build_object('obligationId',t.obligation_id) else '{}'::jsonb end ||
    case when t.principal_minor is not null then jsonb_build_object('principalMinor',t.principal_minor::text) else '{}'::jsonb end ||
    case when t.interest_minor is not null then jsonb_build_object('interestMinor',t.interest_minor::text) else '{}'::jsonb end ||
    case when t.fee_minor is not null then jsonb_build_object('feeMinor',t.fee_minor::text) else '{}'::jsonb end
$$;
create function private.transaction_json(t public.money_transactions) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',t.id,'input',private.input_json(t),'postings',
    coalesce((select jsonb_agg(jsonb_build_object('accountId',p.account_id,'amountMinor',p.amount_minor::text) order by p.ordinal)
      from public.money_postings p where p.owner_id=t.owner_id and p.transaction_id=t.id),'[]'::jsonb),
    'voided',t.voided,'revision',t.revision,'createdAt',t.created_at,'updatedAt',t.updated_at)
$$;
create function private.check_ref(u uuid, i uuid, k text) returns void language plpgsql stable set search_path='' as $$
begin
  if i is not null and not exists(select 1 from public.money_entities where owner_id=u and id=i and kind=k) then
    raise exception 'INVALID_REFERENCE';
  end if;
end $$;
create function private.audit(u uuid, et text, ei text, action_name text, old_value jsonb) returns void language sql set search_path='' as $$
  insert into public.money_audit(owner_id,entity_type,entity_id,action,before_value) values(u,et,ei,action_name,old_value)
$$;

create function private.snapshot(u uuid) returns jsonb language sql stable set search_path='' as $$
select jsonb_build_object(
  'schemaVersion',1,'generation',d.generation,'settings',d.settings,
  'accounts',coalesce((select jsonb_agg(private.entity_json(e) order by e.id) from public.money_entities e where e.owner_id=u and e.kind='account'),'[]'::jsonb),
  'paymentMethods',coalesce((select jsonb_agg(private.entity_json(e) order by e.id) from public.money_entities e where e.owner_id=u and e.kind='paymentMethod'),'[]'::jsonb),
  'categories',coalesce((select jsonb_agg(private.entity_json(e) order by e.id) from public.money_entities e where e.owner_id=u and e.kind='category'),'[]'::jsonb),
  'debts',coalesce((select jsonb_agg(private.entity_json(e) order by e.id) from public.money_entities e where e.owner_id=u and e.kind='debt'),'[]'::jsonb),
  'obligations',coalesce((select jsonb_agg(private.entity_json(e) order by e.id) from public.money_entities e where e.owner_id=u and e.kind='obligation'),'[]'::jsonb),
  'recurrences',coalesce((select jsonb_agg(private.entity_json(e) order by e.id) from public.money_entities e where e.owner_id=u and e.kind='recurrence'),'[]'::jsonb),
  'transactions',coalesce((select jsonb_agg(private.transaction_json(t) order by t.effective_date,t.created_at,t.id) from public.money_transactions t where t.owner_id=u),'[]'::jsonb),
  'allocations',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'transactionId',a.transaction_id,'obligationId',a.obligation_id,'amountMinor',a.amount_minor::text) order by a.id) from public.money_allocations a where a.owner_id=u),'[]'::jsonb),
  'audit',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'entityType',a.entity_type,'entityId',a.entity_id,'action',a.action,'before',a.before_value,'createdAt',a.created_at) order by a.created_at,a.id) from public.money_audit a where a.owner_id=u),'[]'::jsonb),
  'operations',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'requestHash',o.request_hash,'result',o.result) order by o.id) from public.money_operations o where o.owner_id=u),'[]'::jsonb)
) from public.money_datasets d where d.owner_id=u
$$;

create function private.balance(u uuid,a uuid,d date,excluded uuid default null) returns bigint language sql stable set search_path='' as $$
  select coalesce(sum(p.amount_minor),0)::bigint from public.money_postings p
  join public.money_transactions t on t.owner_id=p.owner_id and t.id=p.transaction_id
  where p.owner_id=u and p.account_id=a::text and not t.voided and t.effective_date<=d and (excluded is null or t.id<>excluded)
$$;
create function private.build_postings(u uuid,v jsonb,excluded uuid default null,allow_archived boolean default false,historical boolean default false) returns jsonb language plpgsql set search_path='' as $$
declare k text:=v->>'kind'; a uuid:=(v->>'accountId')::uuid; dest uuid:=(v->>'toAccountId')::uuid;
  cat uuid:=(v->>'categoryId')::uuid; method uuid:=(v->>'paymentMethodId')::uuid; orig_id uuid:=(v->>'originalTransactionId')::uuid;
  obligation uuid:=(v->>'obligationId')::uuid; d date:=private.valid_date(v->>'date'); amount bigint:=private.money(v->'amountMinor');
  principal bigint:=coalesce(private.money(v->'principalMinor',true),0); interest bigint:=coalesce(private.money(v->'interestMinor',true),0); fee bigint:=coalesce(private.money(v->'feeMinor',true),0);
  source public.money_entities; target public.money_entities; original public.money_transactions; bill public.money_entities;
  delta bigint; used numeric; result jsonb;
begin
  perform private.validate_input_shape(v);
  if k is null or k not in ('income','expense','transfer','borrowing','repayment','refund','opening','reconcile','valuation') then raise exception 'INVALID_TRANSACTION_KIND'; end if;
  if d>(now() at time zone 'Asia/Jerusalem')::date then raise exception 'FUTURE_ACTUAL_TRANSACTION'; end if;
  if a is null then raise exception 'ACCOUNT_REQUIRED'; end if;
  perform private.check_ref(u,a,'account'); perform private.check_ref(u,dest,'account'); perform private.check_ref(u,cat,'category'); perform private.check_ref(u,method,'paymentMethod'); perform private.check_ref(u,obligation,'obligation');
  select * into source from public.money_entities where owner_id=u and id=a;
  select * into target from public.money_entities where owner_id=u and id=dest;
  if not allow_archived and ((source.body->>'archived')::boolean or coalesce((target.body->>'archived')::boolean,false)) then raise exception 'ACCOUNT_ARCHIVED'; end if;
  if method is not null and not exists(select 1 from public.money_entities where owner_id=u and id=method and account_id=a) then raise exception 'PAYMENT_METHOD_ACCOUNT_MISMATCH'; end if;
  if k not in ('opening','reconcile','valuation') and amount<=0 then raise exception 'POSITIVE_AMOUNT_REQUIRED'; end if;
  if principal<0 or interest<0 or fee<0 then raise exception 'NEGATIVE_SPLIT'; end if;
  if k<>'repayment' and (v ? 'principalMinor' or v ? 'interestMinor') then raise exception 'UNEXPECTED_REPAYMENT_SPLIT'; end if;
  if k not in ('repayment','transfer') and v ? 'feeMinor' then raise exception 'UNEXPECTED_REPAYMENT_SPLIT'; end if;
  if k not in ('transfer','borrowing','repayment') and dest is not null then raise exception 'UNEXPECTED_DESTINATION'; end if;
  if k<>'refund' and orig_id is not null then raise exception 'UNEXPECTED_REFUND_LINK'; end if;
  if k='refund' and orig_id is null then raise exception 'ORIGINAL_EXPENSE_REQUIRED'; end if;
  if cat is not null and not exists(select 1 from public.money_entities where owner_id=u and id=cat and body->>'kind'=case when k='income' then 'income' else 'expense' end) then raise exception 'CATEGORY_KIND_MISMATCH'; end if;
  if k in ('expense','income','refund') and cat is null then raise exception 'CATEGORY_REQUIRED'; end if;
  if k in ('opening','reconcile','valuation','borrowing') and cat is not null then raise exception 'UNEXPECTED_CATEGORY'; end if;
  if ((k='repayment' and interest+fee>0) or (k='transfer' and fee>0)) and cat is null then raise exception 'CATEGORY_REQUIRED'; end if;
  if length(coalesce(v->>'note',''))>10000 or length(coalesce(v->>'merchant',''))>500 then raise exception 'TEXT_TOO_LONG'; end if;
  if not historical and source.body->>'openingDate' is not null and d<(source.body->>'openingDate')::date and k<>'opening' then raise exception 'BEFORE_OPENING'; end if;
  if not historical and target.body->>'openingDate' is not null and d<(target.body->>'openingDate')::date then raise exception 'BEFORE_OPENING'; end if;
  if k in ('income','expense','refund') then
    if source.body->>'kind' not in ('bank','cash','savings','credit_card') then raise exception 'INVALID_CASH_ACCOUNT'; end if;
    if k='income' and source.body->>'kind'='credit_card' then raise exception 'INVALID_INCOME_ACCOUNT'; end if;
    if k='refund' and not historical then
      select * into original from public.money_transactions where owner_id=u and id=orig_id and not voided;
      if original.id is null or original.input->>'kind'<>'expense' then raise exception 'ORIGINAL_EXPENSE_REQUIRED'; end if;
      if original.account_id<>a then raise exception 'REFUND_ACCOUNT_MISMATCH'; end if;
      if original.category_id is distinct from cat then raise exception 'REFUND_CATEGORY_MISMATCH'; end if;
      if d<original.effective_date then raise exception 'REFUND_BEFORE_EXPENSE'; end if;
      select coalesce(sum(amount_minor),0) into used from public.money_transactions where owner_id=u and original_transaction_id=orig_id and not voided and (excluded is null or id<>excluded);
      if used+amount>original.amount_minor then raise exception 'REFUND_EXCEEDS_EXPENSE'; end if;
    end if;
    delta:=case when k='expense' then -amount else amount end;
    result:=jsonb_build_array(jsonb_build_object('accountId',a,'amountMinor',delta::text),jsonb_build_object('accountId',case when k='income' then '@income' else '@expense' end,'amountMinor',(-delta)::text));
  elsif k in ('transfer','borrowing','repayment') then
    if dest is null or dest=a then raise exception 'DISTINCT_DESTINATION_REQUIRED'; end if;
    if source.body->>'kind' in ('loan','credit_card') then raise exception 'SOURCE_MUST_BE_ASSET'; end if;
    if k='transfer' then
      if target.body->>'kind' in ('loan','credit_card') then raise exception 'USE_REPAYMENT_FOR_LIABILITY'; end if;
      result:=jsonb_build_array(jsonb_build_object('accountId',a,'amountMinor',(-(amount+fee))::text),jsonb_build_object('accountId',dest,'amountMinor',amount::text));
      if fee>0 then result:=result||jsonb_build_array(jsonb_build_object('accountId','@expense','amountMinor',fee::text)); end if;
    else
      if source.body->>'kind' not in ('bank','cash','savings') or target.body->>'kind' not in ('loan','credit_card') then raise exception 'LIABILITY_AND_CASH_REQUIRED'; end if;
      if k='borrowing' then
        result:=jsonb_build_array(jsonb_build_object('accountId',a,'amountMinor',amount::text),jsonb_build_object('accountId',dest,'amountMinor',(-amount)::text));
      else
        if not (v ? 'principalMinor') or principal::numeric+interest+fee<>amount then raise exception 'REPAYMENT_SPLIT_MISMATCH'; end if;
        if not allow_archived and target.body->>'kind'='loan' and (target.body->>'openingKnown')::boolean and principal>greatest(-private.balance(u,dest,d,excluded),0) then raise exception 'LOAN_PRINCIPAL_OVERPAYMENT'; end if;
        result:=jsonb_build_array(jsonb_build_object('accountId',a,'amountMinor',(-amount)::text));
        if principal>0 then result:=result||jsonb_build_array(jsonb_build_object('accountId',dest,'amountMinor',principal::text)); end if;
        if interest+fee>0 then result:=result||jsonb_build_array(jsonb_build_object('accountId','@expense','amountMinor',(interest+fee)::text)); end if;
      end if;
    end if;
  else
    if k='valuation' and source.body->>'kind'<>'asset' then raise exception 'VALUATION_ASSET_REQUIRED'; end if;
    if source.body->>'kind'='asset' and amount<0 then raise exception 'NEGATIVE_ASSET_VALUE'; end if;
    if source.body->>'kind'='loan' and amount>0 then raise exception 'POSITIVE_LOAN_BALANCE'; end if;
    if k='opening' then
      if not historical and exists(select 1 from public.money_transactions where owner_id=u and account_id=a and input->>'kind'='opening' and not voided and (excluded is null or id<>excluded)) then raise exception 'OPENING_ALREADY_EXISTS'; end if;
      if not historical and exists(select 1 from public.money_transactions t join public.money_postings p on p.owner_id=t.owner_id and p.transaction_id=t.id where t.owner_id=u and not t.voided and p.account_id=a::text and t.effective_date<d and (excluded is null or t.id<>excluded)) then raise exception 'OPENING_MUST_PRECEDE_HISTORY'; end if;
      delta:=amount-private.balance(u,a,d,excluded);
    else
      if not historical and not (source.body->>'openingKnown')::boolean then raise exception 'OPENING_REQUIRED'; end if;
      delta:=amount-private.balance(u,a,d,excluded);
    end if;
    result:=jsonb_build_array(jsonb_build_object('accountId',a,'amountMinor',delta::text),jsonb_build_object('accountId','@equity','amountMinor',(-delta)::text));
  end if;
  if obligation is not null and k not in ('expense','repayment') then raise exception 'INVALID_OBLIGATION_PAYMENT'; end if;
  if obligation is not null and not historical then
    select * into bill from public.money_entities where owner_id=u and id=obligation;
    if k not in ('expense','repayment') or (not allow_archived and (bill.body->>'cancelled')::boolean) then raise exception 'INVALID_OBLIGATION_PAYMENT'; end if;
    if bill.account_id is not null and bill.account_id<>a then raise exception 'OBLIGATION_ACCOUNT_MISMATCH'; end if;
    if bill.liability_account_id is not null and (k<>'repayment' or bill.liability_account_id is distinct from dest) then raise exception 'OBLIGATION_LIABILITY_MISMATCH'; end if;
    if bill.liability_account_id is null and k='repayment' then raise exception 'OBLIGATION_LIABILITY_REQUIRED'; end if;
    if k='expense' and bill.category_id is not null and bill.category_id is distinct from cat then raise exception 'OBLIGATION_CATEGORY_MISMATCH'; end if;
    select coalesce(sum(x.amount_minor),0) into used from public.money_allocations x join public.money_transactions t on t.owner_id=x.owner_id and t.id=x.transaction_id where x.owner_id=u and x.obligation_id=obligation and not t.voided and (excluded is null or t.id<>excluded);
    if bill.amount_minor is not null and used+amount>bill.amount_minor then raise exception 'OBLIGATION_OVERPAYMENT'; end if;
  end if;
  return result;
end $$;

create function private.write_transaction(u uuid,i uuid,v jsonb,expected integer,restoring jsonb default null) returns integer language plpgsql set search_path='' as $$
declare old public.money_transactions; old_json jsonb; rev integer; posts jsonb; p jsonb; n integer:=0; ob uuid:=(v->>'obligationId')::uuid;
begin
  if i is null then raise exception 'TRANSACTION_ID_REQUIRED'; end if;
  perform private.validate_input_shape(v);
  select * into old from public.money_transactions where owner_id=u and id=i;
  if old.id is not null then old_json:=private.transaction_json(old); end if;
  if old.id is not null then
    if expected is null or expected<>old.revision then raise exception 'REVISION_CONFLICT'; end if;
    if old.voided then raise exception 'TRANSACTION_VOIDED'; end if;
    if old.input->>'kind'='opening' and (v->>'kind'<>'opening' or v->>'accountId'<>old.input->>'accountId') then raise exception 'OPENING_KIND_IMMUTABLE'; end if;
    rev:=old.revision+1;
  else
    if expected is not null then raise exception 'REVISION_CONFLICT'; end if;
    rev:=1;
  end if;
  if restoring is null then posts:=private.build_postings(u,v,i,false);
  else posts:=restoring->'postings'; rev:=(restoring->>'revision')::integer; end if;
  insert into public.money_transactions(owner_id,id,input,amount_minor,principal_minor,interest_minor,fee_minor,account_id,to_account_id,category_id,payment_method_id,original_transaction_id,obligation_id,effective_date,voided,revision,created_at,updated_at)
  values(u,i,v-array['amountMinor','principalMinor','interestMinor','feeMinor'],private.money(v->'amountMinor'),private.money(v->'principalMinor',true),private.money(v->'interestMinor',true),private.money(v->'feeMinor',true),
    (v->>'accountId')::uuid,(v->>'toAccountId')::uuid,(v->>'categoryId')::uuid,(v->>'paymentMethodId')::uuid,(v->>'originalTransactionId')::uuid,ob,private.valid_date(v->>'date'),
    coalesce((restoring->>'voided')::boolean,false),rev,coalesce((restoring->>'createdAt')::timestamptz,clock_timestamp()),coalesce((restoring->>'updatedAt')::timestamptz,clock_timestamp()))
  on conflict(owner_id,id) do update set input=excluded.input,amount_minor=excluded.amount_minor,principal_minor=excluded.principal_minor,interest_minor=excluded.interest_minor,fee_minor=excluded.fee_minor,
    account_id=excluded.account_id,to_account_id=excluded.to_account_id,category_id=excluded.category_id,payment_method_id=excluded.payment_method_id,original_transaction_id=excluded.original_transaction_id,obligation_id=excluded.obligation_id,effective_date=excluded.effective_date,revision=excluded.revision,updated_at=excluded.updated_at;
  select private.input_json(stored) into v from public.money_transactions stored where stored.owner_id=u and stored.id=i;
  delete from public.money_postings where owner_id=u and transaction_id=i;
  if jsonb_typeof(posts) is distinct from 'array' or jsonb_array_length(posts)<2 or jsonb_array_length(posts)>4 then raise exception 'INVALID_POSTINGS'; end if;
  for p in select value from jsonb_array_elements(posts) loop
    n:=n+1;
    insert into public.money_postings values(u,i,n,p->>'accountId',private.money(p->'amountMinor'));
  end loop;
  delete from public.money_allocations where owner_id=u and transaction_id=i;
  if ob is not null then insert into public.money_allocations values(u,md5(i::text||ob::text)::uuid,i,ob,private.money(v->'amountMinor')); end if;
  if v->>'kind'='opening' and restoring is null then
    update public.money_entities set body=body||jsonb_build_object('openingKnown',true,'openingDate',v->>'date'),revision=revision+1 where owner_id=u and id=(v->>'accountId')::uuid;
  end if;
  if restoring is null then perform private.audit(u,'transaction',i::text,case when old.id is null then 'create' else 'edit' end,old_json); end if;
  if restoring is null then
    perform private.invalidate_card_review(u,v);
    if old.id is not null then perform private.invalidate_card_review(u,private.input_json(old)); end if;
    if v->>'kind' in ('expense','income') then
      update public.money_datasets set settings=settings||jsonb_build_object(
        'lastPaymentMethodId',coalesce(v->'paymentMethodId',settings->'lastPaymentMethodId'),
        'recentCategoryIds',(select coalesce(jsonb_agg(value),'[]'::jsonb) from (select x.value from jsonb_array_elements(jsonb_build_array(v->'categoryId')||(settings->'recentCategoryIds')) with ordinality x(value,n) where x.value<>'null'::jsonb and (x.n=1 or x.value<>v->'categoryId') order by x.n limit 12) q),
        'revision',(settings->>'revision')::integer+1) where owner_id=u;
    end if;
  end if;
  return rev;
end $$;

create function private.invalidate_card_review(u uuid,v jsonb) returns void language plpgsql set search_path='' as $$
begin
  if v->>'kind'='repayment' and v->>'obligationId' is not null then return; end if;
  if exists(select 1 from public.money_entities where owner_id=u and kind='account' and body->>'kind'='credit_card' and id in ((v->>'accountId')::uuid,(v->>'toAccountId')::uuid)) then
    update public.money_datasets set settings=settings||jsonb_build_object('obligationsReviewed',false,'revision',(settings->>'revision')::integer+1)
      where owner_id=u and (settings->>'obligationsReviewed')::boolean;
  end if;
end $$;

create function private.validate_input_shape(v jsonb) returns void language plpgsql immutable set search_path='' as $$
declare field_name text; begin
  if jsonb_typeof(v) is distinct from 'object' or not (v ?& array['kind','date','amountMinor','accountId']) or
    v-array['kind','date','amountMinor','accountId','toAccountId','categoryId','paymentMethodId','principalMinor','interestMinor','feeMinor','originalTransactionId','obligationId','merchant','note']<>'{}'::jsonb then raise exception 'INVALID_TRANSACTION_FIELDS'; end if;
  for field_name in select jsonb_object_keys(v) loop
    if jsonb_typeof(v->field_name) is distinct from 'string' then raise exception 'INVALID_TRANSACTION_FIELD_TYPE'; end if;
  end loop;
end $$;

create function private.validate_state(u uuid) returns void language plpgsql set search_path='' as $$
declare t public.money_transactions; e public.money_entities; p record; expected jsonb; actual jsonb; delta bigint; k text; total numeric; opening_count integer; opening_date text;
begin
  for t in select * from public.money_transactions where owner_id=u loop
    k:=t.input->>'kind';
    perform private.check_ref(u,t.account_id,'account'); perform private.check_ref(u,t.to_account_id,'account');
    perform private.check_ref(u,t.category_id,'category'); perform private.check_ref(u,t.payment_method_id,'paymentMethod'); perform private.check_ref(u,t.obligation_id,'obligation');
    if t.effective_date>(now() at time zone 'Asia/Jerusalem')::date then raise exception 'FUTURE_ACTUAL_TRANSACTION'; end if;
    perform private.build_postings(u,private.input_json(t),t.id,true,t.voided);
    if k not in ('income','expense','transfer','borrowing','repayment','refund','opening','reconcile','valuation') or k is null then raise exception 'INVALID_TRANSACTION_KIND'; end if;
    if k not in ('opening','reconcile','valuation') and t.amount_minor<=0 then raise exception 'POSITIVE_AMOUNT_REQUIRED'; end if;
    if k='repayment' then
      if t.principal_minor is null or t.principal_minor<0 or coalesce(t.interest_minor,0)<0 or coalesce(t.fee_minor,0)<0 or t.principal_minor::numeric+coalesce(t.interest_minor,0)+coalesce(t.fee_minor,0)<>t.amount_minor then raise exception 'REPAYMENT_SPLIT_MISMATCH'; end if;
    elsif t.principal_minor is not null or t.interest_minor is not null or (k<>'transfer' and t.fee_minor is not null) then raise exception 'UNEXPECTED_REPAYMENT_SPLIT'; end if;
    select count(*),sum(amount_minor) into opening_count,total from public.money_postings where owner_id=u and transaction_id=t.id;
    if opening_count<2 or total<>0 then raise exception 'UNBALANCED_LEDGER'; end if;
    for p in select account_id from public.money_postings where owner_id=u and transaction_id=t.id loop
      if p.account_id not in ('@expense','@income','@equity') then perform private.check_ref(u,p.account_id::uuid,'account'); end if;
    end loop;
    select jsonb_agg(jsonb_build_object('accountId',account_id,'amountMinor',amount_minor::text) order by account_id) into actual from public.money_postings where owner_id=u and transaction_id=t.id;
    if k in ('opening','reconcile','valuation') then
      select amount_minor into delta from public.money_postings where owner_id=u and transaction_id=t.id and account_id=t.account_id::text;
      if delta is null then raise exception 'INVALID_ADJUSTMENT_POSTINGS'; end if;
      expected:=jsonb_build_array(jsonb_build_object('accountId',t.account_id,'amountMinor',delta::text),jsonb_build_object('accountId','@equity','amountMinor',(-delta)::text));
    elsif k in ('expense','income','refund') then
      delta:=case when k='expense' then -t.amount_minor else t.amount_minor end;
      expected:=jsonb_build_array(jsonb_build_object('accountId',t.account_id,'amountMinor',delta::text),jsonb_build_object('accountId',case when k='income' then '@income' else '@expense' end,'amountMinor',(-delta)::text));
    elsif k in ('transfer','borrowing') then
      delta:=case when k='transfer' then -(t.amount_minor+coalesce(t.fee_minor,0)) else t.amount_minor end;
      expected:=jsonb_build_array(jsonb_build_object('accountId',t.account_id,'amountMinor',delta::text),jsonb_build_object('accountId',t.to_account_id,'amountMinor',(case when k='transfer' then t.amount_minor else -t.amount_minor end)::text));
      if k='transfer' and coalesce(t.fee_minor,0)>0 then expected:=expected||jsonb_build_array(jsonb_build_object('accountId','@expense','amountMinor',t.fee_minor::text)); end if;
    else
      expected:=jsonb_build_array(jsonb_build_object('accountId',t.account_id,'amountMinor',(-t.amount_minor)::text));
      if t.principal_minor>0 then expected:=expected||jsonb_build_array(jsonb_build_object('accountId',t.to_account_id,'amountMinor',t.principal_minor::text)); end if;
      delta:=coalesce(t.interest_minor,0)+coalesce(t.fee_minor,0);
      if delta>0 then expected:=expected||jsonb_build_array(jsonb_build_object('accountId','@expense','amountMinor',delta::text)); end if;
    end if;
    select jsonb_agg(value order by value->>'accountId') into expected from jsonb_array_elements(expected);
    if actual is distinct from expected then raise exception 'POSTING_SEMANTICS_MISMATCH'; end if;
    if t.obligation_id is not null and not t.voided then
      if not exists(select 1 from public.money_allocations where owner_id=u and transaction_id=t.id and obligation_id=t.obligation_id and amount_minor=t.amount_minor) then raise exception 'PAYMENT_ALLOCATION_MISSING'; end if;
    elsif exists(select 1 from public.money_allocations where owner_id=u and transaction_id=t.id) then raise exception 'UNEXPECTED_ALLOCATION'; end if;
  end loop;
  for e in select * from public.money_entities where owner_id=u and kind='account' loop
    select count(*),min(effective_date)::text into opening_count,opening_date from public.money_transactions where owner_id=u and account_id=e.id and input->>'kind'='opening' and not voided;
    if opening_count>1 or (e.body->>'openingKnown')::boolean<>(opening_count=1) or (opening_count=1 and e.body->>'openingDate' is distinct from opening_date) or (opening_count=0 and e.body->>'openingDate' is not null) then raise exception 'OPENING_STATE_MISMATCH'; end if;
    if e.body->>'kind'='loan' and (e.body->>'openingKnown')::boolean then
      if exists(select 1 from (select tx.effective_date,sum(sum(mp.amount_minor)) over(order by tx.effective_date) b from public.money_postings mp join public.money_transactions tx on tx.owner_id=mp.owner_id and tx.id=mp.transaction_id where mp.owner_id=u and mp.account_id=e.id::text and not tx.voided group by tx.effective_date) q where b>0) then raise exception 'LOAN_PRINCIPAL_OVERPAYMENT'; end if;
    end if;
    if e.body->>'kind'='asset' and (e.body->>'openingKnown')::boolean then
      if exists(select 1 from (select tx.effective_date,sum(sum(mp.amount_minor)) over(order by tx.effective_date) b from public.money_postings mp join public.money_transactions tx on tx.owner_id=mp.owner_id and tx.id=mp.transaction_id where mp.owner_id=u and mp.account_id=e.id::text and not tx.voided group by tx.effective_date) q where b<0) then raise exception 'NEGATIVE_ASSET_BALANCE'; end if;
    end if;
  end loop;
  if exists(select 1 from (select sum(sum(mp.amount_minor)) over(partition by mp.account_id order by tx.effective_date) b from public.money_postings mp join public.money_transactions tx on tx.owner_id=mp.owner_id and tx.id=mp.transaction_id where mp.owner_id=u and not tx.voided group by mp.account_id,tx.effective_date) q where b>9223372036854775807::numeric or b<(-9223372036854775808)::numeric) then raise exception 'BALANCE_OUT_OF_RANGE'; end if;
end $$;

create function private.generate_occurrences(u uuid,changed_rule_id uuid default null) returns void language plpgsql set search_path='' as $$
declare r public.money_entities; m date; due date; today date:=(now() at time zone 'Asia/Jerusalem')::date; start_d date; end_d date; oid uuid; old public.money_entities; b jsonb;
begin
  for r in select * from public.money_entities where owner_id=u and kind='recurrence' loop
    start_d:=(r.body->>'startDate')::date; end_d:=(r.body->>'endDate')::date;
    -- Only an explicit rule edit changes existing future unpaid occurrences.
    -- Ordinary reads preserve per-occurrence amounts, dates and other manual edits.
    for old in select e.* from public.money_entities e where e.owner_id=u and e.kind='obligation' and e.recurrence_id=r.id and r.id=changed_rule_id and (e.body->>'dueDate')::date>=today
      and not exists(select 1 from public.money_allocations a where a.owner_id=u and a.obligation_id=e.id) loop
      due:=(old.body->>'dueDate')::date;
      if not (r.body->>'active')::boolean or due<start_d or (end_d is not null and due>end_d) or due<>(date_trunc('month',due)::date+least((r.body->>'day')::integer,extract(day from (date_trunc('month',due)+interval '1 month -1 day'))::integer)-1) then
        if not (old.body->>'cancelled')::boolean then
          perform private.audit(u,'obligation',old.id::text,'rule_cancel',private.entity_json(old));
          update public.money_entities set body=body||'{"cancelled":true}'::jsonb,revision=revision+1,rule_cancelled=true where owner_id=u and id=old.id;
        end if;
      end if;
    end loop;
    if not (r.body->>'active')::boolean then continue; end if;
    m:=date_trunc('month',start_d)::date;
    while m<=date_trunc('month',today)::date loop
      due:=m+(least((r.body->>'day')::integer,extract(day from (m+interval '1 month -1 day'))::integer)-1);
      if due>=start_d and (end_d is null or due<=end_d) then
        oid:=md5(r.id::text||due::text)::uuid;
        b:=jsonb_build_object('title',r.body->>'title','dueDate',due,'accountId',r.account_id,'liabilityAccountId',r.liability_account_id,'categoryId',r.category_id,'recurrenceId',r.id,'cancelled',false);
        select * into old from public.money_entities where owner_id=u and id=oid;
        if old.id is null and not exists(select 1 from public.money_entities existing where existing.owner_id=u and existing.kind='obligation' and existing.recurrence_id=r.id and date_trunc('month',(existing.body->>'dueDate')::date)=date_trunc('month',due) and (changed_rule_id is distinct from r.id or due<today or (existing.body->>'dueDate')::date<today or ((existing.body->>'cancelled')::boolean and not existing.rule_cancelled) or exists(select 1 from public.money_allocations pa where pa.owner_id=u and pa.obligation_id=existing.id))) then
          insert into public.money_entities(owner_id,id,kind,body,amount_minor,account_id,liability_account_id,category_id,recurrence_id,revision)
          values(u,oid,'obligation',b,r.amount_minor,r.account_id,r.liability_account_id,r.category_id,r.id,1);
        elsif old.id is not null and r.id=changed_rule_id and due>=today and (old.body->>'dueDate')::date>=today and (not (old.body->>'cancelled')::boolean or old.rule_cancelled)
          and not exists(select 1 from public.money_entities skipped where skipped.owner_id=u and skipped.kind='obligation' and skipped.recurrence_id=r.id and skipped.id<>oid and (skipped.body->>'cancelled')::boolean and not skipped.rule_cancelled and date_trunc('month',(skipped.body->>'dueDate')::date)=date_trunc('month',due))
          and not exists(select 1 from public.money_allocations where owner_id=u and obligation_id=oid) and (old.body<>b or old.amount_minor is distinct from r.amount_minor) then
          perform private.audit(u,'obligation',oid::text,'rule_update',private.entity_json(old));
          update public.money_entities set body=b,amount_minor=r.amount_minor,account_id=r.account_id,liability_account_id=r.liability_account_id,category_id=r.category_id,revision=revision+1,rule_cancelled=false where owner_id=u and id=oid;
        end if;
      end if;
      m:=(m+interval '1 month')::date;
    end loop;
  end loop;
end $$;

create function private.settings(u uuid,v jsonb,expected integer,restoring boolean default false) returns integer language plpgsql set search_path='' as $$
declare old jsonb; merged jsonb; rev integer; f text; id_text text;
begin
  select settings into old from public.money_datasets where owner_id=u;
  if jsonb_typeof(v) is distinct from 'object' or v-array['currency','timezone','trackingStart','accountsReviewed','debtsReviewed','obligationsReviewed','assetsReviewed','lastPaymentMethodId','recentCategoryIds','revision']<>'{}'::jsonb then raise exception 'INVALID_SETTINGS_FIELDS'; end if;
  if not restoring and (expected is null or expected<>(old->>'revision')::integer) then raise exception 'REVISION_CONFLICT'; end if;
  if v ? 'revision' and not restoring and (v->>'revision')::integer<>(old->>'revision')::integer then raise exception 'REVISION_CONFLICT'; end if;
  merged:=case when restoring then v else old||v end;
  if not (merged ?& array['currency','timezone','trackingStart','accountsReviewed','debtsReviewed','obligationsReviewed','assetsReviewed','lastPaymentMethodId','recentCategoryIds','revision']) then raise exception 'INCOMPLETE_SETTINGS'; end if;
  if merged->>'currency' is distinct from 'ILS' or merged->>'timezone' is distinct from 'Asia/Jerusalem' then raise exception 'UNSUPPORTED_LOCALE'; end if;
  perform private.valid_date(merged->>'trackingStart');
  foreach f in array array['accountsReviewed','debtsReviewed','obligationsReviewed','assetsReviewed'] loop
    if jsonb_typeof(merged->f) is distinct from 'boolean' then raise exception 'INVALID_REVIEW_FLAGS'; end if;
  end loop;
  if private.valid_date(merged->>'trackingStart')>(now() at time zone 'Asia/Jerusalem')::date then raise exception 'FUTURE_TRACKING_START'; end if;
  if jsonb_typeof(merged->'recentCategoryIds') is distinct from 'array' or jsonb_array_length(merged->'recentCategoryIds')>50 then raise exception 'INVALID_RECENT_CATEGORIES'; end if;
  merged:=merged||jsonb_build_object('lastPaymentMethodId',(merged->>'lastPaymentMethodId')::uuid,'recentCategoryIds',(select coalesce(jsonb_agg((value#>>'{}')::uuid),'[]'::jsonb) from jsonb_array_elements(merged->'recentCategoryIds')));
  if (select count(distinct value) from jsonb_array_elements(merged->'recentCategoryIds'))<>jsonb_array_length(merged->'recentCategoryIds') then raise exception 'INVALID_RECENT_CATEGORIES'; end if;
  for id_text in select jsonb_array_elements_text(merged->'recentCategoryIds') loop perform private.check_ref(u,id_text::uuid,'category'); end loop;
  perform private.check_ref(u,(merged->>'lastPaymentMethodId')::uuid,'paymentMethod');
  rev:=case when restoring then (v->>'revision')::integer else (old->>'revision')::integer+1 end;
  if rev is null or rev<1 then raise exception 'INVALID_REVISION'; end if;
  merged:=merged||jsonb_build_object('revision',rev);
  update public.money_datasets set settings=merged where owner_id=u;
  if not restoring then perform private.audit(u,'settings',u::text,'edit',old); end if;
  return rev;
end $$;

create function private.restore_dataset(u uuid,b jsonb) returns void language plpgsql set search_path='' as $$
declare d jsonb:=b->'data'; key_name text; kind_name text; x jsonb; row_index integer; old_generation uuid; fresh_generation uuid:=gen_random_uuid();
begin
  if b->>'format' is distinct from 'lova-money-os' or b->>'schemaVersion' is distinct from '1' or d->>'schemaVersion' is distinct from '1' or jsonb_typeof(d)<>'object' then raise exception 'UNSUPPORTED_BACKUP'; end if;
  perform (b->>'exportedAt')::timestamptz;
  perform (d->>'generation')::uuid;
  if b->>'exportedAt' is null or d->>'generation' is null then raise exception 'INVALID_BACKUP'; end if;
  foreach key_name in array array['accounts','paymentMethods','categories','debts','obligations','recurrences','transactions','allocations','audit','operations'] loop
    if jsonb_typeof(d->key_name) is distinct from 'array' then raise exception 'INCOMPLETE_BACKUP'; end if;
  end loop;
  select generation into old_generation from public.money_datasets where owner_id=u;
  delete from public.money_allocations where owner_id=u;
  delete from public.money_postings where owner_id=u;
  delete from public.money_transactions where owner_id=u;
  delete from public.money_entities where owner_id=u;
  -- The backup's audit trail is retained; the pre-restore trail remains available too.
  for row_index in 1..6 loop
    key_name:=(array['accounts','categories','paymentMethods','debts','recurrences','obligations'])[row_index];
    kind_name:=(array['account','category','paymentMethod','debt','recurrence','obligation'])[row_index];
    for x in select value from jsonb_array_elements(d->key_name) loop
      if exists(select 1 from public.money_entities where owner_id=u and id=(x->>'id')::uuid) then raise exception 'DUPLICATE_BACKUP_ID'; end if;
      perform private.save_entity(u,kind_name,x,null,true);
    end loop;
  end loop;
  perform private.settings(u,d->'settings',null,true);
  -- Reconstruct internal cancellation provenance only from the restored branch's audit.
  -- A later event retained from the pre-restore timeline must not change restored behavior.
  update public.money_entities e set rule_cancelled=true where e.owner_id=u and e.kind='obligation' and (e.body->>'cancelled')::boolean and
    (select event->>'action' from jsonb_array_elements(d->'audit') event where event->>'entityType'='obligation' and (event->>'entityId')=e.id::text order by (event->>'createdAt')::timestamptz desc,event->>'id' desc limit 1) in ('rule_cancel','restore_rule_cancel');
  for x in select value from jsonb_array_elements(d->'transactions') loop
    if exists(select 1 from public.money_transactions where owner_id=u and id=(x->>'id')::uuid) then raise exception 'DUPLICATE_BACKUP_ID'; end if;
    if jsonb_typeof(x->'voided') is distinct from 'boolean' or x->>'createdAt' is null or x->>'updatedAt' is null then raise exception 'INVALID_BACKUP_TRANSACTION'; end if;
    perform private.write_transaction(u,(x->>'id')::uuid,x->'input',null,x);
  end loop;
  delete from public.money_allocations where owner_id=u;
  for x in select value from jsonb_array_elements(d->'allocations') loop
    insert into public.money_allocations values(u,(x->>'id')::uuid,(x->>'transactionId')::uuid,(x->>'obligationId')::uuid,private.money(x->'amountMinor'));
  end loop;
  for x in select value from jsonb_array_elements(d->'audit') loop
    insert into public.money_audit(owner_id,id,entity_type,entity_id,action,before_value,created_at)
    values(u,(x->>'id')::uuid,x->>'entityType',x->>'entityId',x->>'action',x->'before',(x->>'createdAt')::timestamptz)
    on conflict(owner_id,id) do nothing;
  end loop;
  -- These audit markers carry the restored cancellation provenance into future full exports,
  -- even though old audit events from the replaced timeline are deliberately retained.
  insert into public.money_audit(owner_id,entity_type,entity_id,action,before_value)
    select u,'obligation',e.id::text,case when e.rule_cancelled then 'restore_rule_cancel' else 'restore_manual_cancel' end,null
    from public.money_entities e where e.owner_id=u and e.kind='obligation' and (e.body->>'cancelled')::boolean;
  -- Preserve receipts from both timelines: operation IDs never become reusable after restore.
  for x in select value from jsonb_array_elements(d->'operations') loop
    if exists(select 1 from public.money_operations where owner_id=u and id=(x->>'id')::uuid and (request_hash is distinct from x->>'requestHash' or result is distinct from x->'result')) then raise exception 'OPERATION_RECEIPT_CONFLICT'; end if;
    insert into public.money_operations values(u,(x->>'id')::uuid,x->>'requestHash',x->'result') on conflict(owner_id,id) do nothing;
  end loop;
  perform private.validate_state(u);
  update public.money_datasets set generation=fresh_generation where owner_id=u;
  perform private.audit(u,'dataset',u::text,'restore',jsonb_build_object('generation',old_generation,'restoredFrom',d->>'generation'));
end $$;

create function private.execute_command_impl(p_command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_owner(); op uuid:=(p_command->>'operationId')::uuid; generation_id uuid:=(p_command->>'generation')::uuid;
  request_hash_value text:=encode(sha256(convert_to(p_command::text,'UTF8')),'hex'); receipt public.money_operations; action_name text:=p_command->>'type';
  rev integer; entity_id uuid; current_generation uuid; result jsonb; t public.money_transactions; old_json jsonb; want_void boolean;
begin
  if op is null or generation_id is null then raise exception 'COMMAND_ID_REQUIRED'; end if;
  perform private.ensure_dataset(u);
  -- One owner's small dataset has one lock. It serializes idempotency, balances and revisions.
  select generation into current_generation from public.money_datasets where owner_id=u for update;
  select * into receipt from public.money_operations where owner_id=u and id=op;
  if receipt.id is not null then
    if receipt.request_hash<>request_hash_value then raise exception 'OPERATION_ID_REUSED'; end if;
    return receipt.result;
  end if;
  if generation_id<>current_generation then raise exception 'DATASET_CHANGED'; end if;
  if action_name='save_entity' then
    entity_id:=(p_command->'value'->>'id')::uuid;
    rev:=private.save_entity(u,p_command->>'entity',p_command->'value',(p_command->>'expectedRevision')::integer);
    if p_command->>'entity'='recurrence' then perform private.generate_occurrences(u,entity_id); end if;
  elsif action_name='save_settings' then
    rev:=private.settings(u,p_command->'value',(p_command->>'expectedRevision')::integer);
  elsif action_name in ('record','edit') then
    entity_id:=(p_command->>'id')::uuid;
    if action_name='record' and exists(select 1 from public.money_transactions where owner_id=u and id=entity_id) then raise exception 'TRANSACTION_ALREADY_EXISTS'; end if;
    if action_name='edit' and not exists(select 1 from public.money_transactions where owner_id=u and id=entity_id) then raise exception 'TRANSACTION_NOT_FOUND'; end if;
    rev:=private.write_transaction(u,entity_id,p_command->'input',case when action_name='edit' then (p_command->>'expectedRevision')::integer end);
  elsif action_name in ('void','unvoid') then
    entity_id:=(p_command->>'id')::uuid;
    select * into t from public.money_transactions where owner_id=u and id=entity_id;
    if t.id is null then raise exception 'TRANSACTION_NOT_FOUND'; end if;
    if p_command->>'expectedRevision' is null or t.revision<>(p_command->>'expectedRevision')::integer then raise exception 'REVISION_CONFLICT'; end if;
    want_void:=action_name='void';
    if t.voided=want_void then raise exception 'TRANSACTION_STATE_CONFLICT'; end if;
    old_json:=private.transaction_json(t);
    if want_void and t.input->>'kind'='opening' and exists(select 1 from public.money_transactions other join public.money_postings p on p.owner_id=other.owner_id and p.transaction_id=other.id where other.owner_id=u and other.id<>t.id and not other.voided and p.account_id=t.account_id::text) then raise exception 'OPENING_IN_USE'; end if;
    if not want_void then perform private.build_postings(u,private.input_json(t),t.id,false); end if;
    update public.money_transactions set voided=want_void,revision=revision+1,updated_at=clock_timestamp() where owner_id=u and id=t.id returning revision into rev;
    delete from public.money_allocations where owner_id=u and transaction_id=t.id;
    if not want_void and t.obligation_id is not null then insert into public.money_allocations values(u,md5(t.id::text||t.obligation_id::text)::uuid,t.id,t.obligation_id,t.amount_minor); end if;
    if t.input->>'kind'='opening' then update public.money_entities set body=body||jsonb_build_object('openingKnown',not want_void,'openingDate',case when want_void then null else t.effective_date::text end),revision=revision+1 where owner_id=u and id=t.account_id; end if;
    perform private.audit(u,'transaction',t.id::text,action_name,old_json);
    perform private.invalidate_card_review(u,private.input_json(t));
  elsif action_name='restore' then
    -- Compare the live dataset with the safety export while holding the same owner
    -- lock as all writes. A generation alone does not detect another device's edits.
    -- Receipts above deliberately precede this guard so uncertain retries stay safe.
    if coalesce(p_command->>'expectedSnapshotToken','') !~ '^[0-9a-f]{64}$'
      or p_command->>'expectedSnapshotToken'<>encode(sha256(convert_to(private.snapshot(u)::text,'UTF8')),'hex')
    then raise exception 'RESTORE_SNAPSHOT_CHANGED'; end if;
    perform private.restore_dataset(u,p_command->'backup');
  else raise exception 'UNKNOWN_COMMAND'; end if;
  perform private.validate_state(u);
  select generation into current_generation from public.money_datasets where owner_id=u;
  result:=jsonb_build_object('entityId',entity_id,'revision',rev,'generation',current_generation);
  insert into public.money_operations values(u,op,request_hash_value,result);
  return result;
end $$;

create function private.ensure_dataset(u uuid) returns void language plpgsql set search_path='' as $$
declare inserted uuid; v jsonb; begin
  insert into public.money_datasets(owner_id) values(u) on conflict do nothing returning owner_id into inserted;
  if inserted is not null then
    for v in select value from jsonb_array_elements('[
      {"id":"10000000-0000-4000-8000-000000000001","name":"אוכל","kind":"expense","pinned":true,"icon":"utensils"},
      {"id":"10000000-0000-4000-8000-000000000002","name":"סופרמרקט","kind":"expense","pinned":true,"icon":"shopping-bag"},
      {"id":"10000000-0000-4000-8000-000000000003","name":"תחבורה","kind":"expense","pinned":true,"icon":"car"},
      {"id":"10000000-0000-4000-8000-000000000004","name":"קניות","kind":"expense","pinned":true,"icon":"shopping-bag"},
      {"id":"10000000-0000-4000-8000-000000000005","name":"בית וחשבונות","kind":"expense","pinned":true,"icon":"house"},
      {"id":"10000000-0000-4000-8000-000000000006","name":"אחר","kind":"expense","pinned":true,"icon":"more-horizontal"},
      {"id":"10000000-0000-4000-8000-000000000007","name":"בריאות","kind":"expense","pinned":false,"icon":"heart"},
      {"id":"10000000-0000-4000-8000-000000000008","name":"ריבית ועמלות","kind":"expense","pinned":false,"icon":"wallet"},
      {"id":"10000000-0000-4000-8000-000000000009","name":"משכורת","kind":"income","pinned":true,"icon":"wallet"},
      {"id":"10000000-0000-4000-8000-000000000010","name":"הכנסה אחרת","kind":"income","pinned":true,"icon":"wallet"}
    ]'::jsonb) loop
      insert into public.money_entities(owner_id,id,kind,body,revision) values(u,(v->>'id')::uuid,'category',v-'id',1);
    end loop;
  end if;
end $$;
create function private.get_dataset_impl() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.require_owner(); snapshot_value jsonb; begin
  perform private.ensure_dataset(u);
  perform 1 from public.money_datasets where owner_id=u for update;
  perform private.generate_occurrences(u);
  snapshot_value:=private.snapshot(u);
  return snapshot_value||jsonb_build_object('snapshotToken',encode(sha256(convert_to(snapshot_value::text,'UTF8')),'hex'));
end $$;
-- Only these two wrappers are exposed through PostgREST. Private helpers cannot be reached there.
create function public.get_dataset() returns jsonb language sql security invoker set search_path='' as $$ select private.get_dataset_impl() $$;
create function public.execute_command(p_command jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.execute_command_impl(p_command) $$;
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.is_owner(),private.get_dataset_impl(),private.execute_command_impl(jsonb) to authenticated;
revoke all on function public.get_dataset(),public.execute_command(jsonb) from public,anon;
grant execute on function public.get_dataset(),public.execute_command(jsonb) to authenticated;
-- Do not expose the private schema in Supabase API settings.
