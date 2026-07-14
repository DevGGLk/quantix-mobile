jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  enqueueClockIn,
  flushClockInQueue,
  newOfflineHash,
  pendingClockIns,
  type QueuedClockIn,
} from '../lib/clockInQueue';

function item(overrides: Partial<QueuedClockIn> = {}): QueuedClockIn {
  return {
    offlineHash: newOfflineHash(),
    latitude: 12.92,
    longitude: -85.91,
    accuracy: 10,
    isMocked: false,
    queuedAtIso: new Date().toISOString(),
    ...overrides,
  };
}

describe('clockInQueue (cola offline de marcajes)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('encola y cuenta pendientes', async () => {
    await enqueueClockIn(item());
    await enqueueClockIn(item());
    expect(await pendingClockIns()).toBe(2);
  });

  it('flush: aceptados y rechazados salen de la cola; sin red se conservan', async () => {
    const a = item({ offlineHash: 'off-a' });
    const b = item({ offlineHash: 'off-b' });
    const c = item({ offlineHash: 'off-c' });
    await enqueueClockIn(a);
    await enqueueClockIn(b);
    await enqueueClockIn(c);

    const { sent, rejectedMessages } = await flushClockInQueue(async (i) => {
      if (i.offlineHash === 'off-a') return { status: 'ok' };
      if (i.offlineHash === 'off-b') return { status: 'rejected', message: 'Fuera de rango' };
      return { status: 'network' };
    });

    expect(sent).toBe(1);
    expect(rejectedMessages).toEqual(['Fuera de rango']);
    expect(await pendingClockIns()).toBe(1); // solo el de red se conserva
  });

  it('hashes offline únicos', () => {
    const seen = new Set(Array.from({ length: 50 }, () => newOfflineHash()));
    expect(seen.size).toBe(50);
  });
});
