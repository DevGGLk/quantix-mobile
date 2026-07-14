import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * M2 convergencia marcaje: cola OFFLINE de marcajes (reemplaza al INSERT
 * directo a time_entries, que bypaseaba la validación del servidor).
 *
 * Sin red: el intento se encola con un offline_hash idempotente y se re-envía
 * por el MISMO endpoint (/api/time-entries/clock-in → clock_in_secure) al
 * reconectar. El servidor re-valida, deduplica por hash y audita. Nota de
 * semántica (paridad con la web): el clock_in queda con la hora del servidor
 * al momento del replay.
 */
const QUEUE_KEY = 'quantix.clockInQueue.v1';

export type QueuedClockIn = {
  offlineHash: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  isMocked: boolean;
  queuedAtIso: string;
};

export function newOfflineHash(): string {
  return `off-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readQueue(): Promise<QueuedClockIn[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as QueuedClockIn[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: QueuedClockIn[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    // sin storage no hay cola; el usuario verá el error online normal
  }
}

export async function enqueueClockIn(item: QueuedClockIn): Promise<void> {
  const q = await readQueue();
  q.push(item);
  await writeQueue(q);
}

export async function pendingClockIns(): Promise<number> {
  return (await readQueue()).length;
}

export type FlushSendResult =
  | { status: 'ok' }
  | { status: 'rejected'; message: string }
  | { status: 'network' };

/**
 * Reintenta los marcajes encolados. `send` debe devolver:
 *  ok       → aceptado (o already_processed) ⇒ sale de la cola
 *  rejected → el servidor DECIDIÓ rechazarlo (queda auditado) ⇒ sale de la cola
 *  network  → sin conectividad ⇒ se conserva para el próximo flush
 * Devuelve mensajes de rechazo para informar al usuario.
 */
export async function flushClockInQueue(
  send: (item: QueuedClockIn) => Promise<FlushSendResult>
): Promise<{ sent: number; rejectedMessages: string[] }> {
  const q = await readQueue();
  if (q.length === 0) return { sent: 0, rejectedMessages: [] };

  const keep: QueuedClockIn[] = [];
  const rejectedMessages: string[] = [];
  let sent = 0;

  for (const item of q) {
    const r = await send(item);
    if (r.status === 'ok') {
      sent += 1;
    } else if (r.status === 'rejected') {
      rejectedMessages.push(r.message);
    } else {
      keep.push(item);
    }
  }

  await writeQueue(keep);
  return { sent, rejectedMessages };
}
