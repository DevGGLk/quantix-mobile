import { destinoParaAviso } from '../lib/avisoDestino';

describe('avisos de «Quién aprueba qué»', () => {
  it('algo por aprobar abre la bandeja Por aprobar', () => {
    expect(destinoParaAviso({ category: 'aprobacion_pendiente', url: '/mi-portal/por-aprobar' })).toEqual({ stack: 'PorAprobar' });
  });
  it('resultado de un adelanto abre Mis adelantos', () => {
    expect(destinoParaAviso({ category: 'aprobacion_resultado', url: '/mi-portal/adelantos' })).toEqual({ stack: 'Adelantos' });
  });
  it('resultado de un préstamo abre Mis préstamos', () => {
    expect(destinoParaAviso({ category: 'aprobacion_resultado', url: '/mi-portal/prestamos' })).toEqual({ stack: 'Prestamos' });
  });
  it('resultado de horas extra abre Inicio', () => {
    expect(destinoParaAviso({ category: 'aprobacion_resultado', url: '/mi-portal' })).toEqual({ tab: 'Home' });
  });
  it('avisos del préstamo (firmar, desembolso) abren Mis préstamos', () => {
    expect(destinoParaAviso({ category: 'prestamo_firmar' })).toEqual({ stack: 'Prestamos' });
  });
  it('descuento disciplinario por aceptar abre Mi disciplina', () => {
    expect(destinoParaAviso({ category: 'disciplina', url: '/mi-portal/disciplina' })).toEqual({ stack: 'MiDisciplina' });
  });
  it('lo demás no cambia', () => {
    expect(destinoParaAviso({ category: 'vacaciones' })).toEqual({ stack: 'Vacaciones' });
    expect(destinoParaAviso({ category: 'otra_cosa' })).toBeNull();
  });
});
