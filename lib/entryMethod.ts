/**
 * Valores del enum Postgres `entry_method` (columna `time_entries.entry_type`).
 * Es el canal de marcaje, no el tipo in/out (eso va en `status`: attendance_status).
 */
export const ENTRY_METHOD = {
  KIOSK: 'kiosk',
  GPS_MOBILE: 'gps_mobile',
  OFFLINE_SYNC: 'offline_sync',
} as const;

export type EntryMethod = (typeof ENTRY_METHOD)[keyof typeof ENTRY_METHOD];
