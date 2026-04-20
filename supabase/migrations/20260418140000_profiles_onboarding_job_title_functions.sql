-- Mobile onboarding + Mis funciones (job title)
-- Ejecutar en Supabase SQL Editor o vía CLI: supabase db push

alter table public.profiles
  add column if not exists onboarding_completed boolean not null default false;

comment on column public.profiles.onboarding_completed is
  'Inducción corporativa completada en app móvil / portal.';

alter table public.job_titles
  add column if not exists functions_description text;

comment on column public.job_titles.functions_description is
  'Descripción de funciones del puesto (pantalla Mis funciones, app móvil).';
