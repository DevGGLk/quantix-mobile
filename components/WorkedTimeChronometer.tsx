import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { theme } from '../lib/theme';

/** HH:MM:SS a partir de milisegundos transcurridos (nunca negativo). */
function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}`;
}

/**
 * Cronómetro en vivo del tiempo laborado del turno abierto, con el mismo estilo que el de la
 * web (`mi-portal`, tarjeta «Cronómetro»). Cuenta desde `clockInAt` (ISO del
 * `time_entries.clock_in` abierto) y se actualiza cada segundo. Sin turno abierto muestra
 * 00:00:00. `onPause` solo cambia el subtítulo; el conteo es bruto desde la entrada.
 */
export function WorkedTimeChronometer({
  clockInAt,
  onPause = false,
}: {
  clockInAt: string | null;
  onPause?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!clockInAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [clockInAt]);

  const start = clockInAt ? new Date(clockInAt).getTime() : NaN;
  const elapsed = Number.isNaN(start) ? 0 : now - start;
  const label = !clockInAt ? 'Sin turno abierto' : onPause ? 'En pausa · tiempo laborado hoy' : 'Tiempo laborado hoy';

  return (
    <View style={styles.wrap}>
      <Text style={styles.time} accessibilityLabel={`Tiempo laborado ${formatElapsed(elapsed)}`}>
        {formatElapsed(elapsed)}
      </Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 12,
  },
  time: {
    fontSize: 32,
    fontWeight: '700',
    color: theme.textPrimary,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontVariant: ['tabular-nums'],
  },
  label: {
    marginTop: 4,
    fontSize: 14,
    color: theme.textSecondary,
  },
});
