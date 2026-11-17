import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';
import { useAuth } from './AuthContext';

/**
 * Avisos sin leer (buzón `notifications`) → globo rojo en el ícono de la app,
 * en la campanita de Inicio y en la pestaña Inicio.
 * Se refresca al abrir la app, al volver a primer plano, al llegar un push y
 * cada 2 minutos mientras está abierta. El servidor también manda el número
 * con cada push para que el ícono se actualice con la app cerrada.
 */
type AvisosState = { unread: number; refresh: () => Promise<void> };

const AvisosContext = createContext<AvisosState>({ unread: 0, refresh: async () => {} });

export function AvisosProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [unread, setUnread] = useState(0);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (!userId || busy.current) return;
    busy.current = true;
    try {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('read_at', null);
      if (!error) {
        const n = count ?? 0;
        setUnread(n);
        await Notifications.setBadgeCountAsync(n).catch(() => {});
      }
    } finally {
      busy.current = false;
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setUnread(0);
      void Notifications.setBadgeCountAsync(0).catch(() => {});
      return;
    }
    void refresh();
    const onPush = Notifications.addNotificationReceivedListener(() => void refresh());
    const onState = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refresh();
    });
    const timer = setInterval(() => void refresh(), 120_000);
    return () => {
      onPush.remove();
      onState.remove();
      clearInterval(timer);
    };
  }, [userId, refresh]);

  const value = useMemo(() => ({ unread, refresh }), [unread, refresh]);
  return <AvisosContext.Provider value={value}>{children}</AvisosContext.Provider>;
}

export function useAvisos(): AvisosState {
  return useContext(AvisosContext);
}

/** Texto del globo: 1–9 o «9+». */
export function badgeText(n: number): string | undefined {
  if (n <= 0) return undefined;
  return n > 9 ? '9+' : String(n);
}
