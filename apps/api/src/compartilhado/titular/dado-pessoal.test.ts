// Regra de chave protegida (dado pessoal ou segredo), comum à auditoria (S4)
// e ao payload da outbox.
import { describe, expect, it } from 'vitest';
import { ehChaveProtegida, problemasDeDadoPessoal } from './dado-pessoal.ts';

describe('ehChaveProtegida', () => {
  it.each([
    'email',
    'emailNormalizado',
    'email_contato',
    'EMAIL',
    'telefoneE164',
    'celular',
    'whatsapp',
    'nome',
    'nomeCompleto',
    'nome_fantasia',
    'sobrenome',
    'cpf',
    'cnpjDaLoja',
    'rg',
    'cep',
    'endereço',
    'enderecoDeEntrega',
    'logradouro',
    'complemento',
    'latitude',
    'dataDeNascimento',
    'ip',
    'enderecoIp',
    'chavePix',
    'dadosBancarios',
    'agencia',
    'senha',
    'novaSenha',
    'password',
    'refreshToken',
    'x-access-token',
    'segredoTotp',
    'clientSecret',
    'cookie',
    'authorization',
    'codigo',
    'codigoDeVerificacao',
    'codigoHmac',
    'senhaHash',
  ])('protege "%s"', (chave) => {
    expect(ehChaveProtegida(chave)).toBe(true);
  });

  it.each([
    'id',
    'contaId',
    'lojaId',
    'pedidoId',
    'tipo',
    'status',
    'descricao',
    'perfis',
    'versao',
    'taxaEmCentavos',
    'quantidade',
    'motivo',
    'campos',
    'ocorridoEm',
    'finalidade',
    'aceitoEm',
  ])('não protege "%s"', (chave) => {
    expect(ehChaveProtegida(chave)).toBe(false);
  });
});

describe('problemasDeDadoPessoal', () => {
  it('não acha nada em JSON neutro, inclusive null, listas e números', () => {
    expect(
      problemasDeDadoPessoal(
        {
          contaId: 'x',
          perfis: ['consumidor'],
          total: 0,
          ativo: true,
          motivo: null,
          itens: [{ id: 1 }],
        },
        'payload',
      ),
    ).toEqual([]);
  });

  it('aceita a marca de alteração exata em chave protegida', () => {
    expect(problemasDeDadoPessoal({ email: { alterado: true } }, 'depois')).toEqual([]);
  });

  it.each([
    [{ emailVerificado: true }],
    [{ telefoneConfirmado: false }],
    [{ telefone: null }],
    [{ contato: { email: null, senha: true } }],
  ])('aceita booleano e null em chave protegida: %j', (valor) => {
    expect(problemasDeDadoPessoal(valor, 'depois')).toEqual([]);
  });

  it.each([
    [{ email: { alterado: false } }],
    [{ email: { alterado: 'true' } }],
    [{ email: {} }],
    [{ email: 'fulano@exemplo.com' }],
    [{ email: '' }],
    [{ telefone: 35999990000 }],
    [{ telefone: 0 }],
    [{ email: ['fulano@exemplo.com'] }],
    [{ email: [true] }],
    [{ email: { valor: true } }],
  ])('recusa em chave protegida texto, número, lista e objeto que não é a marca: %j', (valor) => {
    const [chave] = Object.keys(valor);
    expect(problemasDeDadoPessoal(valor, 'depois')).toEqual([
      { caminho: `depois.${chave}`, motivo: 'chave-protegida' },
    ]);
  });

  it('acha todos os problemas, com caminho, em qualquer profundidade', () => {
    expect(
      problemasDeDadoPessoal(
        { a: { b: [{ cpf: '1' }, { ok: 1, senha: 'x' }] }, telefone: '2', infinito: Infinity },
        'raiz',
      ),
    ).toEqual([
      { caminho: 'raiz.a.b[0].cpf', motivo: 'chave-protegida' },
      { caminho: 'raiz.a.b[1].senha', motivo: 'chave-protegida' },
      { caminho: 'raiz.telefone', motivo: 'chave-protegida' },
      { caminho: 'raiz.infinito', motivo: 'valor-nao-json' },
    ]);
  });

  it.each([
    ['Date', new Date()],
    ['Map', new Map()],
    ['undefined', undefined],
    ['função', () => 1],
    ['bigint', 1n],
  ])('recusa %s como valor', (_caso, valor) => {
    expect(problemasDeDadoPessoal({ campo: valor }, 'payload')).toEqual([
      { caminho: 'payload.campo', motivo: 'valor-nao-json' },
    ]);
  });

  it('recusa aninhamento profundo demais', () => {
    let valor: unknown = { fim: 1 };
    for (let i = 0; i < 12; i += 1) valor = { nivel: valor };
    expect(problemasDeDadoPessoal(valor, 'p')).toEqual([
      expect.objectContaining({ motivo: 'profundo-demais' }),
    ]);
  });
});
