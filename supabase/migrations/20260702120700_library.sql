-- Migration: library
-- PRD-001b task 3.2 — Resource Library domain (EL-OS §6 + tenant_id + RLS).
--   library_chunks carries vector(1024) + a generated tsvector for hybrid
--   retrieval (dense HNSW + sparse BM25/GIN, RRF-combined). library_items gains a
--   `source` provenance enum (upload|vimeo|granola|fathom). Corpus is tenant-scoped
--   but shared across the tenant's members (tenant fence only). library_progress
--   is member-owned (two-layer fence).

-- ===========================================================================
-- library_courses — course-level grouping (an ordered set of items).
-- ===========================================================================
create table library_courses (
  id                  uuid        primary key default gen_random_uuid(),
  tenant_id           uuid        not null references tenants (id) on delete cascade,
  title               text        not null,
  description         text        not null default '',
  cover_image_url     text,
  created_by_admin_id uuid        references admins (id) on delete set null,
  published           boolean     not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index library_courses_tenant_published_idx on library_courses (tenant_id, published);

create trigger library_courses_set_updated_at
  before update on library_courses
  for each row execute function public.set_updated_at();

select public.enable_tenant_rls('public', 'library_courses');
select public.grant_app_access('public', 'library_courses');

-- ===========================================================================
-- library_items — the library's atomic unit (one row per asset).
-- ===========================================================================
create table library_items (
  id                  uuid                  primary key default gen_random_uuid(),
  tenant_id           uuid                  not null references tenants (id) on delete cascade,
  kind                library_item_kind     not null,
  source              library_source        not null default 'upload',   -- provenance (FR-4)
  course_id           uuid                  references library_courses (id) on delete set null,
  course_position     integer,
  title               text                  not null,
  description         text                  not null default '',
  tags                text[]                not null default '{}',
  duration_seconds    integer,
  storage_kind        library_storage_kind  not null,
  storage_id          text                  not null,
  transcript          text,
  version             integer               not null default 1,
  ingest_status       library_ingest_status not null default 'pending',
  published           boolean               not null default false,
  created_by_admin_id uuid                  references admins (id) on delete set null,
  created_at          timestamptz           not null default now(),
  updated_at          timestamptz           not null default now()
);

create index library_items_tenant_kind_published_idx on library_items (tenant_id, kind, published);
create index library_items_tenant_ingest_idx         on library_items (tenant_id, ingest_status);
create index library_items_course_position_idx       on library_items (course_id, course_position);

create trigger library_items_set_updated_at
  before update on library_items
  for each row execute function public.set_updated_at();

select public.enable_tenant_rls('public', 'library_items');
select public.grant_app_access('public', 'library_items');

-- ===========================================================================
-- library_chunks — chunked text + 1024-dim embeddings for hybrid retrieval.
--   text_search generated tsvector (BM25 leg) + GIN; embedding HNSW (dense leg).
-- ===========================================================================
create table library_chunks (
  id              uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        not null references tenants (id) on delete cascade,
  library_item_id uuid        not null references library_items (id) on delete cascade,
  chunk_index     integer     not null,
  text            text        not null,
  start_seconds   integer,
  page_number     integer,
  embedding       vector(1024),
  text_search     tsvector    generated always as (to_tsvector('english', text)) stored,
  created_at      timestamptz not null default now()
);

-- Dense (HNSW) + sparse (GIN) legs + tenant/item hot-predicate composites.
create index library_chunks_embedding_hnsw
  on library_chunks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
create index library_chunks_text_search_gin
  on library_chunks using gin (text_search);
create index library_chunks_tenant_item_idx on library_chunks (tenant_id, library_item_id, chunk_index);

select public.enable_tenant_rls('public', 'library_chunks');
select public.grant_app_access('public', 'library_chunks');

-- ===========================================================================
-- library_progress — per-member resume position per item (member-owned).
-- ===========================================================================
create table library_progress (
  member_id       uuid        not null references members (id) on delete cascade,
  tenant_id       uuid        not null references tenants (id) on delete cascade,
  library_item_id uuid        not null references library_items (id) on delete cascade,
  resume_seconds  integer     not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (member_id, library_item_id)
);

create index library_progress_tenant_item_idx on library_progress (tenant_id, library_item_id);

create trigger library_progress_set_updated_at
  before update on library_progress
  for each row execute function public.set_updated_at();

select public.enable_tenant_rls('public', 'library_progress');
select public.enable_member_rls('public', 'library_progress', 'member_id');
select public.grant_app_access('public', 'library_progress');
