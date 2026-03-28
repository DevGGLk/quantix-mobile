import React, { useRef, useState } from 'react';
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

import { getPasswordRecoveryRedirectUrl } from '../lib/authRedirect';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';

type LoginScreenProps = {
  onLoginSuccess?: () => void;
};

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
          <Text style={styles.title}>Quantix HR</Text>

          <TextInput
            style={styles.input}
            placeholder="Correo Electrónico"
            placeholderTextColor="#94a3b8"
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

          <TextInput
            ref={passwordRef}
            style={styles.input}
            placeholder="Contraseña"
            placeholderTextColor="#94a3b8"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!isLoading}
            returnKeyType="go"
            onSubmitEditing={() => {
              if (!isLoading) void handleLogin();
            }}
          />

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleLogin}
            activeOpacity={0.85}
            disabled={isLoading}
          >
            {isLoading ? (
              <View style={styles.buttonLoading}>
                <ActivityIndicator color="#ffffff" size="small" />
                <Text style={styles.buttonText}>Ingresando...</Text>
              </View>
            ) : (
              <Text style={styles.buttonText}>Iniciar Sesión</Text>
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
              placeholderTextColor="#94a3b8"
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
                  <ActivityIndicator color="#ffffff" size="small" />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  keyboardView: {
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: theme.textPrimary,
    textAlign: 'center',
    marginBottom: 40,
  },
  input: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#0f172a',
    marginBottom: 16,
  },
  button: {
    backgroundColor: theme.primary,
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
    color: '#ffffff',
  },
  recoveryLinks: {
    marginTop: 18,
    gap: 10,
    alignItems: 'center',
  },
  recoveryLink: {
    color: theme.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 18,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  modalHint: {
    marginTop: 6,
    marginBottom: 14,
    color: theme.textSecondary,
    fontSize: 14,
  },
  modalInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#0f172a',
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
    color: theme.textSecondary,
    fontWeight: '600',
  },
  modalButton: {
    backgroundColor: theme.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    minWidth: 86,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
});
