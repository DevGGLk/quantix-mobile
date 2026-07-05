import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';
import { sendJayChat, type JayChatMessage, type JayToolCall } from '../lib/jayApi';

/** Mensaje tal cual se muestra en pantalla (incluye estado de error y tools ejecutadas). */
type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
  toolCalls?: JayToolCall[];
};

const SUGGESTIONS = [
  '¿Cuántas horas trabajé esta quincena?',
  '¿Tengo tardanzas este mes?',
  '¿Cuántos días de vacaciones me quedan?',
] as const;

/** Etiquetas legibles para las herramientas más comunes (fallback: el nombre crudo). */
const TOOL_LABELS: Record<string, string> = {
  get_employee_attendance: 'Asistencia',
  search_company_policy: 'Reglamento',
  module_help: 'Ayuda',
  disciplinary_status: 'Disciplina',
  academy_status: 'Academia',
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, ' ');
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `m_${Date.now()}_${idCounter}`;
}

const HISTORY_KEY = (userId: string) => `jay_chat_history_${userId}`;
/** Solo persistimos mensajes correctos (los de error son efímeros). */
const MAX_PERSISTED = 60;

export default function AsistenteScreen() {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const userId = session?.user?.id ?? null;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Hidratar historial persistido al montar / cambiar de usuario.
  useEffect(() => {
    let active = true;
    (async () => {
      if (!userId) {
        setMessages([]);
        setHydrated(true);
        return;
      }
      try {
        const raw = await AsyncStorage.getItem(HISTORY_KEY(userId));
        if (!active) return;
        if (raw) {
          const parsed = JSON.parse(raw) as ChatMessage[];
          if (Array.isArray(parsed)) setMessages(parsed);
        }
      } catch {
        // historial corrupto: arrancamos limpio
      } finally {
        if (active) setHydrated(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  // Persistir historial (sin mensajes de error) cuando cambia.
  useEffect(() => {
    if (!hydrated || !userId) return;
    const toStore = messages.filter((m) => !m.isError).slice(-MAX_PERSISTED);
    AsyncStorage.setItem(HISTORY_KEY(userId), JSON.stringify(toStore)).catch(() => {});
  }, [messages, hydrated, userId]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || sending) return;

      const userMsg: ChatMessage = { id: nextId(), role: 'user', content: clean };
      // Historial a enviar = conversación previa (sin errores) + el nuevo mensaje.
      const priorHistory: JayChatMessage[] = messages
        .filter((m) => !m.isError)
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setSending(true);
      scrollToEnd();

      const result = await sendJayChat([...priorHistory, { role: 'user', content: clean }]);

      setMessages((prev) => {
        const assistant: ChatMessage = result.ok
          ? {
              id: nextId(),
              role: 'assistant',
              content: result.message.content,
              toolCalls: result.tool_calls.length ? result.tool_calls : undefined,
            }
          : {
              id: nextId(),
              role: 'assistant',
              content: result.error,
              isError: true,
            };
        return [...prev, assistant];
      });
      setSending(false);
      scrollToEnd();
    },
    [messages, sending, scrollToEnd]
  );

  const clearHistory = useCallback(() => {
    setMessages([]);
    if (userId) AsyncStorage.removeItem(HISTORY_KEY(userId)).catch(() => {});
  }, [userId]);

  const showWelcome = messages.length === 0 && !sending;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Cabecera */}
      <View style={styles.header}>
        <View style={styles.headerAvatar}>
          <Ionicons name="sparkles" size={20} color="#FFFFFF" />
        </View>
        <View style={styles.headerTexts}>
          <Text style={styles.headerTitle}>Asistente Jay</Text>
          <Text style={styles.headerSubtitle}>Tu copiloto laboral</Text>
        </View>
        {messages.length > 0 && (
          <TouchableOpacity
            onPress={clearHistory}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Borrar conversación"
          >
            <Ionicons name="trash-outline" size={20} color="rgba(255,255,255,0.85)" />
          </TouchableOpacity>
        )}
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.messagesContent}
          onContentSizeChange={scrollToEnd}
          keyboardShouldPersistTaps="handled"
        >
          {showWelcome ? (
            <View style={styles.welcomeCard}>
              <Text style={styles.welcomeTitle}>¡Hola! Soy Jay 👋</Text>
              <Text style={styles.welcomeText}>
                Puedo ayudarte con tus horas, tardanzas, vacaciones, el reglamento de tu empresa y más.
                Pregúntame algo o toca una sugerencia:
              </Text>
              <View style={styles.suggestionsWrap}>
                {SUGGESTIONS.map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={styles.suggestionChip}
                    onPress={() => void send(s)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.suggestionText}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}

          {sending && (
            <View style={[styles.bubble, styles.assistantBubble, styles.typingBubble]}>
              <ActivityIndicator size="small" color={theme.primary} />
              <Text style={styles.typingText}>Jay está escribiendo…</Text>
            </View>
          )}
        </ScrollView>

        {/* Barra de entrada */}
        <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Escribe tu pregunta…"
            placeholderTextColor={theme.textMuted}
            multiline
            editable={!sending}
            onSubmitEditing={() => void send(input)}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!input.trim() || sending) && styles.sendButtonDisabled]}
            onPress={() => void send(input)}
            disabled={!input.trim() || sending}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Enviar mensaje"
          >
            <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <View style={[styles.bubbleRow, isUser ? styles.rowEnd : styles.rowStart]}>
      <View
        style={[
          styles.bubble,
          isUser ? styles.userBubble : styles.assistantBubble,
          message.isError && styles.errorBubble,
        ]}
      >
        <Text style={isUser ? styles.userText : message.isError ? styles.errorText : styles.assistantText}>
          {message.content}
        </Text>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <View style={styles.toolsWrap}>
            {message.toolCalls.map((t, i) => (
              <View
                key={`${t.name}_${i}`}
                style={[styles.toolBadge, t.ok ? styles.toolBadgeOk : styles.toolBadgeErr]}
              >
                <Ionicons
                  name={t.ok ? 'checkmark-circle' : 'close-circle'}
                  size={12}
                  color={t.ok ? theme.success : theme.danger}
                />
                <Text style={styles.toolBadgeText}>{toolLabel(t.name)}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.primary,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTexts: { flex: 1 },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 1,
  },
  messagesContent: {
    padding: 16,
    gap: 12,
    paddingBottom: 8,
  },
  welcomeCard: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: theme.border,
  },
  welcomeTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: theme.textPrimary,
    marginBottom: 8,
  },
  welcomeText: {
    fontSize: 14,
    lineHeight: 21,
    color: theme.textSecondary,
    marginBottom: 14,
  },
  suggestionsWrap: { gap: 8 },
  suggestionChip: {
    backgroundColor: theme.subtleBackground,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: theme.accent,
  },
  suggestionText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.primary,
  },
  bubbleRow: {
    flexDirection: 'row',
  },
  rowEnd: { justifyContent: 'flex-end' },
  rowStart: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '86%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userBubble: {
    backgroundColor: theme.primary,
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderBottomLeftRadius: 4,
  },
  errorBubble: {
    backgroundColor: '#FEF2F2',
    borderColor: theme.danger,
  },
  userText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 21,
  },
  assistantText: {
    color: theme.textPrimary,
    fontSize: 15,
    lineHeight: 21,
  },
  errorText: {
    color: '#991B1B',
    fontSize: 14,
    lineHeight: 20,
  },
  toolsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  toolBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderWidth: 1,
  },
  toolBadgeOk: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  toolBadgeErr: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  toolBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.textSecondary,
    textTransform: 'capitalize',
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
  },
  typingText: {
    color: theme.textSecondary,
    fontSize: 14,
    fontStyle: 'italic',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: theme.surface,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: theme.background,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 12 : 8,
    paddingBottom: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 15,
    color: theme.textPrimary,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: theme.textMuted,
  },
});
