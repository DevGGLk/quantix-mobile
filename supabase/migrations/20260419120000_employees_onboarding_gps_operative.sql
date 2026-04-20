-- Inducción y consentimiento GPS a nivel expediente (employees), no solo perfil.
alter table public.employees
  add column if not exists onboarding_completed boolean not null default false;

alter table public.employees
  add column if not exists is_gps_tracking_enabled boolean null default false;

alter table public.employees
  add column if not exists requires_live_tracking boolean null default false;

alter table public.employees
  add column if not exists gps_refresh_rate_seconds integer null;

comment on column public.employees.onboarding_completed is 'Inducción operativa completada (app / portal).';
comment on column public.employees.is_gps_tracking_enabled is 'Consentimiento de telemetría GPS operativa.';
comment on column public.employees.requires_live_tracking is 'Política de empresa: exige rastreo en vivo cuando aplica.';
comment on column public.employees.gps_refresh_rate_seconds is 'Intervalo sugerido entre pings GPS (segundos).';
