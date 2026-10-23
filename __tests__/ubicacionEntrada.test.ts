jest.mock('expo-location', () => ({}));

import { esImprecisa, mejorLectura, type Lectura } from '../lib/ubicacionEntrada';

const l = (accuracy: number | null): Lectura => ({ lat: 12.9, lon: -85.9, accuracy, mocked: false });

describe('ubicacionEntrada', () => {
  it('se queda con la lectura más precisa', () => {
    expect(mejorLectura(l(100), l(12))?.accuracy).toBe(12);
    expect(mejorLectura(l(12), l(100))?.accuracy).toBe(12);
  });

  it('una lectura sin precisión pierde contra cualquiera que la tenga', () => {
    expect(mejorLectura(l(null), l(80))?.accuracy).toBe(80);
    expect(mejorLectura(null, l(null))?.accuracy).toBeNull();
  });

  it('imprecisa = sin lectura, sin precisión o peor que 50 m (la "ubicación aproximada" da 100)', () => {
    expect(esImprecisa(null)).toBe(true);
    expect(esImprecisa(l(null))).toBe(true);
    expect(esImprecisa(l(100))).toBe(true);
    expect(esImprecisa(l(50))).toBe(false);
    expect(esImprecisa(l(12))).toBe(false);
  });
});
