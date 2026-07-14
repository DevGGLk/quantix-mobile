jest.mock('../lib/supabase', () => ({ supabase: {} }));

import { nearestMarkingPoint, type MarkingPoint } from '../lib/markingPlaces';

// Caso real (auditoría 2026-07-14): Kevin Pozo — cargo INVENTARIO en Chefellas
// con segundo punto "Oficina GGL" (en Woods). La app vieja solo miraba
// employees.branch_id y lo rebotaba desde GGL; el modelo multi-punto lo acepta.
const CHEFELLAS: MarkingPoint = {
  name: 'Chefellas Pizza y Mas',
  lat: 12.9222793,
  lon: -85.9201898,
  radiusMeters: 50,
};
const OFICINA_GGL: MarkingPoint = {
  name: 'Oficina GGL',
  lat: 12.9265883,
  lon: -85.9169853,
  radiusMeters: 25,
};

describe('nearestMarkingPoint (advisory multi-punto)', () => {
  const points = [CHEFELLAS, OFICINA_GGL];

  it('caso Kevin: parado en Oficina GGL está DENTRO (aunque su sucursal quede a ~590 m)', () => {
    const r = nearestMarkingPoint(points, 12.92659, -85.91698);
    expect(r).not.toBeNull();
    expect(r!.point.name).toBe('Oficina GGL');
    expect(r!.inside).toBe(true);
    expect(r!.distanceMeters).toBeLessThan(25);
  });

  it('en Chefellas está DENTRO del punto primario', () => {
    const r = nearestMarkingPoint(points, 12.9222793, -85.9201898);
    expect(r!.point.name).toBe('Chefellas Pizza y Mas');
    expect(r!.inside).toBe(true);
  });

  it('lejos de todo: FUERA, reporta el más cercano con su distancia', () => {
    const r = nearestMarkingPoint(points, 12.9, -85.95);
    expect(r!.inside).toBe(false);
    expect(r!.distanceMeters).toBeGreaterThan(1000);
  });

  it('sin puntos: null', () => {
    expect(nearestMarkingPoint([], 12.9, -85.9)).toBeNull();
  });

  it('prefiere un punto DENTRO aunque el centro de otro esté más cerca', () => {
    const chico: MarkingPoint = { name: 'chico', lat: 12.93, lon: -85.92, radiusMeters: 5 };
    const grande: MarkingPoint = { name: 'grande', lat: 12.9302, lon: -85.92, radiusMeters: 100 };
    // A ~11 m del centro de "chico" (fuera de su radio 5 m) pero dentro de "grande".
    const r = nearestMarkingPoint([chico, grande], 12.9301, -85.92);
    expect(r!.point.name).toBe('grande');
    expect(r!.inside).toBe(true);
  });
});
