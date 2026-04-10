import React from 'react';
import { View, Text, Image, StyleSheet, ScrollView, type ImageSourcePropType } from 'react-native';

import type { CopaPathLevelStep, CopaPathStatus } from '../lib/gamificationCopaPath';

/** Alineado a la paleta VIP de PerfilScreen. */
const T = {
  cardLavender: '#FFFFFF',
  textOnLight: '#1E293B',
  textMuted: '#64748B',
  buttonGold: '#FF9F43',
} as const;

/** Desde `components/` → `assets/gamificacion/*.png` (Metro empaqueta estos requires). */
const imgBronce = require('../assets/gamificacion/bronce.png');
const imgPlata = require('../assets/gamificacion/plata.png');
const imgOro = require('../assets/gamificacion/oro.png');
const imgPlatinum = require('../assets/gamificacion/platinum.png');
const imgDiamante = require('../assets/gamificacion/diamante.png');

const CUP_IMAGES: Record<string, ImageSourcePropType> = {
  bronce: imgBronce,
  plata: imgPlata,
  oro: imgOro,
  platinum: imgPlatinum,
  diamante: imgDiamante,
};

function cupSourceForLevelName(name: string): ImageSourcePropType {
  const key = name.trim().toLowerCase();
  return CUP_IMAGES[key] ?? imgBronce;
}

/** Tamaños fijos en px: en dispositivos físicos `Image` con % dentro de ScrollView horizontal a veces colapsa a 0. */
function cupPixelSize(step: CopaPathLevelStep): number {
  if (step.state === 'locked') return 56;
  if (step.state === 'current') return 80;
  return 64;
}

function CupStep({ step }: { step: CopaPathLevelStep }) {
  const locked = step.state === 'locked';
  const px = cupPixelSize(step);
  const opacity = locked ? 0.35 : 1;

  return (
    <View style={[styles.cupCol, { minWidth: Math.max(84, px + 8) }]}>
      <View
        style={[
          styles.cupImgWrap,
          {
            width: px,
            height: px,
            minWidth: px,
            minHeight: px,
            opacity,
          },
        ]}
      >
        <Image
          source={cupSourceForLevelName(step.name)}
          style={{ width: px, height: px }}
          resizeMode="contain"
          accessibilityLabel={`Copa ${step.name}${locked ? ' bloqueada' : ''}`}
        />
      </View>
      <Text style={[styles.cupLabel, locked && styles.cupLabelMuted]} numberOfLines={1}>
        {step.name}
      </Text>
    </View>
  );
}

type CopaPathTrailProps = {
  status: CopaPathStatus;
};

export function CopaPathTrail({ status }: CopaPathTrailProps) {
  const { levels, progressPercent, yearlyEarnedPoints, isShortSeason, pointsToNext, nextLevelName } =
    status;

  const hint =
    nextLevelName != null
      ? `Faltan ${pointsToNext.toLocaleString('es-NI')} pts para ${nextLevelName}`
      : '¡Meta anual máxima alcanzada!';

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Camino de Copas</Text>
      <Text style={styles.subStats}>
        {yearlyEarnedPoints.toLocaleString('es-NI')} pts ganados este año
      </Text>

      {isShortSeason ? (
        <View style={styles.shortSeasonPill}>
          <Text style={styles.shortSeasonText}>Temporada Corta</Text>
        </View>
      ) : null}

      {levels.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.cupsScroll}
          contentContainerStyle={styles.cupsRow}
        >
          {levels.map((step) => (
            <CupStep key={step.name} step={step} />
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.track}>
        <View style={[styles.trackFill, { width: `${Math.min(100, Math.max(0, progressPercent))}%` }]} />
      </View>

      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: T.cardLavender,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: T.textOnLight,
    marginBottom: 4,
  },
  subStats: {
    fontSize: 13,
    color: T.textMuted,
    marginBottom: 8,
  },
  shortSeasonPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 12,
  },
  shortSeasonText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
  },
  cupsScroll: {
    minHeight: 128,
    flexGrow: 0,
  },
  cupsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 12,
    minHeight: 120,
    minWidth: '100%',
  },
  cupCol: {
    alignItems: 'center',
  },
  cupImgWrap: {
    justifyContent: 'flex-end',
    alignItems: 'center',
    overflow: 'hidden',
  },
  cupLabel: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: '700',
    color: T.textOnLight,
    textAlign: 'center',
    maxWidth: 72,
  },
  cupLabelMuted: {
    color: T.textMuted,
  },
  track: {
    marginTop: 10,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#FDE68A',
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: T.buttonGold,
  },
  hint: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '600',
    color: T.textMuted,
  },
});
