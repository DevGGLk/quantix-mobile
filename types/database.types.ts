/**
 * Tipos mínimos para el nuevo modelo Enterprise.
 * Nota: este archivo no es generado automáticamente; se mantiene a mano.
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

