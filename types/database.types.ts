/**
 * Tipos mínimos usados por la app hasta ejecutar `npm run gen:types` con `supabase link`
 * (el script escribe el archivo solo si la generación tiene éxito; no vacía el archivo en error).
 * Sin link: `npx supabase gen types typescript --project-id <ref> > types/database.types.ts`
 */

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          role: string | null;
          holding_id: string | null;
          onboarding_completed: boolean | null;
        };
      };
      employees: {
        Row: {
          id: string;
          user_id: string;
          company_id: string | null;
          branch_id: string | null;
          department_id: string | null;
          job_title_id: string | null;
          first_name: string | null;
          last_name: string | null;
          salary: number | null;
        };
      };
      // (El resto de tablas se tipan bajo demanda)
    };
  };
};

