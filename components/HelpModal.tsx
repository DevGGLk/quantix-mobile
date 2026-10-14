import React, { useMemo } from 'react';
import {
  Modal,
  Text,
  StyleSheet,
  Pressable,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';

import { useTheme, type Palette } from '../theme';

export type HelpModalProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Texto plano; si se pasa `children`, tiene prioridad. */
  content?: string;
  children?: React.ReactNode;
};

/**
 * Modal educativo reutilizable (paridad UX con guías del dashboard web).
 */
export function HelpModal({ visible, onClose, title, content, children }: HelpModalProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const body =
    children ??
    (content ? <Text style={styles.bodyText}>{content}</Text> : null);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {body}
          </ScrollView>
          <TouchableOpacity
            style={styles.button}
            onPress={onClose}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel="Entendido, cerrar ayuda"
          >
            <Text style={styles.buttonText}>Entendido</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: c.backdrop,
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    card: {
      backgroundColor: c.surface.card,
      borderRadius: 16,
      padding: 20,
      maxHeight: '80%',
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.2,
          shadowRadius: 16,
        },
        android: { elevation: 8 },
      }),
    },
    title: {
      fontSize: 18,
      fontWeight: '800',
      color: c.text.primary,
      marginBottom: 12,
    },
    scroll: {
      maxHeight: 320,
    },
    scrollContent: {
      paddingBottom: 8,
    },
    bodyText: {
      fontSize: 15,
      lineHeight: 22,
      color: c.text.secondary,
    },
    button: {
      marginTop: 16,
      backgroundColor: c.mode === 'dark' ? c.action.bright : c.action.base,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
    },
    buttonText: {
      fontSize: 16,
      fontWeight: '700',
      color: c.onAction,
    },
  });
