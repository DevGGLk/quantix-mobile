# Changelog — Quantix HR App Móvil

Historial de cambios del cliente **React Native / Expo** (`quantix-mobile`).

## 2026-04-07

- **2026-04-07:** **Security/GPS:** Se alineó el rastreo operativo móvil con las reglas de privacidad de la web. La telemetría ahora exige estrictamente que el flag `is_gps_tracking_enabled` esté activo en el perfil del usuario antes de transmitir coordenadas.

- **2026-04-07:** **Security/Gamification:** Se eliminaron las escrituras manuales a tablas de saldos. Toda asignación de puntos en Academia, Onboarding y Checklists ahora se procesa de forma segura a través del RPC `assign_gamification_points`, validando la identidad del expediente.
