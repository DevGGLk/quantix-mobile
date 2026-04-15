import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  Modal,
  Pressable,
  type ImageSourcePropType,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import type { CopaPathLevelStep, CopaPathStatus } from '../lib/gamificationCopaPath';

/** Alineado a la paleta VIP de PerfilScreen. */
const T = {
  cardLavender: '#FFFFFF',
  textOnLight: '#1E293B',
  textMuted: '#64748B',
  buttonGold: '#FF9F43',
  teal: '#00C2D1',
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

/** Misma secuencia que `DEFAULT_COPA_LEVELS` en lógica (índice 0 = bronce, …). */
const FALLBACK_CUP_IMAGES: ImageSourcePropType[] = [
  imgBronce,
  imgPlata,
  imgOro,
  imgPlatinum,
  imgDiamante,
];

/**
 * `image_src` remoto (URL) o ruta estilo web (`/gamificacion/*.png`); si no aplica, nombre de copa o PNG por índice.
 */
function resolveCupImageSource(step: CopaPathLevelStep, index: number): ImageSourcePropType {
  const src = (step.imageSrc ?? '').trim();
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return { uri: src };
  }
  const lower = src.toLowerCase();
  if (lower.includes('bronce')) return imgBronce;
  if (lower.includes('plata')) return imgPlata;
  if (lower.includes('diamante')) return imgDiamante;
  if (lower.includes('platinum')) return imgPlatinum;
  if (lower.includes('oro')) return imgOro;
  if (lower.includes('/gamificacion/')) {
    const file = lower.split('/gamificacion/')[1] ?? '';
    if (file.includes('bronce')) return imgBronce;
    if (file.includes('plata')) return imgPlata;
    if (file.includes('oro')) return imgOro;
    if (file.includes('platinum')) return imgPlatinum;
    if (file.includes('diamante')) return imgDiamante;
  }
  const nameKey = step.name.trim().toLowerCase();
  const fromName = CUP_IMAGES[nameKey];
  if (fromName) return fromName;
  return FALLBACK_CUP_IMAGES[Math.min(index, FALLBACK_CUP_IMAGES.length - 1)] ?? imgBronce;
}

/** Tamaños fijos en px: en dispositivos físicos `Image` con % dentro de ScrollView horizontal a veces colapsa a 0. */
function cupPixelSize(step: CopaPathLevelStep): number {
  if (step.state === 'locked') return 56;
  if (step.state === 'current') return 80;
  return 64;
}

function triggerCupTapHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

function CupStep({
  step,
  index,
  onPress,
}: {
  step: CopaPathLevelStep;
  index: number;
  onPress: (step: CopaPathLevelStep) => void;
}) {
  const locked = step.state === 'locked';
  const px = cupPixelSize(step);
  const opacity = locked ? 0.35 : 1;
  const imgSource = resolveCupImageSource(step, index);

  return (
    <Pressable
      onPress={() => {
        triggerCupTapHaptic();
        onPress(step);
      }}
      style={({ pressed }) => [
        styles.cupCol,
        { minWidth: Math.max(84, px + 8), opacity: pressed ? 0.85 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Ver detalle de la copa ${step.name}`}
    >
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
          source={imgSource}
          style={{ width: px, height: px }}
          resizeMode="contain"
          accessibilityLabel={`Copa ${step.name}${locked ? ' bloqueada' : ''}`}
        />
      </View>
      <Text style={[styles.cupLabel, locked && styles.cupLabelMuted]} numberOfLines={2}>
        {step.name}
      </Text>
      <Text style={[styles.cupMeta, locked && styles.cupLabelMuted]} numberOfLines={1}>
        Meta {step.threshold.toLocaleString('es-NI')} pts
      </Text>
      {step.rewardText ? (
        <Text style={[styles.cupReward, locked && styles.cupLabelMuted]} numberOfLines={3}>
          {step.rewardText}
        </Text>
      ) : null}
    </Pressable>
  );
}

type CopaPathTrailProps = {
  status: CopaPathStatus;
};

export function CopaPathTrail({ status }: CopaPathTrailProps) {
  const { levels, progressPercent, yearlyEarnedPoints, isShortSeason, pointsToNext, nextLevelName } =
    status;

  const [selectedCopa, setSelectedCopa] = useState<CopaPathLevelStep | null>(null);

  const closeModal = useCallback(() => setSelectedCopa(null), []);

  const hint =
    nextLevelName != null
      ? `Faltan ${pointsToNext.toLocaleString('es-NI')} pts para ${nextLevelName}`
      : '¡Meta anual máxima alcanzada!';

  const modalImg =
    selectedCopa != null
      ? resolveCupImageSource(selectedCopa, Math.max(0, levels.findIndex((l) => l === selectedCopa)))
      : imgBronce;

  const stateLabel =
    selectedCopa?.state === 'locked'
      ? 'Bloqueada'
      : selectedCopa?.state === 'current'
        ? 'En progreso'
        : selectedCopa?.state === 'achieved'
          ? 'Alcanzada'
          : '';

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
          {levels.map((step, idx) => (
            <CupStep key={`${step.name}-${step.threshold}-${idx}`} step={step} index={idx} onPress={setSelectedCopa} />
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.track}>
        <View style={[styles.trackFill, { width: `${Math.min(100, Math.max(0, progressPercent))}%` }]} />
      </View>

      <Text style={styles.hint}>{hint}</Text>

      <Modal
        visible={selectedCopa != null}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <Pressable style={styles.modalOverlay} onPress={closeModal}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <View style={styles.modalIconWrap}>
                <Image source={modalImg} style={styles.modalIcon} resizeMode="contain" />
              </View>
              <View style={styles.modalHeaderText}>
                <Text style={styles.modalKicker}>Camino de Copas</Text>
                <Text style={styles.modalTitle}>{selectedCopa?.name ?? ''}</Text>
              </View>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.modalSection}>
                <Text style={styles.modalSectionTitle}>¿Cómo obtenerla?</Text>
                <Text style={styles.modalSectionText}>
                  Necesitas acumular{' '}
                  <Text style={styles.modalEmphasis}>
                    {selectedCopa?.threshold.toLocaleString('es-NI') ?? '—'} puntos de estatus
                  </Text>{' '}
                  en el año (puntos ganados por tu desempeño, distintos al saldo de la tienda).
                </Text>
              </View>

              <View style={[styles.modalSection, styles.modalSectionReward]}>
                <Text style={styles.modalSectionTitleReward}>Tu premio</Text>
                {selectedCopa?.rewardText?.trim() ? (
                  <Text style={styles.modalRewardText}>{selectedCopa.rewardText.trim()}</Text>
                ) : (
                  <Text style={styles.modalSectionMuted}>
                    Tu empresa puede detallar la recompensa de este nivel en el panel de administración.
                  </Text>
                )}
              </View>

              {selectedCopa ? (
                <Text style={styles.modalStateLine}>
                  Estado: <Text style={styles.modalStateBold}>{stateLabel}</Text>
                </Text>
              ) : null}
            </View>

            <Pressable style={styles.modalButton} onPress={closeModal}>
              <Text style={styles.modalButtonText}>Entendido</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
    maxWidth: 88,
  },
  cupMeta: {
    marginTop: 2,
    fontSize: 9,
    fontWeight: '600',
    color: T.textMuted,
    textAlign: 'center',
    maxWidth: 96,
  },
  cupReward: {
    marginTop: 3,
    fontSize: 8,
    fontWeight: '500',
    color: T.textMuted,
    textAlign: 'center',
    maxWidth: 100,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    maxWidth: 400,
    width: '100%',
    alignSelf: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    backgroundColor: '#F0FDFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  modalIconWrap: {
    width: 72,
    height: 72,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalIcon: {
    width: 68,
    height: 68,
  },
  modalHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  modalKicker: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: T.teal,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: T.textOnLight,
  },
  modalBody: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
    gap: 16,
  },
  modalSection: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    padding: 14,
  },
  modalSectionReward: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  modalSectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: T.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  modalSectionTitleReward: {
    fontSize: 11,
    fontWeight: '800',
    color: '#B45309',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  modalSectionText: {
    fontSize: 15,
    lineHeight: 22,
    color: T.textOnLight,
  },
  modalEmphasis: {
    fontWeight: '800',
    color: T.teal,
  },
  modalRewardText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: T.textOnLight,
  },
  modalSectionMuted: {
    fontSize: 14,
    lineHeight: 21,
    color: T.textMuted,
  },
  modalStateLine: {
    fontSize: 12,
    color: T.textMuted,
  },
  modalStateBold: {
    fontWeight: '700',
    color: T.textOnLight,
  },
  modalButton: {
    marginHorizontal: 20,
    marginBottom: 20,
    marginTop: 8,
    backgroundColor: T.teal,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
