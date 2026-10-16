import { describe, expect, it } from 'vitest';
import {
  camposDoErroZod,
  consultaPaginadaSchema,
  formaDaPaginacao,
  LIMITE_MAXIMO_DA_PAGINA,
  LIMITE_PADRAO_DA_PAGINA,
  objetoEstrito,
  paginaSchema,
  z,
} from './index.ts';

describe('consulta paginada', () => {
  it('usa o limite padrão e dispensa o cursor', () => {
    expect(consultaPaginadaSchema.parse({})).toEqual({ limite: LIMITE_PADRAO_DA_PAGINA });
  });

  it('aceita limite e cursor vindos da query string (texto)', () => {
    expect(consultaPaginadaSchema.parse({ cursor: 'abc', limite: '5' })).toEqual({
      cursor: 'abc',
      limite: 5,
    });
  });

  it('aceita o limite máximo e recusa um acima dele', () => {
    expect(consultaPaginadaSchema.parse({ limite: String(LIMITE_MAXIMO_DA_PAGINA) }).limite).toBe(
      20,
    );
    expect(consultaPaginadaSchema.safeParse({ limite: '21' }).success).toBe(false);
    expect(LIMITE_MAXIMO_DA_PAGINA).toBe(20);
  });

  it.each(['0', '-1', '1.5', 'abc', ''])('recusa limite %j', (limite) => {
    expect(consultaPaginadaSchema.safeParse({ limite }).success).toBe(false);
  });

  it('recusa cursor vazio ou grande demais', () => {
    expect(consultaPaginadaSchema.safeParse({ cursor: '' }).success).toBe(false);
    expect(consultaPaginadaSchema.safeParse({ cursor: 'a'.repeat(513) }).success).toBe(false);
  });

  it('recusa parâmetro desconhecido, com campo em português', () => {
    const resultado = consultaPaginadaSchema.safeParse({ pagina: '2' });
    if (resultado.success) throw new Error('esperava falha');
    expect(camposDoErroZod(resultado.error)).toEqual([
      { campo: 'pagina', codigo: 'desconhecido', motivo: 'Campo desconhecido.' },
    ]);
  });

  it('compõe com filtros da rota', () => {
    const esquema = objetoEstrito({ ...formaDaPaginacao, categoria: z.string().optional() });
    expect(esquema.parse({ categoria: 'padaria', limite: '10' })).toEqual({
      categoria: 'padaria',
      limite: 10,
    });
  });
});

describe('página de resposta', () => {
  const esquema = paginaSchema(z.object({ id: z.string() }));

  it('aceita página com próximo cursor e a última página (null)', () => {
    expect(esquema.safeParse({ itens: [{ id: 'a' }], proximoCursor: 'c1' }).success).toBe(true);
    expect(esquema.safeParse({ itens: [], proximoCursor: null }).success).toBe(true);
  });

  it('recusa página com mais itens que o limite máximo', () => {
    const itens = Array.from({ length: LIMITE_MAXIMO_DA_PAGINA + 1 }, (_, i) => ({
      id: String(i),
    }));
    expect(esquema.safeParse({ itens, proximoCursor: null }).success).toBe(false);
  });
});
