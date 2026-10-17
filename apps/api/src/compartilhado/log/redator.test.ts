import { describe, expect, it } from 'vitest';
import { ehChaveSensivel, redigir, resumirErro, urlSemQuery, VALOR_REDIGIDO } from './redator.ts';

describe('ehChaveSensivel', () => {
  it.each([
    'authorization',
    'Authorization',
    'cookie',
    'set-cookie',
    'senha',
    'novaSenha',
    'password',
    'token',
    'tokenAcesso',
    'refresh_token',
    'x-access-token',
    'email',
    'emailContato',
    'e_mail',
    'telefone',
    'telefoneCelular',
    'cpf',
    'cnpj',
    'JWT_SEGREDO',
    // Mesmas chaves da auditoria e da outbox (`ehChaveProtegida`).
    'nome',
    'nome_da_loja',
    'endereco',
    'endereçoEntrega',
    'logradouro',
    'cep',
    'celular',
    'whatsapp',
    'latitude',
    'longitude',
    'ip',
    'ipCliente',
    'pix',
    'chave_pix',
    'agencia',
    'dadosBancarios',
    'codigo',
    'codigoDeVerificacao',
    'totp',
    'hash',
    'hmac',
    // Trechos só do log.
    'mail',
    'mailContato',
    'E.Mail',
    'CnPj',
    'numeroCpf',
    // Texto livre: a mensagem de um erro costuma vir por aqui (R12, Q8).
    'message',
    'Message',
    'msg',
    'MSG',
    // P8: `mensagem` e `errorMessage` também levam a mensagem de um erro.
    'mensagem',
    'Mensagem',
    'errorMessage',
    'error_message',
    'ErrorMessage',
    // S70: a pilha começa pela mensagem do erro.
    'stack',
    'Stack',
    'pilha',
    'Pilha',
  ])('%s é sensível', (chave) => {
    expect(ehChaveSensivel(chave)).toBe(true);
  });

  it.each([
    'status',
    'idRequisicao',
    'url',
    'metodo',
    'tipo',
    'lojaId',
    'responseTime',
    'stackId',
    'pilhaDeChamadas',
    'messageId',
    'mensagens',
    'mensagemId',
  ])('%s não é sensível', (chave) => {
    expect(ehChaveSensivel(chave)).toBe(false);
  });
});

describe('redigir', () => {
  it('troca o valor das chaves sensíveis em qualquer nível, inclusive dentro de arrays', () => {
    const entrada = {
      headers: { authorization: 'Bearer abc', cookie: 'sid=1', 'user-agent': 'app/1.0' },
      usuario: { email: 'fulano@exemplo.com', telefone: '35999990000', perfil: 'consumidor' },
      lojas: [{ cnpj: '12345678000199', nome: 'Padaria', categoria: 'padaria' }],
      senha: { qualquer: 'coisa' },
      quantidade: 3,
    };

    expect(redigir(entrada)).toEqual({
      headers: { authorization: VALOR_REDIGIDO, cookie: VALOR_REDIGIDO, 'user-agent': 'app/1.0' },
      usuario: { email: VALOR_REDIGIDO, telefone: VALOR_REDIGIDO, perfil: 'consumidor' },
      lojas: [{ cnpj: VALOR_REDIGIDO, nome: VALOR_REDIGIDO, categoria: 'padaria' }],
      senha: VALOR_REDIGIDO,
      quantidade: 3,
    });
  });

  it('redige `mensagem`, `errorMessage` e `error_message` com e-mail, mas não `mensagemId` (P8)', () => {
    const email = 'fulano@exemplo.com';
    const entrada = {
      mensagem: email,
      errorMessage: email,
      aninhado: { error_message: email },
      mensagemId: 'm-1',
    };

    const redigido = redigir(entrada);

    expect(redigido).toEqual({
      mensagem: VALOR_REDIGIDO,
      errorMessage: VALOR_REDIGIDO,
      aninhado: { error_message: VALOR_REDIGIDO },
      mensagemId: 'm-1',
    });
    expect(JSON.stringify(redigido)).not.toContain(email);
  });

  it('`mensagem` e `errorMessage` em qualquer nível, dentro de array e com a grafia trocada (QA, P8)', () => {
    const email = 'fulano@exemplo.com';
    const entrada = {
      Mensagem: email,
      ERROR_MESSAGE: email,
      'error.message': email,
      'Mensagem ': email,
      erro: { message: email, Message: email, detalhes: { mensagem: email } },
      lista: [[{ errorMessage: email }], { mensagem: email }],
      mensagemId: 'm-1',
      mensagem_id: 'm-2',
      mensagens: ['m-3'],
    };

    const redigido = redigir(entrada);

    expect(JSON.stringify(redigido)).not.toContain(email);
    expect(redigido).toEqual({
      Mensagem: VALOR_REDIGIDO,
      ERROR_MESSAGE: VALOR_REDIGIDO,
      'error.message': VALOR_REDIGIDO,
      'Mensagem ': VALOR_REDIGIDO,
      erro: {
        message: VALOR_REDIGIDO,
        Message: VALOR_REDIGIDO,
        detalhes: { mensagem: VALOR_REDIGIDO },
      },
      lista: [[{ errorMessage: VALOR_REDIGIDO }], { mensagem: VALOR_REDIGIDO }],
      mensagemId: 'm-1',
      mensagem_id: 'm-2',
      mensagens: ['m-3'],
    });
  });

  it('`mensagem` com objeto no lugar do texto também é apagada inteira (QA, P8)', () => {
    const redigido = redigir({ mensagem: { email: 'fulano@exemplo.com' }, errorMessage: ['x'] });
    expect(redigido).toEqual({ mensagem: VALOR_REDIGIDO, errorMessage: VALOR_REDIGIDO });
  });

  it('redige `stack` e `pilha` em qualquer nível, mas o `Error` dentro do objeto mantém os quadros (S70)', () => {
    const email = 'fulano@exemplo.com';
    const erro = new Error(`falha para ${email}`);
    const entrada = {
      stack: erro.stack,
      pilha: erro.stack,
      aninhado: { Stack: erro.stack, lista: [{ PILHA: erro.stack }] },
      causa: erro,
    };

    const redigido = redigir(entrada);

    expect(JSON.stringify(redigido)).not.toContain(email);
    expect(redigido).toEqual({
      stack: VALOR_REDIGIDO,
      pilha: VALOR_REDIGIDO,
      aninhado: { Stack: VALOR_REDIGIDO, lista: [{ PILHA: VALOR_REDIGIDO }] },
      causa: { tipo: 'Error', pilha: expect.stringMatching(/^\s+at\s/) as unknown },
    });
  });

  it('não altera o objeto recebido', () => {
    const entrada = { cpf: '12345678900', aninhado: { token: 'x' } };
    redigir(entrada);
    expect(entrada).toEqual({ cpf: '12345678900', aninhado: { token: 'x' } });
  });

  it('devolve primitivos, Date, Map e Set sem mexer', () => {
    const data = new Date(0);
    const mapa = new Map([['email', 'mapa@exemplo.com']]);
    const conjunto = new Set(['conjunto@exemplo.com']);
    expect(redigir('texto')).toBe('texto');
    expect(redigir(null)).toBeNull();
    expect(redigir(42)).toBe(42);
    const redigido = redigir({ quando: data, mapa, conjunto });
    expect(redigido.quando).toBe(data);
    expect(redigido.mapa).toBe(mapa);
    expect(redigido.conjunto).toBe(conjunto);
    // No JSON, Map e Set saem vazios.
    expect(JSON.stringify(redigido)).not.toContain('@exemplo.com');
  });

  it('percorre instância de classe pelas propriedades próprias, sem alterá-la', () => {
    class Conta {
      readonly contato = { email: 'conta@exemplo.com', status: 'ativo' };
      constructor(
        readonly id: string,
        readonly telefone: string,
      ) {}
    }
    const conta = new Conta('c-1', '35999990000');
    expect(redigir({ conta })).toEqual({
      conta: {
        contato: { email: VALOR_REDIGIDO, status: 'ativo' },
        id: 'c-1',
        telefone: VALOR_REDIGIDO,
      },
    });
    expect(conta.telefone).toBe('35999990000');
  });

  it('troca um Error, em qualquer nível, pelo resumo de tipo, código e pilha', () => {
    // Como um erro do pg: `detail` traz o valor que violou a chave única.
    const erro = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      detail: 'Key (email)=(duplicado@exemplo.com) already exists.',
      email: 'duplicado@exemplo.com',
    });
    const redigido = redigir({ falha: erro, lista: [erro] });
    expect(redigido.falha).toMatchObject({ tipo: 'Error', codigo: '23505' });
    expect(redigido.falha).not.toHaveProperty('detail');
    expect(JSON.stringify(redigido)).not.toContain('duplicado@exemplo.com');
    expect(JSON.stringify(redigido)).not.toContain('duplicate key');
    expect(redigir(erro)).toEqual(expect.objectContaining({ tipo: 'Error', codigo: '23505' }));
  });

  it('binário vira [BINARIO], URL perde a query e `toJSON` passa pelo redator', () => {
    const comToJson = { toJSON: () => ({ email: 'tojson@exemplo.com', valor: '10.50' }) };
    class Decimal {
      constructor(private readonly texto: string) {}
      toJSON() {
        return this.texto;
      }
    }
    expect(
      redigir({
        corpo: Buffer.from('cpf=12345678900'),
        bytes: new Uint8Array([1, 2]),
        endpoint: new URL('https://api.exemplo.com/v1/x?token=abc'),
        comToJson,
        preco: new Decimal('10.50'),
      }),
    ).toEqual({
      corpo: '[BINARIO]',
      bytes: '[BINARIO]',
      endpoint: 'https://api.exemplo.com/v1/x',
      comToJson: { email: VALOR_REDIGIDO, valor: '10.50' },
      preco: '10.50',
    });
  });

  it('objeto que lança ao ser lido vira [ILEGIVEL] sem derrubar o log', () => {
    const traicoeiro = Object.defineProperty({}, 'status', {
      enumerable: true,
      get() {
        throw new Error('getter com fulano@exemplo.com');
      },
    });
    expect(redigir({ traicoeiro, ok: 1 })).toEqual({ traicoeiro: '[ILEGIVEL]', ok: 1 });
  });

  it('mantém intactas só as chaves pedidas, só no primeiro nível', () => {
    const erro = new Error('x');
    const redigido = redigir(
      { err: erro, email: 'a@b.c', aninhado: { err: erro } },
      { chavesIntactas: ['err', 'email'] },
    );
    expect(redigido.err).toBe(erro);
    expect(redigido.email).toBe('a@b.c');
    expect(redigido.aninhado.err).toMatchObject({ tipo: 'Error' });
  });

  it('marca referência circular e corta a profundidade sem estourar a pilha', () => {
    const ciclico: Record<string, unknown> = { status: 'a' };
    ciclico['eu'] = ciclico;
    expect(redigir(ciclico)).toEqual({ status: 'a', eu: '[CICLO]' });

    class No {
      proximo: No | undefined;
    }
    const no = new No();
    no.proximo = no;
    expect(redigir({ no })).toEqual({ no: { proximo: '[CICLO]' } });

    let profundo: Record<string, unknown> = { email: 'x@y.z' };
    for (let i = 0; i < 20; i += 1) profundo = { filho: profundo };
    expect(JSON.stringify(redigir(profundo))).toContain('[PROFUNDO]');
    expect(JSON.stringify(redigir(profundo))).not.toContain('x@y.z');
  });

  it('repete a mesma referência sem tratá-la como ciclo', () => {
    const compartilhado = { valor: 1 };
    expect(redigir({ a: compartilhado, b: compartilhado })).toEqual({
      a: { valor: 1 },
      b: { valor: 1 },
    });
  });
});

describe('resumirErro: quadros da pilha (Q9)', () => {
  it('descarta as linhas da mensagem, mesmo as parecidas com quadro', () => {
    const erro = new Error('falha\n    at fulano@exemplo.com (falso.ts:1:1)\n  at outro');
    const { pilha } = resumirErro(erro);
    expect(pilha).toBeDefined();
    expect(pilha).not.toContain('fulano@exemplo.com');
    expect(pilha).not.toContain('outro');
    expect(pilha?.split('\n').every((linha) => /^\s+at\s/.test(linha))).toBe(true);
  });

  it('com pilha trocada à mão, sem a mensagem, fica só com os quadros', () => {
    const erro = new Error('falha');
    erro.stack = 'Outro: cabeçalho\n    at a (a.ts:1:1)\n    at b (b.ts:2:2)';
    expect(resumirErro(erro).pilha).toBe('    at a (a.ts:1:1)\n    at b (b.ts:2:2)');
  });

  it('com mensagem vazia ou que não é texto, segue com os quadros', () => {
    const vazia = new Error('');
    vazia.stack = 'Error\n    at a (a.ts:1:1)';
    expect(resumirErro(vazia).pilha).toBe('    at a (a.ts:1:1)');
    const estranha = new Error('x');
    (estranha as { message: unknown }).message = { email: 'fulano@exemplo.com' };
    estranha.stack = 'Error: [object Object]\n    at a (a.ts:1:1)';
    expect(resumirErro(estranha).pilha).toBe('    at a (a.ts:1:1)');
  });
});

describe('urlSemQuery', () => {
  it.each([
    ['/v1/contas?email=fulano@exemplo.com', '/v1/contas'],
    ['/v1/convites#token=abc', '/v1/convites'],
    ['/v1/saude', '/v1/saude'],
    ['https://api.bairrin.com.br/v1/x?token=abc#frag', 'https://api.bairrin.com.br/v1/x'],
    ['?so=query', ''],
  ])('%s → %s', (url, esperada) => {
    expect(urlSemQuery(url)).toBe(esperada);
  });
});
