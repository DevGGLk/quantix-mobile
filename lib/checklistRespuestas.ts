/**
 * Copia móvil de quantix-dashboard/lib/checklists-respuestas.ts (mantener en sincronía).
 * Tipos de respuesta de las tareas de checklist (ronda 2).
 * La evaluación definitiva (cumple / no cumple, puntaje, crítica, antifraude) la hace
 * el RPC `checklist_enviar`; aquí solo se replica para mostrar al colaborador el
 * resultado antes de enviar.
 */

export const RESPONSE_TYPES = ["check", "yes_no", "number", "text", "choice"] as const
export type ResponseType = (typeof RESPONSE_TYPES)[number]

export const RESPONSE_TYPE_LABELS: Record<ResponseType, string> = {
  check: "Marcar como hecha",
  yes_no: "Sí / No",
  number: "Número (ej. temperatura)",
  text: "Texto",
  choice: "Opción de una lista",
}

export const PHOTO_RULES = ["required", "optional", "none"] as const
export type PhotoRule = (typeof PHOTO_RULES)[number]

export const PHOTO_RULE_LABELS: Record<PhotoRule, string> = {
  required: "Foto obligatoria",
  optional: "Foto opcional",
  none: "Sin foto",
}

export type ChoiceOption = { label: string; ok: boolean }

/** Columnas de `checklist_items` que definen cómo se responde una tarea. */
export type ItemConfig = {
  id: string
  task_description: string
  instructions: string | null
  order_index: number | null
  response_type: ResponseType
  photo_rule: PhotoRule
  is_critical: boolean
  weight: number
  allow_na: boolean
  expected_answer: "yes" | "no" | null
  number_min: number | null
  number_max: number | null
  unit: string | null
  options: ChoiceOption[] | null
}

export const ITEM_CONFIG_COLUMNS =
  "id, checklist_id, task_description, instructions, order_index, response_type, photo_rule, is_critical, weight, allow_na, expected_answer, number_min, number_max, unit, options"

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Normaliza una fila de BD (numeric llega como string, options como jsonb). */
export function normalizeItem(row: Record<string, unknown>): ItemConfig {
  const rt = String(row.response_type ?? "check") as ResponseType
  const pr = String(row.photo_rule ?? "required") as PhotoRule
  const opts = Array.isArray(row.options)
    ? (row.options as unknown[])
        .map((o) => {
          const x = o as { label?: unknown; ok?: unknown }
          return { label: String(x?.label ?? "").trim(), ok: x?.ok !== false }
        })
        .filter((o) => o.label)
    : null
  const ea = row.expected_answer === "no" ? "no" : row.expected_answer === "yes" ? "yes" : null
  return {
    id: String(row.id),
    task_description: String(row.task_description ?? ""),
    instructions: (row.instructions as string | null) ?? null,
    order_index: toNum(row.order_index),
    response_type: (RESPONSE_TYPES as readonly string[]).includes(rt) ? rt : "check",
    photo_rule: (PHOTO_RULES as readonly string[]).includes(pr) ? pr : "required",
    is_critical: row.is_critical === true,
    weight: toNum(row.weight) ?? 1,
    allow_na: row.allow_na === true,
    expected_answer: ea,
    number_min: toNum(row.number_min),
    number_max: toNum(row.number_max),
    unit: (row.unit as string | null) ?? null,
    options: opts,
  }
}

/** Metadatos de la foto que se envían al RPC (señales antifraude). */
export type PhotoMeta = {
  taken_at?: string | null
  lat?: number | null
  lng?: number | null
  accuracy?: number | null
  source?: "camera" | "file"
}

/** Respuesta de una tarea tal como la arma la UI (y se guarda en el borrador). */
export type ItemAnswer = {
  na?: boolean
  checked?: boolean
  value?: string | null
  note?: string | null
  evidence_url?: string | null
  photo?: PhotoMeta | null
}

export function isAnswered(item: ItemConfig, a: ItemAnswer | undefined): boolean {
  if (!a || a.na) return false
  if (item.response_type === "check") return Boolean(a.checked)
  return Boolean((a.value ?? "").toString().trim())
}

/** null = sin responder; true/false = cumple / no cumple. */
export function evaluate(item: ItemConfig, a: ItemAnswer | undefined): boolean | null {
  if (!isAnswered(item, a)) return null
  const v = (a?.value ?? "").toString().trim()
  switch (item.response_type) {
    case "check":
    case "text":
      return true
    case "yes_no":
      return v === (item.expected_answer ?? "yes")
    case "number": {
      const n = Number(v.replace(",", "."))
      if (!Number.isFinite(n)) return false
      return (item.number_min == null || n >= item.number_min) && (item.number_max == null || n <= item.number_max)
    }
    case "choice":
      return item.options?.find((o) => o.label === v)?.ok ?? true
  }
}

/** Problema que impide enviar esta tarea (o null si está bien). */
export function itemProblem(item: ItemConfig, a: ItemAnswer | undefined): string | null {
  if (a?.na) return null
  if (!isAnswered(item, a)) return null
  if (item.response_type === "number" && !Number.isFinite(Number((a?.value ?? "").toString().replace(",", ".")))) {
    return "Escribe un número válido."
  }
  if (item.photo_rule === "required" && !a?.evidence_url) return "Falta la foto."
  if (evaluate(item, a) === false && !(a?.note ?? "").trim()) return "Explica por qué no cumple."
  return null
}

export function summarize(items: ItemConfig[], answers: Record<string, ItemAnswer>) {
  let aplicables = 0
  let respondidas = 0
  let pesoTotal = 0
  let pesoOk = 0
  let critica = false
  let tocadas = 0
  for (const it of items) {
    const a = answers[it.id]
    if (a?.na) {
      tocadas++
      continue
    }
    aplicables++
    pesoTotal += it.weight
    const r = evaluate(it, a)
    if (r !== null) {
      respondidas++
      tocadas++
    }
    if (r === true) pesoOk += it.weight
    if (it.is_critical && r !== true) critica = true
  }
  return {
    completion: aplicables ? Math.round((100 * respondidas) / aplicables) : 100,
    score: pesoTotal ? Math.round((1000 * pesoOk) / pesoTotal) / 10 : 100,
    critica,
    tocadas,
  }
}

/** Payload para `checklist_enviar`. */
export function toRpcPayload(items: ItemConfig[], answers: Record<string, ItemAnswer>) {
  const out: Record<string, Record<string, unknown>> = {}
  for (const it of items) {
    const a = answers[it.id]
    if (!a) continue
    if (a.na) {
      out[it.id] = { status: "na", note: a.note?.trim() || null }
      continue
    }
    if (!isAnswered(it, a)) continue
    out[it.id] = {
      status: "answered",
      ...(it.response_type === "check" ? { checked: true } : { value: (a.value ?? "").toString().trim() }),
      note: a.note?.trim() || null,
      evidence_url: it.photo_rule === "none" ? null : a.evidence_url ?? null,
      photo: it.photo_rule === "none" || !a.evidence_url ? null : a.photo ?? null,
    }
  }
  return out
}

/** Lee `metadata.responses` (formato ronda 1 o ronda 2) a respuestas de UI. */
export function answersFromMetadata(items: ItemConfig[], metadata: unknown): Record<string, ItemAnswer> {
  const out: Record<string, ItemAnswer> = {}
  const resp = (metadata as { responses?: Record<string, Record<string, unknown>> } | null)?.responses
  if (!resp || typeof resp !== "object") return out
  for (const it of items) {
    const c = resp[it.id]
    if (!c) continue
    const path = typeof c.evidence_url === "string" && c.evidence_url ? c.evidence_url : null
    if (c.status === "na") {
      out[it.id] = { na: true, note: (c.note as string) ?? null }
      continue
    }
    if (c.status === "pending") continue
    const legacyCheck = c.status === undefined && path
    out[it.id] = {
      checked: it.response_type === "check" && (c.status === "answered" || Boolean(legacyCheck)),
      value: c.value === undefined || c.value === null ? null : String(c.value),
      note: (c.note as string) ?? null,
      evidence_url: path,
      photo: (c.photo as PhotoMeta) ?? null,
    }
  }
  return out
}

export function answerLabel(item: ItemConfig, cell: Record<string, unknown> | undefined): string {
  if (!cell) return "Sin responder"
  if (cell.status === "na") return "No aplica"
  if (cell.status === "pending") return "Sin responder"
  const path = typeof cell.evidence_url === "string" && cell.evidence_url
  if (cell.status === undefined) return path ? "Hecha" : "Sin responder" // formato ronda 1
  const v = cell.value
  switch (item.response_type) {
    case "check":
      return "Hecha"
    case "yes_no":
      return v === "yes" ? "Sí" : v === "no" ? "No" : "—"
    case "number":
      return `${v ?? "—"}${item.unit ? ` ${item.unit}` : ""}`
    default:
      return v === null || v === undefined ? "—" : String(v)
  }
}

export function itemRuleSummary(it: ItemConfig): string {
  const parts: string[] = [RESPONSE_TYPE_LABELS[it.response_type]]
  if (it.response_type === "yes_no") parts.push(`correcto: ${it.expected_answer === "no" ? "No" : "Sí"}`)
  if (it.response_type === "number") {
    const u = it.unit ? ` ${it.unit}` : ""
    if (it.number_min != null && it.number_max != null) parts.push(`entre ${it.number_min} y ${it.number_max}${u}`)
    else if (it.number_min != null) parts.push(`mínimo ${it.number_min}${u}`)
    else if (it.number_max != null) parts.push(`máximo ${it.number_max}${u}`)
  }
  if (it.response_type === "choice" && it.options?.length) {
    parts.push(it.options.map((o) => (o.ok ? o.label : `${o.label} ✗`)).join(" / "))
  }
  parts.push(PHOTO_RULE_LABELS[it.photo_rule])
  if (it.is_critical) parts.push("CRÍTICA")
  if (it.weight !== 1) parts.push(`peso ${it.weight}`)
  if (it.allow_na) parts.push("admite No aplica")
  return parts.join(" · ")
}
