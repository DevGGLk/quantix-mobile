/**
 * Capa de datos Supabase compartida por pantallas móviles (onboarding, etc.).
 * Tras aplicar migraciones: `npm run gen:types` (ver README del proyecto).
 */
import { supabase } from './supabase';
import { ONBOARDING_ACADEMY_COURSE_CATEGORY } from '../constants/onboarding';

export { ONBOARDING_ACADEMY_COURSE_CATEGORY } from '../constants/onboarding';

/**
 * Separación identidad (`profiles`) vs empleo (`employees`): solo quien tiene expediente
 * vinculado (p. ej. `user_id` = auth user) es colaborador operativo para inducción / GPS laboral.
 */
export function hasOperativeEmployeeRecord(
  employee: { id?: string | null } | null | undefined
): boolean {
  const id = employee?.id != null ? String(employee.id).trim() : '';
  return id.length > 0;
}

function logApiSupabaseError(
  fn: string,
  err: {
    message: string;
    code?: string;
    details?: string | null;
    hint?: string | null;
  } | null | undefined
) {
  if (!err) return;
  console.error(`API ERROR [${fn}]:`, {
    message: err.message,
    code: err.code,
    details: err.details,
    hint: err.hint,
  });
}

export type InductionQuizQuestion = {
  id: string;
  questionText: string;
  options: string[];
  correctAnswerIndex: number;
};

function parseOptions(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((o) => String(o ?? '').trim()).filter((s) => s.length > 0);
  }
  return [];
}

function normalizeQuestions(rows: Record<string, unknown>[]): InductionQuizQuestion[] {
  const out: InductionQuizQuestion[] = [];
  for (const row of rows) {
    const id = String(row.id ?? '');
    const questionText = String(row.question_text ?? '').trim();
    const options = parseOptions(row.options);
    const idxRaw = row.correct_answer_index;
    const correctAnswerIndex =
      typeof idxRaw === 'number' && Number.isFinite(idxRaw)
        ? Math.max(0, Math.floor(idxRaw))
        : Number.isFinite(Number(idxRaw))
          ? Math.max(0, Math.floor(Number(idxRaw)))
          : 0;
    if (!id || !questionText || options.length < 2) continue;
    const safeCorrect = Math.min(correctAnswerIndex, options.length - 1);
    out.push({ id, questionText, options, correctAnswerIndex: safeCorrect });
  }
  return out;
}

function isMissingDbColumn(
  err: { message?: string; details?: string | null; hint?: string | null; code?: string },
  name: string
) {
  const blob = `${err.message ?? ''} ${err.details ?? ''} ${err.hint ?? ''}`.toLowerCase();
  const n = name.toLowerCase();
  if (err.code === '42703') return blob.includes(n);
  return (
    blob.includes(n) &&
    (blob.includes('does not exist') || blob.includes('no existe') || blob.includes('unknown'))
  );
}

/**
 * Resuelve el curso de inducción del tenant (`courses.company_id`) con categoría o tag
 * «Inducción Obligatoria» y `is_published = true` cuando la columna exista en BD.
 * Sin IDs en variables de entorno.
 *
 * Tablas: `courses` → `course_modules` → `course_quizzes` → `quiz_questions`.
 */
export async function fetchInductionQuizQuestions(companyId: string): Promise<{
  questions: InductionQuizQuestion[];
  errorMessage: string | null;
  /** Sin error de red/RLS: no hay curso publicado acorde o no hay cuestionario usable. */
  inductionNotConfigured: boolean;
}> {
  const trimmedCompany = companyId.trim();
  if (!trimmedCompany) {
    console.error('API ERROR [fetchInductionQuizQuestions]:', 'companyId vacío o nulo');
    return {
      questions: [],
      errorMessage: 'Empresa no disponible.',
      inductionNotConfigured: false,
    };
  }

  const cat = ONBOARDING_ACADEMY_COURSE_CATEGORY;

  async function pickCourseId(opts: {
    match: 'category' | 'tag';
    requirePublished: boolean;
  }): Promise<{ id: string | null; error: { message: string; code?: string; details?: string | null } | null }> {
    let q = supabase
      .from('courses')
      .select('id')
      .eq('company_id', trimmedCompany)
      .order('created_at', { ascending: true })
      .limit(1);
    if (opts.match === 'category') {
      q = q.eq('category', cat);
    } else {
      q = q.eq('tag', cat);
    }
    if (opts.requirePublished) {
      q = q.eq('is_published', true);
    }
    const { data, error } = await q.maybeSingle();
    if (error) return { id: null, error };
    const id = (data as { id?: string } | null)?.id;
    return { id: id ? String(id) : null, error: null };
  }

  try {
    let courseId: string | null = null;

    let r = await pickCourseId({ match: 'category', requirePublished: true });
    if (r.error && isMissingDbColumn(r.error, 'is_published')) {
      r = await pickCourseId({ match: 'category', requirePublished: false });
    }
    if (r.error) {
      logApiSupabaseError('fetchInductionQuizQuestions.courses_category', r.error);
      return {
        questions: [],
        errorMessage: r.error.message,
        inductionNotConfigured: false,
      };
    }
    courseId = r.id;

    if (!courseId) {
      let t = await pickCourseId({ match: 'tag', requirePublished: true });
      if (t.error && isMissingDbColumn(t.error, 'tag')) {
        t = { id: null, error: null };
      } else if (t.error && isMissingDbColumn(t.error, 'is_published')) {
        t = await pickCourseId({ match: 'tag', requirePublished: false });
      }
      if (t.error) {
        logApiSupabaseError('fetchInductionQuizQuestions.courses_tag', t.error);
        return {
          questions: [],
          errorMessage: t.error.message,
          inductionNotConfigured: false,
        };
      }
      courseId = t.id;
    }

    if (!courseId) {
      return {
        questions: [],
        errorMessage: null,
        inductionNotConfigured: true,
      };
    }

    const { data: moduleRows, error: modErr } = await supabase
      .from('course_modules')
      .select('id')
      .eq('course_id', courseId)
      .order('order_index', { ascending: true });

    if (modErr) {
      logApiSupabaseError('fetchInductionQuizQuestions.course_modules', modErr);
      return {
        questions: [],
        errorMessage: modErr.message,
        inductionNotConfigured: false,
      };
    }
    const moduleIds = ((moduleRows ?? []) as { id: string }[]).map((m) => m.id).filter(Boolean);
    if (moduleIds.length === 0) {
      return {
        questions: [],
        errorMessage: null,
        inductionNotConfigured: true,
      };
    }

    const { data: quizRows, error: quizErr } = await supabase
      .from('course_quizzes')
      .select('id, module_id')
      .in('module_id', moduleIds);

    if (quizErr) {
      logApiSupabaseError('fetchInductionQuizQuestions.course_quizzes', quizErr);
      return {
        questions: [],
        errorMessage: quizErr.message,
        inductionNotConfigured: false,
      };
    }
    const quizzes = (quizRows ?? []) as { id: string; module_id: string }[];
    if (quizzes.length === 0) {
      return {
        questions: [],
        errorMessage: null,
        inductionNotConfigured: true,
      };
    }

    const order = new Map(moduleIds.map((id, i) => [id, i]));
    quizzes.sort((a, b) => (order.get(a.module_id) ?? 0) - (order.get(b.module_id) ?? 0));
    const firstQuizId = quizzes[0]?.id;
    if (!firstQuizId) {
      return {
        questions: [],
        errorMessage: null,
        inductionNotConfigured: true,
      };
    }

    const { data: qRows, error: qErr } = await supabase
      .from('quiz_questions')
      .select('id, question_text, options, correct_answer_index')
      .eq('quiz_id', firstQuizId)
      .order('id', { ascending: true });

    if (qErr) {
      logApiSupabaseError('fetchInductionQuizQuestions.quiz_questions', qErr);
      return {
        questions: [],
        errorMessage: qErr.message,
        inductionNotConfigured: false,
      };
    }
    const normalized = normalizeQuestions((qRows ?? []) as Record<string, unknown>[]);
    const questions = normalized.slice(0, 3);
    if (questions.length === 0) {
      return {
        questions: [],
        errorMessage: null,
        inductionNotConfigured: true,
      };
    }
    return {
      questions,
      errorMessage: null,
      inductionNotConfigured: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('API ERROR [fetchInductionQuizQuestions]:', e);
    return { questions: [], errorMessage: msg, inductionNotConfigured: false };
  }
}

function pickNonEmptyCulture(...parts: (string | null | undefined)[]): string {
  for (const p of parts) {
    if (typeof p !== 'string') continue;
    const t = p.trim();
    if (t.length > 0) return t;
  }
  return '';
}

function readJsonbString(settings: unknown, key: string): string {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return '';
  const v = (settings as Record<string, unknown>)[key];
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Alinea columnas / `settings` (JSONB) a `mission`, `vision`, `corporate_values` para el paso Cultura.
 * Aplica tanto a `branches` como a `companies`.
 */
function normalizeCultureRow(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!raw) return null;
  const settings = raw.settings;
  const mission = pickNonEmptyCulture(
    typeof raw.mission === 'string' ? raw.mission : null,
    typeof raw.mission_statement === 'string' ? raw.mission_statement : null,
    readJsonbString(settings, 'mission'),
    readJsonbString(settings, 'mission_statement'),
    readJsonbString(settings, 'mision')
  );
  const vision = pickNonEmptyCulture(
    typeof raw.vision === 'string' ? raw.vision : null,
    typeof raw.vision_statement === 'string' ? raw.vision_statement : null,
    readJsonbString(settings, 'vision'),
    readJsonbString(settings, 'vision_statement')
  );
  const corporate_values = pickNonEmptyCulture(
    typeof raw.corporate_values === 'string' ? raw.corporate_values : null,
    readJsonbString(settings, 'corporate_values'),
    readJsonbString(settings, 'values'),
    readJsonbString(settings, 'valores')
  );
  return {
    ...raw,
    mission: mission || null,
    vision: vision || null,
    corporate_values: corporate_values || null,
  };
}

/**
 * ADN multi-marca: cada campo toma primero la sucursal (`branches`); si viene vacío, la empresa (`companies`).
 * El objeto expuesto al onboarding solo incluye `mission`, `vision` y `corporate_values` (tipos string | null).
 */
function buildCultureAdnPayload(
  branchNorm: Record<string, unknown> | null,
  companyNorm: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!branchNorm && !companyNorm) return null;
  const str = (row: Record<string, unknown> | null, k: string) =>
    typeof row?.[k] === 'string' ? (row[k] as string) : null;
  const mission =
    pickNonEmptyCulture(str(branchNorm, 'mission'), str(companyNorm, 'mission')) || null;
  const vision =
    pickNonEmptyCulture(str(branchNorm, 'vision'), str(companyNorm, 'vision')) || null;
  const corporate_values =
    pickNonEmptyCulture(str(branchNorm, 'corporate_values'), str(companyNorm, 'corporate_values')) ||
    null;
  return { mission, vision, corporate_values };
}

/**
 * Misión / visión / valores para el paso Cultura (multi-marca / holding).
 * Consulta principal: `branches` por `branch_id` del expediente; si un campo queda vacío, respaldo en `companies`.
 * `company_policies` sigue anclado a `company_id`.
 */
export async function fetchOnboardingCompanyData(
  companyId: string,
  branchId?: string | null
): Promise<{
  /** Siempre con claves `mission`, `vision`, `corporate_values` (origen sucursal y/o empresa). */
  companyRow: Record<string, unknown> | null;
  policiesRows: { title?: unknown; content?: unknown }[] | null;
  companiesError: string | null;
  policiesError: string | null;
}> {
  const trimmed = companyId.trim();
  const branchTrim = (branchId ?? '').trim();
  if (!trimmed) {
    console.error('API ERROR [fetchOnboardingCompanyData]:', 'companyId vacío');
    return {
      companyRow: null,
      policiesRows: null,
      companiesError: 'companyId vacío',
      policiesError: null,
    };
  }

  const branchQuery =
    branchTrim.length > 0
      ? supabase
          .from('branches')
          .select('id, mission, vision, corporate_values, settings')
          .eq('id', branchTrim)
          .eq('company_id', trimmed)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null as { message: string } | null });

  const [branchRes, companyRes, policiesRes] = await Promise.all([
    branchQuery,
    supabase
      .from('companies')
      .select('mission, vision, corporate_values, settings')
      .eq('id', trimmed)
      .maybeSingle(),
    supabase
      .from('company_policies')
      .select('title, content, order_index')
      .eq('company_id', trimmed)
      .order('order_index', { ascending: true }),
  ]);

  if (companyRes.error) {
    logApiSupabaseError('fetchOnboardingCompanyData.companies', companyRes.error);
  }
  if (policiesRes.error) {
    logApiSupabaseError('fetchOnboardingCompanyData.company_policies', policiesRes.error);
  }
  if (branchRes.error) {
    logApiSupabaseError('fetchOnboardingCompanyData.branches', branchRes.error);
  }

  const policiesRows = (policiesRes.data ?? null) as { title?: unknown; content?: unknown }[] | null;
  const rawCompany = (companyRes.data ?? null) as Record<string, unknown> | null;
  const companyNorm = companyRes.error ? null : normalizeCultureRow(rawCompany);
  const rawBranch = (branchRes.data ?? null) as Record<string, unknown> | null;
  const branchNorm =
    branchRes.error || !rawBranch ? null : normalizeCultureRow(rawBranch);
  const companyRow = buildCultureAdnPayload(branchNorm, companyNorm);

  console.log('ADN Fetched:', {
    companyId: trimmed,
    branchId: branchTrim || null,
    branchResolved: Boolean(branchNorm),
    source: branchTrim ? 'branch_first_then_company_per_field' : 'company_only_no_branch_id',
    companyRow,
    policiesCount: policiesRows?.length ?? 0,
    companiesError: companyRes.error?.message ?? null,
    branchesError: branchRes.error?.message ?? null,
    policiesError: policiesRes.error?.message ?? null,
  });

  return {
    companyRow,
    policiesRows,
    companiesError: companyRes.error?.message ?? null,
    policiesError: policiesRes.error?.message ?? null,
  };
}

export async function fetchJobTitleFunctionsBlock(jobTitleId: string): Promise<{
  titleLabel: string;
  functionsDescription: string | null;
  errorMessage: string | null;
}> {
  const trimmed = jobTitleId.trim();
  if (!trimmed) {
    console.error('API ERROR [fetchJobTitleFunctionsBlock]:', 'jobTitleId vacío');
    return { titleLabel: '', functionsDescription: null, errorMessage: 'jobTitleId vacío' };
  }

  // Solo columnas que existen en `job_titles` (name, functions_description).
  // Incluir `title` (columna inexistente) hacía que PostgREST rechazara TODO el
  // query → el cargo real no se resolvía y el resumen de funciones quedaba vacío.
  const { data, error } = await supabase
    .from('job_titles')
    .select('functions_description, name')
    .eq('id', trimmed)
    .maybeSingle();

  if (error) {
    logApiSupabaseError('fetchJobTitleFunctionsBlock', error);
    return { titleLabel: '', functionsDescription: null, errorMessage: error.message };
  }

  const row = (data ?? null) as Record<string, unknown> | null;
  const name = String(row?.name ?? '').trim();
  const descRaw = row?.functions_description;
  const functionsDescription =
    descRaw != null && String(descRaw).trim() !== '' ? String(descRaw).trim() : null;

  return {
    titleLabel: name || 'Tu cargo',
    functionsDescription,
    errorMessage: null,
  };
}
