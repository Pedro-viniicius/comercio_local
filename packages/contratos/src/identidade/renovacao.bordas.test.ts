// QA do grupo C (etapa 5c, CA-05, CA-13): bordas do corpo da renovação dos apps. O `cliente` vem do
// aparelho e a API o compara com o da requisição (S16): valor de protótipo, campo a mais, `painel`
// no corpo e texto que parece certo mas não é devem dar 400 com o campo e o motivo, sem repetir o
// valor recebido.
import { describe, expect, it } from 'vitest';
import {
  camposDoErroZod,
  clienteDoAppSchema,
  renovarSessaoSchema,
  type CampoComErro,
  type z,
} from '../index.ts';

function campos(esquema: z.ZodType, entrada: unknown): CampoComErro[] {
  const resultado = esquema.safeParse(entrada);
  if (resultado.success) throw new Error('esperava falha de validação');
  return camposDoErroZod(resultado.error);
}

const tokenRenovacao = 'abc_DEF-123';

describe('renovarSessaoSchema: o cliente do corpo', () => {
  it.each([
    'constructor',
    '__proto__',
    'toString',
    'hasOwnProperty',
    'valueOf',
    'APP_LOJISTA',
    'app_lojista ',
    ' app_lojista',
    'app_lojista\u0000',
    'app_lojısta',
    'ａpp_lojista',
    'app-lojista',
    'painel',
    'admin',
    '',
  ])('o valor %j é recusado com o campo `cliente` e sem repetir o que veio', (cliente) => {
    const resultado = campos(renovarSessaoSchema, { tokenRenovacao, cliente });

    expect(resultado).toHaveLength(1);
    expect(resultado[0]).toMatchObject({ campo: 'cliente', codigo: 'invalido' });
    if (cliente.length > 3) expect(JSON.stringify(resultado)).not.toContain(`"${cliente}"`);
  });

  it.each([
    ['número', 1],
    ['nulo', null],
    ['objeto', {}],
    ['lista', ['app_lojista']],
    ['booleano', true],
    ['ausente', undefined],
  ])('tipo %s no lugar do cliente dá `cliente` inválido', (_nome, cliente) => {
    const resultado = campos(renovarSessaoSchema, { tokenRenovacao, cliente });
    expect(resultado.map((c) => c.campo)).toEqual(['cliente']);
  });

  it('campo a mais no corpo da renovação dá 400 `desconhecido` (o painel não manda corpo, os apps mandam só dois campos)', () => {
    const resultado = campos(renovarSessaoSchema, {
      tokenRenovacao,
      cliente: 'app_lojista',
      sessaoId: 'x',
    });
    expect(resultado).toEqual([
      { campo: 'sessaoId', codigo: 'desconhecido', motivo: 'Campo desconhecido.' },
    ]);
  });

  it('`__proto__` como chave do corpo (JSON.parse cria chave própria) é campo desconhecido, não contamina nada', () => {
    const corpo: unknown = JSON.parse(
      `{"tokenRenovacao":"${tokenRenovacao}","cliente":"app_lojista","__proto__":{"cliente":"painel"}}`,
    );
    const resultado = renovarSessaoSchema.safeParse(corpo);

    expect(resultado.success).toBe(false);
    expect(({} as Record<string, unknown>)['cliente']).toBeUndefined();
  });

  it('os dois campos ruins aparecem juntos, na ordem do contrato', () => {
    const resultado = campos(renovarSessaoSchema, {
      tokenRenovacao: 'com espaço',
      cliente: 'painel',
    });
    expect(resultado.map((c) => c.campo).sort()).toEqual(['cliente', 'tokenRenovacao']);
  });

  it('o resultado válido leva só os dois campos e devolve o cliente exatamente como veio', () => {
    for (const cliente of ['app_consumidor', 'app_lojista'] as const) {
      const lido = renovarSessaoSchema.parse({ tokenRenovacao, cliente });
      expect(Object.keys(lido).sort()).toEqual(['cliente', 'tokenRenovacao']);
      expect(lido.cliente).toBe(cliente);
    }
  });

  it('`painel` é cliente da entrada, não da renovação pelo corpo', () => {
    expect(clienteDoAppSchema.options).toEqual(['app_consumidor', 'app_lojista']);
    expect(clienteDoAppSchema.safeParse('painel').success).toBe(false);
  });
});
