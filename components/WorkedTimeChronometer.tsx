import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
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
 * Cronómetro en vivo del tiempo laborado del turno abierto, equivalente al de la
 * web (`mi-portal`). Cuenta desde `clockInAt` (ISO del `time_entries.clock_in`
 * abierto) y se actualiza cada segundo. `onPause` solo cambia el subtítulo; el
 * conteo es bruto desde la entrada, igual que la web.
 */
export function WorkedTimeChronometer({
  clockInAt,
  onPause = false,
}: {
  clockInAt: string;
  onPause?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const start = new Date(clockInAt).getTime();
  const elapsed = Number.isNaN(start) ? 0 : now - start;

  return (
    <View style={styles.wrap}>
      <Text style={styles.time} accessibilityLabel={`Tiempo laborado ${formatElapsed(elapsed)}`}>
        {formatElapsed(elapsed)}
      </Text>
      <Text style={styles.label}>{onPause ? 'En pausa · tiempo laborado hoy' : 'Tiempo laborado hoy'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginBottom: 12,
    borderRadius: 16,
    backgroundColor: theme.backgroundAlt,
    borderWidth: 1,
    borderColor: theme.border,
  },
  time: {
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: 1,
    color: theme.primary,
    fontVariant: ['tabular-nums'],
  },
  label: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
    color: theme.textMuted,
  },
});
