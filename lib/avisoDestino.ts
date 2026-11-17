import type { NavigationProp, ParamListBase } from '@react-navigation/native';

/** Adónde lleva un aviso (push o buzón) según `data.category`. */
export type DestinoAviso =
  | { tab: 'Turnos'; params?: { weekStart?: string } }
  | { tab: 'Home'; params?: undefined }
  | { stack: 'Encuestas'; params?: { surveyId?: string } }
  | { stack: 'Desempeno'; params?: undefined }
  | { stack: 'Checklists'; params?: undefined }
  | { stack: 'ChecklistsEquipo'; params?: undefined }
  | { stack: 'Vacaciones'; params?: undefined }
  | { stack: 'Mantenimiento'; params?: undefined };

/**
 * Pestaña a abrir al tocar un push, según `data.category` (lo manda
 * /api/cron/notifications-dispatch). null = solo abrir la app.
 * `turnos_publicados` trae `week_start`: se abre esa semana, que casi siempre
 * es la siguiente y no la actual.
 */
export function destinoParaAviso(data: unknown): DestinoAviso | null {
  const d = data as { category?: unknown; week_start?: unknown; url?: unknown } | null;
  // Encuesta nueva o recordatorio: abre la encuesta (el id viene en la url /mi-portal?encuesta=<id>).
  if (d?.category === 'encuesta') {
    const m = typeof d.url === 'string' ? /[?&]encuesta=([0-9a-f-]{36})/i.exec(d.url) : null;
    return { stack: 'Encuestas', params: m ? { surveyId: m[1] } : undefined };
  }
  // Desempeño: autoevaluación, evaluaciones del equipo, recordatorios y resultados publicados.
  if (d?.category === 'desempeno') return { stack: 'Desempeno' };
  // Checklist pendiente de hoy o devuelto para corregir.
  if (d?.category === 'checklist_pendiente' || d?.category === 'checklist_rechazado') return { stack: 'Checklists' };
  // Jefe directo: envío del equipo por revisar o incumplimiento de su gente.
  if (d?.category === 'checklist_por_aprobar' || (d?.category === 'checklist_alertas' && typeof d.url === 'string' && d.url.includes('equipo=1'))) {
    return { stack: 'ChecklistsEquipo' };
  }
  // Vacaciones y permisos: solicitud del equipo por aprobar (jefe), decisión, recordatorios.
  // La sección del equipo vive dentro de "Mis Vacaciones".
  if (d?.category === 'vacaciones') return { stack: 'Vacaciones' };
  // Mantenimiento: solicitud nueva, asignación, resuelta (¿quedó bien?) o reabierta.
  if (d?.category === 'mantenimiento') return { stack: 'Mantenimiento' };
  // Comunicados, eventos y avisos de asistencia (marcar salida, excepciones): Inicio.
  if (
    d?.category === 'comunicado' ||
    d?.category === 'evento' ||
    d?.category === 'asistencia_salida_pendiente' ||
    d?.category === 'asistencia_excepciones'
  ) {
    return { tab: 'Home' };
  }
  // Publicación de semana, cambios de turno y turnos abiertos abren la pestaña Turnos.
  if (d?.category !== 'turnos_publicados' && d?.category !== 'cambio_turno' && d?.category !== 'turno_abierto') return null;
  const ws = typeof d.week_start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.week_start) ? d.week_start : undefined;
  return { tab: 'Turnos', params: ws ? { weekStart: ws } : undefined };
}

/** Abre el destino con cualquier objeto de navegación (ref global o `navigation` de una pantalla). */
export function abrirDestino(nav: Pick<NavigationProp<ParamListBase>, 'navigate'>, destino: DestinoAviso) {
  if ('stack' in destino) nav.navigate(destino.stack, destino.params);
  else nav.navigate('MainTabs', { screen: destino.tab, params: destino.params });
}
