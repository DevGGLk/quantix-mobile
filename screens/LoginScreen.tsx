import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { getPasswordRecoveryRedirectUrl } from '../lib/authRedirect';
import { supabase } from '../lib/supabase';
import { useTheme, type Palette } from '../theme';

type LoginScreenProps = {
  onLoginSuccess?: () => void;
};

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [isRecoveryLoading, setIsRecoveryLoading] = useState(false);
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);

  const handleLogin = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      Alert.alert('Error', 'Ingresa tu correo y contraseña.');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (error) {
        Alert.alert('Error al iniciar sesión', error.message);
        return;
      }
      onLoginSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error inesperado. Intenta de nuevo.';
      Alert.alert('Error', message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotUsername = () => {
    Alert.alert(
      'Recuperar Usuario',
      'Por motivos de seguridad, si no recuerdas tu correo de acceso, por favor contacta a tu gerente de sucursal o al departamento de RRHH.'
    );
  };

  const sendRecoveryEmail = async (rawEmail: string): Promise<boolean> => {
    const trimmedEmail = rawEmail.trim();
    if (!trimmedEmail) {
      Alert.alert('Campo requerido', 'Ingresa tu correo electrónico.');
      return false;
    }

    setIsRecoveryLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: getPasswordRecoveryRedirectUrl(),
      });
      if (error) throw error;

      Alert.alert(
        'Correo enviado',
        'Si el correo existe en nuestro sistema, recibirás un enlace para crear tu nueva contraseña. Revisa tu bandeja de entrada.'
      );
      return true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'No se pudo enviar el correo de recuperación.';
      Alert.alert('Error', message);
      return false;
    } finally {
      setIsRecoveryLoading(false);
    }
  };

  const handleForgotPassword = () => {
    if (Platform.OS === 'ios') {
      Alert.prompt(
        'Recuperar contraseña',
        'Ingresa tu correo electrónico corporativo.',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Enviar',
            onPress: (value?: string) => {
              void sendRecoveryEmail(value ?? '');
            },
          },
        ],
        'plain-text',
        email.trim()
      );
      return;
    }

    setRecoveryEmail(email.trim());
    setShowRecoveryModal(true);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
      >
        <View style={styles.content}>
          {/* Identidad de marca */}
          <View style={styles.brandBlock}>
            <View style={styles.brandSymbol}>
              <Text style={styles.brandSymbolLetter}>Q</Text>
              {/* Variante A: punto abajo-derecha (evoca "persona"). */}
              <View style={styles.brandSymbolDot} />
            </View>
            <Text style={styles.title}>QuantixHR</Text>
            <Text style={styles.tagline}>Gestión humana, con precisión</Text>
          </View>

          {/* Correo */}
          <View style={styles.inputRow}>
            <Ionicons
              name="mail-outline"
              size={20}
              color={palette.text.tertiary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.inputField}
              placeholder="Correo electrónico"
              placeholderTextColor={palette.text.tertiary}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isLoading}
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
          </View>

          {/* Contraseña */}
          <View style={styles.inputRow}>
            <Ionicons
              name="lock-closed-outline"
              size={20}
              color={palette.text.tertiary}
              style={styles.inputIcon}
            />
            <TextInput
              ref={passwordRef}
              style={styles.inputField}
              placeholder="Contraseña"
              placeholderTextColor={palette.text.tertiary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              editable={!isLoading}
              returnKeyType="go"
              onSubmitEditing={() => {
                if (!isLoading) void handleLogin();
              }}
            />
            <TouchableOpacity
              style={styles.passwordToggle}
              onPress={() => setShowPassword((v) => !v)}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={22}
                color={palette.text.tertiary}
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleLogin}
            activeOpacity={0.85}
            disabled={isLoading}
          >
            {isLoading ? (
              <View style={styles.buttonLoading}>
                <ActivityIndicator color={palette.onAction} size="small" />
                <Text style={styles.buttonText}>Ingresando...</Text>
              </View>
            ) : (
              <Text style={styles.buttonText}>Iniciar sesión</Text>
            )}
          </TouchableOpacity>

          <View style={styles.recoveryLinks}>
            <TouchableOpacity
              onPress={handleForgotPassword}
              disabled={isLoading || isRecoveryLoading}
              activeOpacity={0.7}
            >
              <Text style={styles.recoveryLink}>¿Olvidaste tu contraseña?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleForgotUsername}
              disabled={isLoading || isRecoveryLoading}
              activeOpacity={0.7}
            >
              <Text style={styles.recoveryLink}>¿Olvidaste tu usuario?</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={showRecoveryModal}
        transparent
        animationType="fade"
        onRequestClose={() => !isRecoveryLoading && setShowRecoveryModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Recuperar contraseña</Text>
            <Text style={styles.modalHint}>Ingresa tu correo electrónico corporativo.</Text>

            <TextInput
              style={styles.modalInput}
              placeholder="correo@empresa.com"
              placeholderTextColor={palette.text.tertiary}
              value={recoveryEmail}
              onChangeText={setRecoveryEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isRecoveryLoading}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalButtonGhost}
                onPress={() => setShowRecoveryModal(false)}
                disabled={isRecoveryLoading}
              >
                <Text style={styles.modalButtonGhostText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, isRecoveryLoading && styles.buttonDisabled]}
                onPress={async () => {
                  const ok = await sendRecoveryEmail(recoveryEmail);
                  if (ok) setShowRecoveryModal(false);
                }}
                disabled={isRecoveryLoading}
              >
                {isRecoveryLoading ? (
                  <ActivityIndicator color={palette.onAction} size="small" />
                ) : (
                  <Text style={styles.modalButtonText}>Enviar</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/**
 * Estilos dependientes del modo. Se reconstruyen vía useMemo cuando cambia la
 * paleta (light↔dark). El botón de acción usa turquesa `base` en light y
 * `bright` en dark (regla del manual). El símbolo de marca y `onAction` ya vienen
 * resueltos por modo desde la paleta.
 */
const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    keyboardView: {
      flex: 1,
      justifyContent: 'center',
    },
    content: {
      paddingHorizontal: 32,
    },
    brandBlock: {
      alignItems: 'center',
      marginBottom: 36,
    },
    brandSymbol: {
      width: 62,
      height: 62,
      borderRadius: 17,
      // Logo = identidad de marca: colores FIJOS, idénticos en light y dark
      // (intencionalmente NO dependen del palette). No agregar borde por defecto.
      backgroundColor: '#3C3489',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    brandSymbolLetter: {
      fontSize: 34,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    brandSymbolDot: {
      position: 'absolute',
      bottom: 9,
      right: 9,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: '#6C5CE7',
    },
    title: {
      fontSize: 26,
      fontWeight: '700',
      color: c.text.primary,
      textAlign: 'center',
    },
    tagline: {
      marginTop: 6,
      fontSize: 13,
      color: c.text.tertiary,
      textAlign: 'center',
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.input.bg,
      borderWidth: 1,
      borderColor: c.input.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      marginBottom: 16,
    },
    inputIcon: {
      marginRight: 10,
    },
    inputField: {
      flex: 1,
      paddingVertical: 14,
      fontSize: 16,
      color: c.text.primary,
    },
    passwordToggle: {
      padding: 6,
      marginLeft: 4,
      justifyContent: 'center',
      alignItems: 'center',
    },
    button: {
      backgroundColor: c.mode === 'dark' ? c.action.bright : c.action.base,
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 8,
    },
    buttonDisabled: {
      opacity: 0.85,
    },
    buttonLoading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    buttonText: {
      fontSize: 16,
      fontWeight: '600',
      color: c.onAction,
    },
    recoveryLinks: {
      marginTop: 18,
      gap: 10,
      alignItems: 'center',
    },
    recoveryLink: {
      color: c.link,
      fontSize: 14,
      fontWeight: '500',
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: c.backdrop,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    modalCard: {
      width: '100%',
      backgroundColor: c.surface.card,
      borderRadius: 14,
      padding: 18,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: c.text.primary,
    },
    modalHint: {
      marginTop: 6,
      marginBottom: 14,
      color: c.text.secondary,
      fontSize: 14,
    },
    modalInput: {
      backgroundColor: c.input.bg,
      borderWidth: 1,
      borderColor: c.input.border,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      color: c.text.primary,
    },
    modalActions: {
      marginTop: 16,
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 10,
    },
    modalButtonGhost: {
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    modalButtonGhostText: {
      color: c.text.secondary,
      fontWeight: '600',
    },
    modalButton: {
      backgroundColor: c.mode === 'dark' ? c.action.bright : c.action.base,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 16,
      minWidth: 86,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalButtonText: {
      color: c.onAction,
      fontWeight: '700',
      fontSize: 14,
    },
  });
