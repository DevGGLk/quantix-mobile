# RLS, admin en móvil y APIs

El **Centro de Mando** y el **mapa GPS** filtran por rol en la interfaz, pero **eso no es seguridad**: cualquier cliente puede llamar a Supabase directamente.

## Checklist obligatorio (backend / Supabase)

1. **RLS activo** en todas las tablas con datos sensibles (`time_entries`, `employee_requests`, `disciplinary_records`, `employees`, `checklist_submissions`, `extra_hours_records`, etc.).
2. **Políticas por `company_id`**: el JWT solo puede leer/escribir filas de la empresa del usuario (vía `employees` o claims).
3. **Sucursal (manager)**: si un manager solo debe ver su `branch_id`, la política debe comparar `employees.branch_id` del actor con la fila consultada (no confiar en filtros del móvil).
4. **Sin “service role” en el cliente**: la app solo usa la clave **anon**; operaciones administrativas críticas deben ir por **Edge Functions** o API con verificación de rol server-side.
5. **Revisar embeds PostgREST** (`employees!inner`): si RLS no aplica bien en joins, un usuario podría inferir datos; probar con sesión de empleado estándar en SQL/REST.
6. **Auditoría periódica**: ejecutar pruebas con cuentas de distintos roles y `EXPLAIN` de políticas.

## APIs propias (`EXPO_PUBLIC_QUANTIX_API_URL`)

Validar JWT, rol y pertenencia a empresa/sucursal en **cada** endpoint (marcaje, onboarding, etc.), igual que harías en un producto SaaS multi-tenant global.
