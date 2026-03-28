# Checklist: modelo expediente (`employees.id`)

El cliente móvil asume que las operaciones de **empleado** usan la fila `public.employees` (expediente), no `profiles.id` (cuenta de usuario). Si tu base aún tiene FK a `profiles` o columnas `profile_id` donde el móvil envía `employee_id`, PostgREST fallará o insertará datos incoherentes.

Ejecutar en **staging** primero. Ajustar nombres de constraints si difieren.

## 1. `time_entries`

- [ ] Añadir `employee_id uuid REFERENCES public.employees(id)` (nullable al migrar, luego NOT NULL si aplica).
- [ ] Backfill: `UPDATE time_entries te SET employee_id = e.id FROM employees e WHERE e.user_id = te.profile_id`.
- [ ] Tras validar, opcional: quitar `profile_id` o dejarlo solo auditoría.

## 2. `employee_requests`

- [ ] Renombrar o añadir columna `employee_id` → `employees(id)` (coherente con el móvil).
- [ ] Backfill desde `profile_id` vía `employees.user_id = profile_id`.
- [ ] Actualizar RLS y políticas que usen `profile_id`.

## 3. `employee_shifts`

- [ ] Misma idea: `employee_id` → `employees(id)`, backfill desde `profile_id` si existía.

## 4. `payroll_slips`

- [ ] `employee_id` → `employees(id)` si hoy es `profile_id`.

## 5. `checklist_submissions`

- [ ] `employee_id` debe referenciar `employees(id)`, no `profiles(id)`.
- [ ] Backfill con join `employees.user_id` o tabla puente según histórico.

## 6. `extra_hours_records`

- [ ] Columna operativa `employee_id` → `employees(id)`; alinear con payload móvil (`hours_reported`, `notes`).

## 7. `gamification_balances` / `gamification_transactions`

- [ ] `employee_id` PK/FK → `employees(id)`.
- [ ] Migrar filas existentes si apuntaban a `profiles.id`.

## 8. `employee_badges`

- [ ] Si el móvil lee por expediente: `employee_id` → `employees(id)` o vista que unifique.

## 9. Embeds en Admin (móvil)

Las consultas usan `employees!inner(branch_id)` sobre:

- `time_entries`, `employee_requests`, `checklist_submissions`, `extra_hours_records`

- [ ] Confirmar en Supabase **Database → Schema** que existe FK desde cada tabla hacia `employees` para que PostgREST exponga el embed `employees`.

## 10. Verificación

- [ ] Probar login + marcaje + solicitud + checklist + horas extras en staging.
- [ ] Si un embed falla por ambigüedad de FK, usar hint en `.select()`: `employees!nombre_del_fkey(...)`.
