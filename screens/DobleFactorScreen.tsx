import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';

/**
 * B3 (16/11/2026): doble factor obligatorio para admin, RRHH, dueño del grupo,
 * contador, auditor y CEO. Sin el código, la base de datos solo les da lo de un
 * colaborador; por eso se puede «continuar solo con Mi Portal».
 */
export default function DobleFactorScreen({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState('');

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data, error: e } = await supabase.auth.mfa.listFactors();
      if (cancel) return;
      if (e) {
        setError(e.message);
        setBusy(false);
        return;
      }
      const verified = data?.totp?.find((f) => f.status === 'verified');
      if (verified) {
        setFactorId(verified.id);
        setBusy(false);
        return;
      }
      // Limpiar enrolamientos sin terminar (no se permiten dos con el mismo nombre).
      for (const f of data?.all ?? []) {
        if (f.factor_type === 'totp' && f.status !== 'verified') {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }
      const { data: en, error: ee } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `QuantixHR móvil ${new Date().toISOString().slice(0, 10)}`,
      });
      if (cancel) return;
      if (ee || !en) {
        setError(ee?.message ?? 'No se pudo iniciar el doble factor.');
      } else {
        setFactorId(en.id);
        setSecret(en.totp.secret);
        setUri(en.totp.uri);
      }
      setBusy(false);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const verify = async () => {
    if (!factorId || code.trim().length !== 6) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    if (e) {
      setError('Código incorrecto o vencido. Usa el código actual de tu app.');
      setBusy(false);
      return;
    }
    // La sesión ya es aal2; refrescar para que todas las consultas usen el token nuevo.
    await supabase.auth.refreshSession();
    onDone();
  };

  const enrolling = !!secret;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Verificación en dos pasos</Text>
          <Text style={styles.text}>
            Tu cuenta administra datos de personas (salarios, expedientes), por eso exige un código de tu app de
            autenticación.
          </Text>

          {busy && !factorId ? (
            <ActivityIndicator style={{ marginTop: 24 }} color={theme.primary} />
          ) : (
            <>
              {enrolling && (
                <View style={styles.card}>
                  <Text style={styles.step}>1. Agrega QuantixHR a tu app de autenticación</Text>
                  <Text style={styles.small}>
                    Usa Google Authenticator, Microsoft Authenticator o 1Password. Si la tienes en este teléfono, toca el
                    botón; si no, agrega la clave a mano.
                  </Text>
                  {uri && (
                    <TouchableOpacity style={styles.secondary} onPress={() => void Linking.openURL(uri)}>
                      <Text style={styles.secondaryText}>Abrir en mi app de autenticación</Text>
                    </TouchableOpacity>
                  )}
                  <View style={styles.secretBox}>
                    <Text selectable style={styles.secret}>{secret}</Text>
                    <Text style={styles.small}>Mantén presionada la clave para copiarla</Text>
                  </View>
                  <Text style={styles.step}>2. Escribe el código de 6 dígitos</Text>
                </View>
              )}
              {!enrolling && <Text style={styles.text}>Escribe el código de 6 dígitos de tu app de autenticación.</Text>}

              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                placeholder="123456"
                maxLength={6}
                style={styles.input}
                onSubmitEditing={() => void verify()}
              />
              {error && <Text style={styles.error}>{error}</Text>}
              <TouchableOpacity
                style={[styles.primary, (busy || code.length !== 6) && { opacity: 0.5 }]}
                disabled={busy || code.length !== 6}
                onPress={() => void verify()}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Verificar</Text>}
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity style={styles.link} onPress={onSkip}>
            <Text style={styles.linkText}>Continuar solo con Mi Portal</Text>
          </TouchableOpacity>
          <Text style={styles.small}>
            Sin el código puedes marcar y ver lo tuyo (vacaciones, colillas), pero no las funciones administrativas. Si
            perdiste tu teléfono, pide a otro administrador que restablezca tu doble factor (Configuración → Usuarios).
          </Text>
          <TouchableOpacity style={styles.link} onPress={() => void supabase.auth.signOut()}>
            <Text style={[styles.linkText, { color: '#64748b' }]}>Cerrar sesión</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.background },
  container: { padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '800', color: theme.textPrimary },
  text: { fontSize: 14, color: theme.textPrimary, lineHeight: 20 },
  small: { fontSize: 12, color: '#64748b', lineHeight: 17 },
  step: { fontSize: 14, fontWeight: '700', color: theme.textPrimary, marginTop: 4 },
  card: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, padding: 14, gap: 8 },
  secretBox: { backgroundColor: '#f1f5f9', borderRadius: 12, padding: 12, alignItems: 'center', gap: 4 },
  secret: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 14, color: '#0f172a' },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingVertical: 12,
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
    color: theme.textPrimary,
    backgroundColor: '#fff',
  },
  error: { color: '#dc2626', fontSize: 13 },
  primary: { backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondary: { borderWidth: 1, borderColor: theme.primary, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  secondaryText: { color: theme.primary, fontWeight: '700' },
  link: { alignItems: 'center', paddingVertical: 8 },
  linkText: { color: theme.primary, fontWeight: '700', fontSize: 14 },
});
