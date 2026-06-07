import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, FlatList, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../lib/theme';
import { useAdminScope } from '../lib/AdminScopeContext';

type Opt = { id: string | null; name: string };

/** Selector compacto de empresa + sucursal para el panel gerencial (paridad web). */
export default function AdminScopeSelector() {
  const { companyId, branchId, companies, branches, setCompanyId, setBranchId } = useAdminScope();
  const [picker, setPicker] = useState<null | 'company' | 'branch'>(null);

  const companyName = companies.find((c) => c.id === companyId)?.name ?? 'Empresa';
  const branchName = branchId ? (branches.find((b) => b.id === branchId)?.name ?? 'Sucursal') : 'Todas las sucursales';
  const showCompany = companies.length > 1;

  const options: Opt[] =
    picker === 'company'
      ? companies.map((c) => ({ id: c.id, name: c.name }))
      : [{ id: null, name: 'Todas las sucursales' }, ...branches.map((b) => ({ id: b.id, name: b.name }))];
  const currentId = picker === 'company' ? companyId : branchId;

  function choose(id: string | null) {
    if (picker === 'company') { if (id) setCompanyId(id); }
    else if (picker === 'branch') setBranchId(id);
    setPicker(null);
  }

  return (
    <View style={styles.wrap}>
      {showCompany && (
        <TouchableOpacity style={styles.field} activeOpacity={0.8} onPress={() => setPicker('company')}>
          <Ionicons name="business-outline" size={15} color={theme.primary} />
          <Text style={styles.fieldText} numberOfLines={1}>{companyName}</Text>
          <Ionicons name="chevron-down" size={14} color={theme.textMuted} />
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.field} activeOpacity={0.8} onPress={() => setPicker('branch')}>
        <Ionicons name="location-outline" size={15} color={theme.primary} />
        <Text style={styles.fieldText} numberOfLines={1}>{branchName}</Text>
        <Ionicons name="chevron-down" size={14} color={theme.textMuted} />
      </TouchableOpacity>

      <Modal visible={picker !== null} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPicker(null)}>
          <Pressable style={styles.sheet} onPress={() => { /* evita cerrar al tocar el contenido */ }}>
            <Text style={styles.sheetTitle}>{picker === 'company' ? 'Selecciona empresa' : 'Selecciona sucursal'}</Text>
            <FlatList
              data={options}
              keyExtractor={(o) => o.id ?? 'all'}
              style={styles.list}
              renderItem={({ item }) => {
                const active = currentId === item.id;
                return (
                  <TouchableOpacity style={styles.row} onPress={() => choose(item.id)}>
                    <Text style={[styles.rowText, active && styles.rowTextActive]} numberOfLines={1}>{item.name}</Text>
                    {active && <Ionicons name="checkmark" size={18} color={theme.primary} />}
                  </TouchableOpacity>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1,
    backgroundColor: theme.backgroundAlt, borderWidth: 1, borderColor: theme.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
  },
  fieldText: { fontSize: 13, fontWeight: '700', color: theme.textPrimary, maxWidth: 160 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', paddingHorizontal: 28 },
  sheet: { backgroundColor: theme.card, borderRadius: 16, paddingVertical: 12, maxHeight: '70%' },
  sheetTitle: { fontSize: 14, fontWeight: '800', color: theme.textPrimary, paddingHorizontal: 18, paddingBottom: 8 },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 13, borderTopWidth: 1, borderTopColor: theme.border,
  },
  rowText: { fontSize: 14, color: theme.textSecondary, flex: 1, marginRight: 8 },
  rowTextActive: { color: theme.primary, fontWeight: '800' },
});
