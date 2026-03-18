import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'

// Aquí pones la URL pública de tu proyecto Supabase (la misma que usaste en la web)
const supabaseUrl = 'https://cdjspplftaxfgpebqenj.supabase.co'

// Aquí pones SÓLO la clave "anon" pública (la que empieza con eyJ...)
const supabaseAnonKey = 'sb_publishable_ARDZs8klfgG5QymNCOeSXQ_0-QM99Fr'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})