# Changelog — Quantix HR App Móvil

Historial de cambios del cliente **React Native / Expo** (`quantix-mobile`).

## 2026-04-10

- **2026-04-10:** **Fix/Mobile:** Se actualizó la consulta de lectura de turnos para coincidir con el nuevo esquema de base de datos (`assigned_date`, `is_day_off`).

## 2026-04-09

- **2026-04-09:** **Feat/Fix:** Se agregó Pull-to-Refresh en Home y Perfil para mejorar la UX. Se inyectó telemetría de error en la sincronización GPS para diagnóstico de guardado.

- **2026-04-09:** **Fix/Forms:** Se revirtió el payload de sugerencias para usar `employeeRecord.id`, respetando la Foreign Key hacia la tabla `employees`.

- **2026-04-09:** **Fix/Critical:** Se forzaron las llaves de inserción (`leave_type`, `company_id`) en formularios y se añadió trazabilidad al AuthContext para debuggear pérdida de sesión.

- **2026-04-09:** **Fix/Fullstack:** Se corrigió el payload de ausencias móviles para usar la columna `leave_type`. Se inyectó el `company_id` en los formularios web de Comunicaciones para resolver el bloqueo 403 de RLS.

- **2026-04-09:** **Fix/Forms:** Se corrigieron los nombres de columnas en `time_off_requests` y se inyectó obligatoriamente el `company_id` en todos los formularios (Sugerencias, Reportes) para cumplir con las políticas RLS.

- **2026-04-09:** **Fix/Database:** Se eliminó la columna inexistente `onboarding_completed` de las peticiones de AuthContext, resolviendo un error crítico (PGRST 42703) que bloqueaba la hidratación del perfil y el Check-in.

- **2026-04-09:** **Fix/UI:** Se corrigió el mapeo de propiedades entre el estado de AuthContext y las pantallas. Ahora HomeScreen y PerfilScreen leen correctamente el `first_name` y `hire_date` provenientes de la base de datos.

## 2026-04-07

- **2026-04-07:** **Fix/UI:** Se añadió resiliencia al Camino de Copas en el Perfil móvil. El componente se renderiza con valores por defecto (año completo vía fecha de ingreso sustituta) incluso si el expediente falla al cargar por red o RLS; el saldo puede mostrarse en 0.

- **2026-04-07:** **Fix/Auth:** Se ajustó el manejo de errores del perfil para distinguir entre fallos de red (timeout), ausencia de fila en `profiles`, `company_id` vacío y falta de expediente en `employees`, previniendo cascadas de errores RLS; se añadió reintento de lectura de `employees` sin filtrar por empresa cuando el primer intento no devuelve filas.

- **2026-04-07:** **Fix/Mobile:** Se corrigió el valor del enum `entry_method` (campo `entry_type` en `time_entries`) al marcar asistencia: se usa `gps_mobile` en lugar de `IN`. Se reforzó la carga del `AuthContext` (timeout, `profiles` + `employees` embebido y fallback) para evitar perfiles huérfanos que causan errores RLS.

- **2026-04-07:** **Fix/UI:** Se forzaron las dimensiones estáticas y los estilos contenedores de las medallas PNG en el perfil para garantizar su correcta visualización en dispositivos físicos.

- **2026-04-07:** **Fix/RLS:** Se añadieron explícitamente los campos `company_id` y `employee_id` en los payloads de Sugerencias y Horas Extras para cumplir con las políticas de seguridad de la base de datos.

- **2026-04-07:** **Fix/Mobile:** Se corrigió el desbordamiento visual de los botones del Reloj Checador. Se forzó la migración del formulario de ausencias hacia `time_off_requests`.

- **2026-04-07:** **UX/Educación:** Se implementó un sistema de modales de ayuda nativos. Se añadieron guías interactivas en el Home (explicando la privacidad del GPS) y en la Tienda (reglas de canje), logrando paridad con la experiencia educativa de la plataforma web.

- **2026-04-07:** **UI/Gamificación:** Se integró el "Camino de Copas" interactivo con activos PNG nativos. Se implementó la lógica de Temporada Corta para prorratear metas según la fecha de ingreso, logrando paridad total con la experiencia web.

- **2026-04-07:** **Security/Gamification:** Se eliminaron escrituras manuales en canjes de recompensas. La tienda móvil ahora usa la API segura `/api/gamification/redeem`, previniendo saldos negativos.

- **2026-04-07:** **Security/GPS:** Se alineó el rastreo operativo móvil con las reglas de privacidad de la web. La telemetría ahora exige estrictamente que el flag `is_gps_tracking_enabled` esté activo en el perfil del usuario antes de transmitir coordenadas.

- **2026-04-07:** **Security/Gamification:** Se eliminaron las escrituras manuales a tablas de saldos. Toda asignación de puntos en Academia, Onboarding y Checklists ahora se procesa de forma segura a través del RPC `assign_gamification_points`, validando la identidad del expediente.
