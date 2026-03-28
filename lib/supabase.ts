import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

function readSupabaseConfig(): { url: string; anonKey: string } {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';
  if (!url || !anonKey) {
    const hint =
      'Configura EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY (copia .env.example → .env). En EAS: Secrets del proyecto.';
    if (__DEV__) {
      throw new Error(`[QuantixHR] ${hint}`);
    }
    throw new Error(
      `[QuantixHR] Credenciales Supabase no configuradas. ${hint}`
    );
  }
  return { url, anonKey };
}

const { url: supabaseUrl, anonKey: supabaseAnonKey } = readSupabaseConfig();

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
