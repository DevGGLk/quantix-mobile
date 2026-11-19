import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../lib/theme';
import { recorrido, type PasoRecorrido } from '../lib/aprobaciones';

const VERBO: Record<string, string> = {
  aprobado: 'aprobó',
  rechazado: 'rechazó',
  contraoferta: 'propuso otras condiciones',
  retirada: 'la retiró',
};

const cuando = (s: string) =>
  new Date(s).toLocaleString('es-NI', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Cada paso de la ruta, quién lo tiene y qué decidió cada persona (igual que en la web). */
export default function RecorridoSolicitud({ tabla, refId }: { tabla: string; refId: string }) {
  const [pasos, setPasos] = useState<PasoRecorrido[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let vivo = true;
    void recorrido(tabla, refId).then((p) => {
      if (!vivo) return;
      if (p) setPasos(p);
      else setError(true);
    });
    return () => {
      vivo = false;
    };
  }, [tabla, refId]);

  if (error) return <Text style={s.muted}>No se pudo cargar el recorrido.</Text>;
  if (!pasos) return <ActivityIndicator color={theme.primary} />;

  return (
    <View style={{ gap: 12 }}>
      {pasos.map((p) => {
        const color =
          p.situacion === 'aprobado'
            ? theme.success
            : p.situacion === 'rechazado'
              ? theme.danger
              : p.situacion === 'en_curso'
                ? '#F59E0B'
                : p.situacion === 'en_pausa'
                  ? '#3B82F6'
                  : '#CBD5E1';
        const icono =
          p.situacion === 'aprobado'
            ? 'checkmark'
            : p.situacion === 'rechazado'
              ? 'close'
              : p.situacion === 'en_curso'
                ? 'time-outline'
                : p.situacion === 'en_pausa'
                  ? 'pause'
                  : 'ellipse-outline';
        const estado =
          p.situacion === 'en_curso'
            ? 'La tiene ahora'
            : p.situacion === 'en_pausa'
              ? 'Esperando respuesta a la contraoferta'
              : p.situacion === 'espera'
                ? 'Después'
                : p.situacion === 'no_llego'
                  ? 'No llegó a este paso'
                  : null;
        return (
          <View key={p.orden} style={s.fila}>
            <View style={[s.punto, { backgroundColor: color }]}>
              <Ionicons name={icono as never} size={13} color="#fff" />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.titulo}>
                {p.etiqueta}
                {p.modo === 'todos' && p.nombres.length > 1 ? ' · deben aprobar todos' : ''}
              </Text>
              <Text style={s.muted}>{p.nombres.join(', ')}</Text>
              {estado ? <Text style={s.muted}>{estado}</Text> : null}
              {p.nota ? <Text style={s.nota}>{p.nota}</Text> : null}
              {p.decisiones.map((d, i) => (
                <Text key={i} style={s.decision}>
                  <Text style={{ fontWeight: '700' }}>{d.quien}</Text>
                  {d.en_nombre_de ? ` (suplente de ${d.en_nombre_de})` : ''} {VERBO[d.decision] ?? d.decision} ·{' '}
                  {cuando(d.cuando)}
                  {d.comentario ? `\n«${d.comentario}»` : ''}
                </Text>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  fila: { flexDirection: 'row', gap: 10 },
  punto: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  titulo: { fontSize: 13, fontWeight: '700', color: theme.textPrimary },
  muted: { fontSize: 12, color: theme.textSecondary },
  nota: { fontSize: 12, color: '#B45309' },
  decision: { fontSize: 12, color: theme.textPrimary, marginTop: 2 },
});
