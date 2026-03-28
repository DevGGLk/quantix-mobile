/**
 * Textos legales/neutral cuando en Supabase no hay contenido de inducción.
 * No sustituyen datos del tenant: solo empty state hasta que RRHH cargue `companies` / `company_policies`.
 */

export const ONBOARDING_FALLBACK_MISSION_CULTURE =
  'Tu empresa aún no ha publicado misión, visión o valores corporativos en el sistema. ' +
  'Consulta el material de inducción con tu gerente o RRHH.';

export const ONBOARDING_FALLBACK_RULEBOOK =
  'Las políticas internas se muestran en esta app en Menú → Reglamento cuando RRHH las publique. ' +
  'Al aceptar, confirmas tu compromiso de cumplir la normativa aplicable en tu centro de trabajo.';

/** Cuando `company_policies` falla por red/RLS (no confundir con “aún no hay políticas”). */
export const ONBOARDING_POLICIES_FETCH_FAILED_TITLE =
  'No pudimos cargar el reglamento desde el servidor';

export const ONBOARDING_POLICIES_FETCH_FAILED_BODY =
  'Puede deberse a tu conexión o a permisos de acceso. Pulsa «Reintentar» o consulta con RRHH. ' +
  'Cuando cargue correctamente, aquí verás el mismo contenido que en Menú → Reglamento.';
