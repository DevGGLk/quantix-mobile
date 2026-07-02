import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useDeferredValue } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
  TextInput,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';
import { useAuth } from '../lib/AuthContext';

type ChapterRow = {
  id: string;
  title: string;
  content: string;
};

type MdSection = {
  anchorKey: string;
  chipLabel: string;
  markdown: string;
};

function slugifyKey(label: string, index: number): string {
  const base = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `${base || 'sec'}-${index}`;
}

/** Título para chip: `##` + subtítulo de la siguiente `###` / `####` o primera línea tipo título. */
function chipLabelFromSectionMarkdown(part: string, idx: number): string {
  const trimmed = part.trim();
  const firstNl = trimmed.indexOf('\n');
  const firstLine = firstNl === -1 ? trimmed : trimmed.slice(0, firstNl);
  const rest = firstNl === -1 ? '' : trimmed.slice(firstNl + 1);

  if (!/^##\s+/.test(firstLine)) {
    return idx === 0 ? 'Contenido' : `Sección ${idx + 1}`;
  }

  const base = firstLine.replace(/^##\s+/, '').trim() || `Sección ${idx + 1}`;
  const lines = rest.split('\n');
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    if (/^##\s/.test(t)) break;
    const sm = /^###\s+(.+)$/.exec(t) || /^####\s+(.+)$/.exec(t);
    if (sm) {
      const sub = sm[1].trim().replace(/[`#]/g, '').slice(0, 160);
      if (sub && base.toLowerCase() !== sub.toLowerCase()) {
        return `${base}: ${sub}`;
      }
      continue;
    }
    if (!t.startsWith('#') && t.length >= 6) {
      const looksTitle =
        /:/.test(t) ||
        /^(título|titulo|capítulo|capitulo|artículo|articulo|ámbito|ambito)\b/i.test(t);
      if (looksTitle) {
        return `${base}: ${t.replace(/[`#]/g, '').slice(0, 160)}`;
      }
    }
    if (t.startsWith('#')) break;
  }
  return base;
}

/** Trocea el Markdown por encabezados `##` para chips + scroll por sección. */
function parseSectionsFromMarkdown(source: string): MdSection[] {
  const trimmed = source.trim();
  if (!trimmed) return [];

  if (!/^##\s+/m.test(trimmed)) {
    return [{ anchorKey: 'sec-0', chipLabel: 'Contenido', markdown: trimmed }];
  }

  const parts = trimmed.split(/\n(?=##\s+)/);
  const out: MdSection[] = [];
  let idx = 0;
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const firstLineEnd = part.indexOf('\n');
    const first = firstLineEnd === -1 ? part : part.slice(0, firstLineEnd);

    if (/^##\s+/.test(first)) {
      const chipLabel = chipLabelFromSectionMarkdown(part, idx);
      const anchorBase = first.replace(/^##\s+/, '').trim() || `Sección ${idx + 1}`;
      out.push({
        anchorKey: slugifyKey(anchorBase, idx),
        chipLabel,
        markdown: part,
      });
      idx += 1;
    } else {
      out.push({
        anchorKey: `intro-${idx}`,
        chipLabel: 'Inicio',
        markdown: part,
      });
      idx += 1;
    }
  }
  return out;
}

function buildCombinedMarkdown(rows: ChapterRow[]): string {
  if (rows.length === 0) return '';
  return rows
    .map((ch) => {
      const t = (ch.title || 'Capítulo').trim();
      const body = (ch.content || '').trim();
      return `## ${t}\n\n${body}`;
    })
    .join('\n\n');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripCodeFences(md: string): string {
  const lines = md.split('\n');
  let fence = false;
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('```')) {
      fence = !fence;
      continue;
    }
    if (!fence) out.push(line);
  }
  return out.join('\n');
}

function countMatchesInSectionMarkdown(sectionMd: string, query: string): number {
  const q = query.trim();
  if (!q) return 0;
  const text = stripCodeFences(sectionMd);
  const re = new RegExp(escapeRegExp(q), 'gi');
  let c = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    c++;
    if (m[0].length === 0) re.lastIndex++;
  }
  return c;
}

/** Orden de aparición: una entrada por coincidencia (para scroll / contador). */
function buildMatchNavigationAnchors(sections: MdSection[], query: string): string[] {
  const q = query.trim();
  if (!q) return [];
  const out: string[] = [];
  for (const s of sections) {
    const text = stripCodeFences(s.markdown);
    const re = new RegExp(escapeRegExp(q), 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push(s.anchorKey);
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return out;
}

function markdownThemeStyles(): Record<string, object> {
  return {
    body: {
      color: theme.textPrimary,
      fontSize: 15,
      lineHeight: 24,
    },
    heading1: {
      color: theme.textPrimary,
      fontSize: 22,
      fontWeight: '800' as const,
      marginTop: 16,
      marginBottom: 8,
    },
    heading2: {
      color: theme.textPrimary,
      fontSize: 18,
      fontWeight: '800' as const,
      marginTop: 14,
      marginBottom: 6,
    },
    heading3: {
      color: theme.textPrimary,
      fontSize: 16,
      fontWeight: '700' as const,
      marginTop: 12,
      marginBottom: 4,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: 10,
      color: theme.textSecondary,
      fontSize: 15,
      lineHeight: 22,
    },
    strong: {
      fontWeight: '800' as const,
      color: theme.textPrimary,
    },
    em: {
      fontStyle: 'italic' as const,
      color: theme.textSecondary,
    },
    link: {
      color: theme.primary,
      textDecorationLine: 'underline' as const,
    },
    bullet_list: {
      marginBottom: 10,
    },
    ordered_list: {
      marginBottom: 10,
    },
    list_item: {
      marginBottom: 4,
    },
    blockquote: {
      backgroundColor: theme.background,
      borderLeftColor: theme.primary,
      borderLeftWidth: 4,
      paddingLeft: 10,
      marginVertical: 8,
    },
    code_inline: {
      backgroundColor: theme.border,
      color: theme.textPrimary,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
      paddingHorizontal: 4,
      borderRadius: 4,
    },
    fence: {
      backgroundColor: '#1e293b',
      color: '#f1f5f9',
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
      padding: 12,
      borderRadius: 8,
      marginVertical: 8,
    },
    hr: {
      backgroundColor: theme.border,
      height: 1,
      marginVertical: 16,
    },
    table: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 8,
      marginVertical: 10,
    },
    tr: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    th: {
      padding: 8,
      fontWeight: '700' as const,
      color: theme.textPrimary,
      backgroundColor: theme.background,
    },
    td: {
      padding: 8,
      color: theme.textSecondary,
    },
  };
}

type ReglamentoMarkdownSectionProps = {
  markdown: string;
  anchorKey: string;
  baseOrdinal: number;
  appliedQuery: string;
  activeMatchOrdinal: number;
  matchesCount: number;
  mdStyles: Record<string, object>;
};

function ReglamentoMarkdownSection({
  markdown,
  anchorKey: _anchorKey,
  baseOrdinal,
  appliedQuery,
  activeMatchOrdinal,
  matchesCount,
  mdStyles,
}: ReglamentoMarkdownSectionProps) {
  const localOrdinal = useRef(0);
  localOrdinal.current = 0;

  const rules = useMemo(
    () => ({
      text: (
        node: { key: string; content?: string },
        _c: unknown,
        _p: unknown,
        styles: Record<string, object | undefined>,
        inheritedStyles: Record<string, object | undefined> = {},
      ) => {
        const raw = node.content ?? '';
        const q = appliedQuery.trim();
        if (!q) {
          return (
            <Text key={node.key} style={[inheritedStyles as object, styles.text]}>
              {raw}
            </Text>
          );
        }
        const re = new RegExp(`(${escapeRegExp(q)})`, 'gi');
        const parts = raw.split(re);
        if (parts.length === 1) {
          return (
            <Text key={node.key} style={[inheritedStyles as object, styles.text]}>
              {raw}
            </Text>
          );
        }
        return (
          <Text key={node.key} style={[inheritedStyles as object, styles.text]}>
            {parts.map((part, i) => {
              if (i % 2 === 0) {
                return <React.Fragment key={i}>{part}</React.Fragment>;
              }
              const globalOrd = baseOrdinal + localOrdinal.current;
              localOrdinal.current += 1;
              const isActive =
                matchesCount > 0 && globalOrd >= 0 && globalOrd < matchesCount && activeMatchOrdinal === globalOrd;
              return (
                <Text
                  key={i}
                  style={{
                    backgroundColor: isActive ? 'rgba(250, 204, 21, 0.92)' : 'rgba(253, 224, 71, 0.5)',
                    borderRadius: 3,
                  }}
                >
                  {part}
                </Text>
              );
            })}
          </Text>
        );
      },
    }),
    [appliedQuery, activeMatchOrdinal, baseOrdinal, matchesCount],
  );

  return (
    <Markdown style={mdStyles} rules={rules}>
      {markdown}
    </Markdown>
  );
}

export default function ReglamentoScreen() {
  const { employee, profile } = useAuth();
  const [combinedMarkdown, setCombinedMarkdown] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const deferredSearch = useDeferredValue(searchInput);
  const appliedQuery = useMemo(() => deferredSearch.trim(), [deferredSearch]);
  const [activeAnchor, setActiveAnchor] = useState<string | null>(null);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const chipScrollRef = useRef<ScrollView>(null);
  const offsetY = useRef<Record<string, number>>({});

  const companyId = useMemo(
    () => (employee?.company_id ?? profile?.company_id ?? null)?.trim() || null,
    [employee?.company_id, profile?.company_id]
  );

  const branchId = useMemo(
    () => (employee?.branch_id ?? null)?.trim() || null,
    [employee?.branch_id]
  );

  const loadReglamento = useCallback(async () => {
    try {
      setIsLoading(true);
      if (!companyId) {
        setCombinedMarkdown('');
        return;
      }

      let md = '';

      // Fuente autoritativa (misma que la web): reglamento por sucursal en `branches.rulebook`.
      if (branchId) {
        const { data: br, error: brErr } = await supabase
          .from('branches')
          .select('rulebook')
          .eq('id', branchId)
          .eq('company_id', companyId)
          .maybeSingle();
        if (!brErr && br) {
          md = String((br as { rulebook?: unknown }).rulebook ?? '').trim();
        }
      }

      // Fallback 1: capítulos en `company_policies` (esquema alternativo por empresa).
      if (!md.trim()) {
        const { data, error } = await supabase
          .from('company_policies')
          .select('id, title, content, order_index')
          .eq('company_id', companyId)
          .order('order_index', { ascending: true });

        if (error) throw error;

        const rows: ChapterRow[] = (data ?? []).map((row: Record<string, unknown>) => ({
          id: String(row.id ?? ''),
          title: typeof row.title === 'string' ? row.title : '',
          content: typeof row.content === 'string' ? row.content : '',
        }));

        md = buildCombinedMarkdown(rows);
      }

      // Fallback 2: legado en `companies.settings.reglamento_interno`.
      if (!md.trim()) {
        const { data: comp, error: compErr } = await supabase
          .from('companies')
          .select('settings')
          .eq('id', companyId)
          .maybeSingle();
        if (!compErr && comp) {
          const settings = (comp as { settings?: unknown }).settings;
          const legacy =
            settings && typeof settings === 'object' && settings !== null
              ? String((settings as Record<string, unknown>).reglamento_interno ?? '').trim()
              : '';
          if (legacy) {
            md = legacy;
          }
        }
      }

      setCombinedMarkdown(md);
    } catch (e) {
      console.error('Error en ReglamentoScreen:', e);
      setCombinedMarkdown('');
      Alert.alert(
        'Error de Conexión',
        'No pudimos cargar el reglamento. Revisa tu conexión o intenta más tarde.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [companyId, branchId]);

  useEffect(() => {
    void loadReglamento();
  }, [loadReglamento]);

  const allSections = useMemo(() => parseSectionsFromMarkdown(combinedMarkdown), [combinedMarkdown]);

  const visibleSections = useMemo(() => {
    const q = appliedQuery.toLowerCase();
    if (!q) return allSections;
    return allSections.filter((s) => {
      const blob = `${s.chipLabel}\n${s.markdown}`.toLowerCase();
      return blob.includes(q);
    });
  }, [allSections, appliedQuery]);

  const mdStyles = useMemo(() => markdownThemeStyles(), []);

  const matchNavAnchors = useMemo(
    () => buildMatchNavigationAnchors(visibleSections, appliedQuery),
    [visibleSections, appliedQuery],
  );
  const matchesCount = matchNavAnchors.length;

  const sectionOrdinalStart = useMemo(() => {
    const m = new Map<string, number>();
    let cum = 0;
    for (const s of visibleSections) {
      m.set(s.anchorKey, cum);
      cum += countMatchesInSectionMarkdown(s.markdown, appliedQuery);
    }
    return m;
  }, [visibleSections, appliedQuery]);

  const prevAppliedQueryRef = useRef(appliedQuery);
  useEffect(() => {
    if (prevAppliedQueryRef.current !== appliedQuery) {
      prevAppliedQueryRef.current = appliedQuery;
      setCurrentMatchIndex(0);
      return;
    }
    setCurrentMatchIndex((i) => {
      if (matchesCount === 0) return 0;
      return Math.min(Math.max(0, i), matchesCount - 1);
    });
  }, [appliedQuery, matchesCount]);

  const scrollToAnchor = useCallback((anchorKey: string) => {
    setActiveAnchor(anchorKey);
    const y = offsetY.current[anchorKey];
    if (y == null || Number.isNaN(y)) {
      requestAnimationFrame(() => {
        const y2 = offsetY.current[anchorKey];
        if (y2 != null && scrollRef.current) {
          scrollRef.current.scrollTo({ y: Math.max(0, y2 - 12), animated: true });
        }
      });
      return;
    }
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
  }, []);

  useLayoutEffect(() => {
    if (matchesCount === 0) return;
    const anchor = matchNavAnchors[currentMatchIndex];
    if (!anchor) return;
    setActiveAnchor(anchor);
    const y = offsetY.current[anchor];
    const doScroll = (yy: number) => {
      scrollRef.current?.scrollTo({ y: Math.max(0, yy - 12), animated: true });
    };
    if (y == null || Number.isNaN(y)) {
      requestAnimationFrame(() => {
        const y2 = offsetY.current[anchor];
        if (y2 != null) doScroll(y2);
      });
      return;
    }
    doScroll(y);
  }, [currentMatchIndex, matchNavAnchors, matchesCount]);

  const goPrevMatch = useCallback(() => {
    if (matchesCount === 0) return;
    setCurrentMatchIndex((i) => (i - 1 + matchesCount) % matchesCount);
  }, [matchesCount]);

  const goNextMatch = useCallback(() => {
    if (matchesCount === 0) return;
    setCurrentMatchIndex((i) => (i + 1) % matchesCount);
  }, [matchesCount]);

  const hasContent = combinedMarkdown.trim().length > 0;
  const showEmpty = !isLoading && !hasContent;
  const showNoMatches = hasContent && visibleSections.length === 0 && appliedQuery.length > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.container}>
        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={20} color={theme.textMuted} style={styles.searchIcon} />
          <TextInput
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder="Buscar en el reglamento…"
            placeholderTextColor={theme.textMuted}
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
            {...(Platform.OS === 'ios' ? { clearButtonMode: 'while-editing' as const } : {})}
          />
          {matchesCount > 0 ? (
            <View style={styles.matchNav}>
              <Text style={styles.matchNavCounter} accessibilityLiveRegion="polite">
                {currentMatchIndex + 1} de {matchesCount}
              </Text>
              <View style={styles.matchNavArrows}>
                <Pressable
                  onPress={goPrevMatch}
                  hitSlop={8}
                  style={styles.matchNavBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Coincidencia anterior"
                >
                  <Ionicons name="chevron-up" size={20} color={theme.primary} />
                </Pressable>
                <Pressable
                  onPress={goNextMatch}
                  hitSlop={8}
                  style={styles.matchNavBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Siguiente coincidencia"
                >
                  <Ionicons name="chevron-down" size={20} color={theme.primary} />
                </Pressable>
              </View>
            </View>
          ) : null}
          {searchInput.length > 0 ? (
            <Pressable onPress={() => setSearchInput('')} hitSlop={12} accessibilityLabel="Limpiar búsqueda">
              <Ionicons name="close-circle" size={22} color={theme.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {!isLoading && hasContent && allSections.length > 0 ? (
          <View style={styles.chipsBar}>
            <ScrollView
              ref={chipScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsContent}
            >
              {allSections.map((s) => {
                const hiddenBySearch =
                  appliedQuery.length > 0 &&
                  !`${s.chipLabel}\n${s.markdown}`.toLowerCase().includes(appliedQuery.toLowerCase());
                return (
                  <TouchableOpacity
                    key={s.anchorKey}
                    activeOpacity={0.85}
                    disabled={hiddenBySearch}
                    onPress={() => scrollToAnchor(s.anchorKey)}
                    style={[
                      styles.chip,
                      activeAnchor === s.anchorKey && styles.chipActive,
                      hiddenBySearch && styles.chipDimmed,
                    ]}
                  >
                    <Text
                      style={[styles.chipText, activeAnchor === s.anchorKey && styles.chipTextActive]}
                      numberOfLines={2}
                    >
                      {s.chipLabel}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={styles.loaderText}>Cargando reglamento…</Text>
          </View>
        ) : showEmpty ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="document-text-outline" size={48} color={theme.textMuted} />
            <Text style={styles.emptyTitle}>Reglamento no disponible</Text>
            <Text style={styles.emptySub}>
              {companyId
                ? 'Tu empresa aún no ha publicado políticas en el sistema.'
                : 'No se detectó empresa en tu perfil. Contacta a RRHH.'}
            </Text>
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
          >
            {showNoMatches ? (
              <View style={styles.noMatch}>
                <Text style={styles.noMatchText}>Sin coincidencias para «{appliedQuery}».</Text>
                <Text style={styles.noMatchHint}>Prueba otra palabra o borra el filtro.</Text>
              </View>
            ) : (
              visibleSections.map((s) => (
                <View
                  key={s.anchorKey}
                  onLayout={(e) => {
                    offsetY.current[s.anchorKey] = e.nativeEvent.layout.y;
                  }}
                  style={styles.section}
                >
                  <ReglamentoMarkdownSection
                    markdown={s.markdown}
                    anchorKey={s.anchorKey}
                    baseOrdinal={sectionOrdinalStart.get(s.anchorKey) ?? 0}
                    appliedQuery={appliedQuery}
                    activeMatchOrdinal={currentMatchIndex}
                    matchesCount={matchesCount}
                    mdStyles={mdStyles}
                  />
                </View>
              ))
            )}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.background,
  },
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: theme.backgroundAlt,
    borderWidth: 1,
    borderColor: theme.border,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: theme.textPrimary,
    paddingVertical: Platform.OS === 'ios' ? 4 : 2,
    minWidth: 0,
  },
  matchNav: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 4,
    gap: 4,
  },
  matchNavCounter: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.textSecondary,
    minWidth: 52,
    textAlign: 'right',
  },
  matchNavArrows: {
    flexDirection: 'column',
    justifyContent: 'center',
  },
  matchNavBtn: {
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  chipsBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
    backgroundColor: theme.backgroundAlt,
    paddingBottom: 10,
  },
  chipsContent: {
    paddingHorizontal: 12,
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.background,
    borderWidth: 1,
    borderColor: theme.border,
    marginRight: 8,
  },
  chipActive: {
    borderColor: theme.primary,
    backgroundColor: 'rgba(0, 194, 209, 0.12)',
  },
  chipDimmed: {
    opacity: 0.35,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.textSecondary,
    maxWidth: 280,
  },
  chipTextActive: {
    color: theme.primary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 20,
  },
  loaderWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loaderText: {
    fontSize: 14,
    color: theme.textSecondary,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: theme.textPrimary,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 14,
    color: theme.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  noMatch: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  noMatchText: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.textPrimary,
    textAlign: 'center',
  },
  noMatchHint: {
    marginTop: 6,
    fontSize: 13,
    color: theme.textSecondary,
    textAlign: 'center',
  },
});
