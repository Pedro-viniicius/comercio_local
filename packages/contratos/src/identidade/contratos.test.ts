import { describe, expect, it } from 'vitest';
import {
  CABECALHO_DO_CLIENTE,
  camposDoErroZod,
  clienteDoAppSchema,
  codigoDeRecuperacaoSchema,
  codigoDoAutenticadorSchema,
  codigoSchema,
  confirmarConfiguracaoSchema,
  contaSchema,
  corpoVazioSchema,
  criarContaSchema,
  entrarSchema,
  EVENTOS_DE_IDENTIDADE,
  iniciarConfiguracaoSchema,
  MENSAGEM_DE_CADASTRO_ACEITO,
  cadastroAceitoSchema,
  PERFIS,
  privacidadeSchema,
  redefinirSenhaSchema,
  renovarSessaoSchema,
  respostaDeEntrarSchema,
  segundoFatorConfirmadoSchema,
  sessaoSchema,
  solicitarExclusaoSchema,
  solicitarRecuperacaoSchema,
  verificarEmailSchema,
  verificarSegundoFatorSchema,
  type CampoComErro,
  type z,
} from '../index.ts';

/** Campos do 400 que a API devolveria para a entrada (CA-13). */
function campos(esquema: z.ZodType, entrada: unknown): CampoComErro[] {
  const resultado = esquema.safeParse(entrada);
  if (resultado.success) throw new Error('esperava falha de validação');
  return camposDoErroZod(resultado.error);
}

const cadastro = {
  nome: 'Ana Souza',
  email: 'ana.souza@exemplo.com.br',
  telefone: '(35) 99999-1234',
  senha: 'feira-do-bairro-7',
  aceites: { termos: '1', privacidade: '1' },
};

describe('POST /v1/contas (CA-01)', () => {
  it('aceita o cadastro e entrega e-mail normalizado e celular em E.164', () => {
    const lido = criarContaSchema.parse({
      ...cadastro,
      nome: '  Ana Souza ',
      email: ' Ana.Souza@Exemplo.com.BR ',
    });
    expect(lido).toEqual({
      ...cadastro,
      telefone: '+5535999991234',
      aceites: { termos: '1', privacidade: '1' },
    });
  });

  it('cada campo ausente vira "obrigatorio", um erro por campo', () => {
    expect(campos(criarContaSchema, {})).toEqual(
      ['nome', 'email', 'telefone', 'senha', 'aceites'].map((campo) => ({
        campo,
        codigo: 'obrigatorio',
        motivo: 'Campo obrigatório.',
      })),
    );
  });

  it('texto vazio ou só com espaços também é "obrigatorio"', () => {
    const vazio = { ...cadastro, nome: '   ', email: ' ', telefone: '', senha: '' };
    expect(campos(criarContaSchema, vazio).map(({ campo, codigo }) => [campo, codigo])).toEqual([
      ['nome', 'obrigatorio'],
      ['email', 'obrigatorio'],
      ['telefone', 'obrigatorio'],
      ['senha', 'obrigatorio'],
    ]);
  });

  it('o aceite leva as versões dos dois documentos', () => {
    expect(campos(criarContaSchema, { ...cadastro, aceites: { termos: '1' } })).toEqual([
      { campo: 'aceites.privacidade', codigo: 'obrigatorio', motivo: 'Campo obrigatório.' },
    ]);
    expect(
      campos(criarContaSchema, { ...cadastro, aceites: { termos: '1', privacidade: 'v 1' } }),
    ).toEqual([
      {
        campo: 'aceites.privacidade',
        codigo: 'invalido',
        motivo: 'Versão do documento inválida',
      },
    ]);
  });

  it('valor inválido vira "invalido" com o motivo da spec, um erro por campo', () => {
    const invalido = {
      ...cadastro,
      nome: 'A'.repeat(81),
      email: 'ana.souza@',
      telefone: '(35) 3531-1234',
      senha: 'curta',
    };
    expect(campos(criarContaSchema, invalido)).toEqual([
      { campo: 'nome', codigo: 'invalido', motivo: 'Use até 80 caracteres' },
      { campo: 'email', codigo: 'invalido', motivo: 'Confira o e-mail: falta o @ ou o domínio' },
      {
        campo: 'telefone',
        codigo: 'invalido',
        motivo: 'Confira o número: use DDD + 9 dígitos, como (35) 99999-1234',
      },
      { campo: 'senha', codigo: 'invalido', motivo: 'Use 8 caracteres ou mais' },
    ]);
  });

  it('nome: até 80 caracteres e sem caractere de controle', () => {
    const oitenta = 'é'.normalize('NFD').repeat(80);
    expect(criarContaSchema.parse({ ...cadastro, nome: oitenta }).nome).toHaveLength(80);
    for (const nome of ['Ana\nSouza', 'Ana​Souza', 'Ana\u0000']) {
      expect(campos(criarContaSchema, { ...cadastro, nome })).toEqual([
        {
          campo: 'nome',
          codigo: 'invalido',
          motivo: 'Confira o nome: tem caractere que não pode ser usado',
        },
      ]);
    }
  });

  it('nome com separador de linha ou parágrafo, uso privado ou não atribuído (R31, S73)', () => {
    for (const nome of [
      'Ana\u2028Souza',
      'Ana\u2029Souza',
      'Ana\ue000',
      'Ana\ud800',
      'Ana\u{e0080}',
    ]) {
      // Um erro só, no campo `nome`: o código (`invalido` ou `obrigatorio`) é do dev.
      expect(
        campos(criarContaSchema, { ...cadastro, nome }).map((erro) => erro.campo),
        JSON.stringify(nome),
      ).toEqual(['nome']);
    }
  });

  it('senha nova ou atual com metade de par substituto solta é recusada (S75)', () => {
    const motivo = 'Confira a senha: tem caractere que não pode ser usado';
    const senha = 'feira-do-bairro-\ud83d';
    expect(campos(criarContaSchema, { ...cadastro, senha })).toEqual([
      { campo: 'senha', codigo: 'invalido', motivo },
    ]);
    expect(
      campos(redefinirSenhaSchema, {
        email: 'ana@exemplo.com',
        codigo: '123456',
        novaSenha: senha,
      }),
    ).toEqual([{ campo: 'novaSenha', codigo: 'invalido', motivo }]);
    expect(campos(entrarSchema, { email: 'ana@exemplo.com', senha, cliente: 'painel' })).toEqual([
      { campo: 'senha', codigo: 'invalido', motivo },
    ]);
    expect(campos(solicitarExclusaoSchema, { senha: '\udc00' })).toEqual([
      { campo: 'senha', codigo: 'invalido', motivo },
    ]);
    expect(
      entrarSchema.safeParse({ email: 'ana@exemplo.com', senha: '🔑', cliente: 'painel' }).success,
    ).toBe(true);
  });

  it('senha longa demais', () => {
    expect(campos(criarContaSchema, { ...cadastro, senha: 'Xk7#pq2w'.repeat(16) + 'a' })).toEqual([
      { campo: 'senha', codigo: 'invalido', motivo: 'Use até 128 caracteres' },
    ]);
  });

  it('senha comum sai com o código "comum" pelo camposDoErroZod (S22)', () => {
    for (const senha of ['senha123', 'Flamengo2026', 'qwertyuiop', 'joaopedro123']) {
      expect(campos(criarContaSchema, { ...cadastro, senha }), senha).toEqual([
        {
          campo: 'senha',
          codigo: 'comum',
          motivo: 'Essa senha é muito comum. Escolha outra, mais difícil de adivinhar',
        },
      ]);
    }
  });

  it('senha só de dígitos e símbolos sai com "comum" e motivo próprio, num erro só (R34)', () => {
    for (const senha of ['12345678', '10203040', '!@#$%^&*', '1987-06-15']) {
      expect(campos(criarContaSchema, { ...cadastro, senha }), senha).toEqual([
        {
          campo: 'senha',
          codigo: 'comum',
          motivo: 'Use letras também: senha só com números e símbolos é fácil de adivinhar',
        },
      ]);
    }
  });

  it('a senha não é cortada nem normalizada', () => {
    const senha = '  feira do bairro 7  ';
    expect(criarContaSchema.parse({ ...cadastro, senha }).senha).toBe(senha);
  });

  it('campo desconhecido, inclusive perfil ou admin, gera "desconhecido" (CA-07, CA-13)', () => {
    expect(
      campos(criarContaSchema, {
        ...cadastro,
        perfis: ['admin'],
        admin: true,
        aceites: { ...cadastro.aceites, marketing: true },
      }),
    ).toEqual([
      { campo: 'aceites.marketing', codigo: 'desconhecido', motivo: 'Campo desconhecido.' },
      { campo: 'perfis', codigo: 'desconhecido', motivo: 'Campo desconhecido.' },
      { campo: 'admin', codigo: 'desconhecido', motivo: 'Campo desconhecido.' },
    ]);
  });

  it('o motivo nunca repete o valor recebido (CA-12)', () => {
    const recebido = {
      nome: 'Fulano\u0000',
      email: 'fulano.de.tal@',
      telefone: '(20) 98888-7777',
      senha: 'senha123',
      aceites: { termos: '1', privacidade: '1' },
    };
    const texto = JSON.stringify(campos(criarContaSchema, recebido));
    for (const valor of ['Fulano', 'fulano.de.tal', '98888', 'senha123']) {
      expect(texto).not.toContain(valor);
    }
  });

  it('resposta 202 com a mensagem fixa (CA-02)', () => {
    expect(MENSAGEM_DE_CADASTRO_ACEITO).toBe('Verifique seu e-mail para continuar.');
    expect(cadastroAceitoSchema.safeParse({ mensagem: MENSAGEM_DE_CADASTRO_ACEITO }).success).toBe(
      true,
    );
  });
});

describe('verificação de e-mail e conta (P1-dono)', () => {
  it('recebe só o código de 6 dígitos, sem e-mail: vale para a conta da sessão', () => {
    expect(verificarEmailSchema.parse({ codigo: ' 123 456 ' })).toEqual({ codigo: '123456' });
    expect(campos(verificarEmailSchema, { codigo: '123456', email: 'ana@exemplo.com' })).toEqual([
      { campo: 'email', codigo: 'desconhecido', motivo: 'Campo desconhecido.' },
    ]);
    expect(campos(verificarEmailSchema, { codigo: '12345' })).toEqual([
      {
        campo: 'codigo',
        codigo: 'invalido',
        motivo: 'Código inválido ou expirado. Confira ou peça um novo.',
      },
    ]);
    expect(campos(verificarEmailSchema, { codigo: 123456 })[0]?.codigo).toBe('invalido');
  });

  it('rota sem corpo aceita ausente ou {} e recusa qualquer campo (CA-13)', () => {
    expect(corpoVazioSchema.safeParse(undefined).success).toBe(true);
    expect(corpoVazioSchema.safeParse({}).success).toBe(true);
    expect(campos(corpoVazioSchema, { email: 'ana@exemplo.com' })).toEqual([
      { campo: 'email', codigo: 'desconhecido', motivo: 'Campo desconhecido.' },
    ]);
  });

  it('GET /v1/conta tolera perfil novo e campo novo', () => {
    expect(PERFIS).toEqual(['consumidor', 'lojista', 'admin']);
    const conta = { nome: 'Ana', emailMascarado: 'a***@exemplo.com', perfis: ['consumidor'] };
    expect(contaSchema.safeParse(conta).success).toBe(true);
    expect(contaSchema.safeParse({ ...conta, perfis: ['futuro'], extra: 1 }).success).toBe(true);
  });
});

describe('sessões', () => {
  const sessao = {
    tokenAcesso: 'eyJ.x.y',
    expiraEm: '2026-10-16T12:15:00.000Z',
    emailVerificado: false,
    tokenRenovacao: 'abc_DEF-123',
  };

  it('a sessão traz emailVerificado; tokenRenovacao só fora do painel (P1-dono)', () => {
    expect(sessaoSchema.safeParse(sessao).success).toBe(true);
    const { tokenRenovacao: _, ...doPainel } = sessao;
    expect(sessaoSchema.safeParse(doPainel).success).toBe(true);
    const { emailVerificado: __, ...semVerificacao } = sessao;
    expect(sessaoSchema.safeParse(semVerificacao).success).toBe(false);
    expect(sessaoSchema.safeParse({ ...sessao, expiraEm: '16/10/2026' }).success).toBe(false);
  });

  it('a data da sessão é lida com ou sem deslocamento (R32)', () => {
    for (const expiraEm of ['2026-10-16T12:15:00Z', '2026-10-16T09:15:00-03:00']) {
      expect(sessaoSchema.safeParse({ ...sessao, expiraEm }).success, expiraEm).toBe(true);
    }
    expect(sessaoSchema.safeParse({ ...sessao, expiraEm: '2026-10-16' }).success).toBe(false);
  });

  it('a resposta de entrar é a sessão ou o desafio do 2FA (S1)', () => {
    expect(respostaDeEntrarSchema.safeParse(sessao).success).toBe(true);
    expect(respostaDeEntrarSchema.safeParse({ etapa: 'configurar', desafio: 'd' }).success).toBe(
      true,
    );
    expect(respostaDeEntrarSchema.safeParse({ etapa: 'outra', desafio: 'd' }).success).toBe(false);
  });

  it('entrar não aplica a regra de senha nova: senha antiga ou comum chega à API', () => {
    const entrada = { email: 'Ana@Exemplo.com', senha: '123', cliente: 'app_consumidor' };
    expect(entrarSchema.parse(entrada)).toEqual({ ...entrada, email: 'ana@exemplo.com' });
    expect(campos(entrarSchema, { ...entrada, senha: 'a'.repeat(129) })).toEqual([
      { campo: 'senha', codigo: 'invalido', motivo: 'Use até 128 caracteres' },
    ]);
  });

  it('entrar exige cliente conhecido e recusa campo desconhecido', () => {
    const entrada = { email: 'ana@exemplo.com', senha: 'x', cliente: 'painel' };
    expect(entrarSchema.safeParse(entrada).success).toBe(true);
    expect(campos(entrarSchema, { ...entrada, cliente: 'admin' })[0]).toMatchObject({
      campo: 'cliente',
      codigo: 'invalido',
    });
    expect(campos(entrarSchema, { ...entrada, mfa: true })).toEqual([
      { campo: 'mfa', codigo: 'desconhecido', motivo: 'Campo desconhecido.' },
    ]);
  });

  it('renovação nos apps leva o token; formato estranho é recusado sem repetir o valor', () => {
    const cliente = 'app_consumidor';
    expect(renovarSessaoSchema.safeParse({ tokenRenovacao: 'abc_DEF-123', cliente }).success).toBe(
      true,
    );
    expect(CABECALHO_DO_CLIENTE).toBe('X-Cliente');
    for (const tokenRenovacao of ['com espaço', 'a'.repeat(513), 'tok"en']) {
      const [campo] = campos(renovarSessaoSchema, { tokenRenovacao, cliente });
      expect(campo).toEqual({
        campo: 'tokenRenovacao',
        codigo: 'invalido',
        motivo: 'Token inválido',
      });
    }
  });

  it('renovação pelo corpo exige o cliente do app; painel e outros valores dão 400 (S16)', () => {
    const tokenRenovacao = 'abc_DEF-123';
    for (const cliente of ['app_consumidor', 'app_lojista']) {
      expect(renovarSessaoSchema.parse({ tokenRenovacao, cliente })).toEqual({
        tokenRenovacao,
        cliente,
      });
      expect(clienteDoAppSchema.safeParse(cliente).success, cliente).toBe(true);
    }
    // Ausente também é `invalido`, como o `cliente` de entrar: o motivo lista as opções.
    expect(campos(renovarSessaoSchema, { tokenRenovacao })).toEqual([
      {
        campo: 'cliente',
        codigo: 'invalido',
        motivo: 'Opção inválida: esperava uma das seguintes opções: "app_consumidor"|"app_lojista"',
      },
    ]);
    for (const cliente of ['painel', 'admin', 'APP_CONSUMIDOR', '', null, 1]) {
      const resultado = campos(renovarSessaoSchema, { tokenRenovacao, cliente });
      expect(resultado, JSON.stringify(cliente)).toHaveLength(1);
      expect(resultado[0], JSON.stringify(cliente)).toMatchObject({
        campo: 'cliente',
        codigo: 'invalido',
      });
    }
    expect(clienteDoAppSchema.safeParse('painel').success).toBe(false);
  });
});

describe('senha (CA-06)', () => {
  it('a recuperação recebe só o e-mail', () => {
    expect(solicitarRecuperacaoSchema.parse({ email: ' ANA@exemplo.com' })).toEqual({
      email: 'ana@exemplo.com',
    });
    expect(campos(solicitarRecuperacaoSchema, { email: 'x' })[0]?.codigo).toBe('invalido');
  });

  it('a redefinição aplica a regra de senha nova, inclusive a lista de comuns', () => {
    const entrada = { email: 'ana@exemplo.com', codigo: '012345', novaSenha: 'feira-do-bairro-7' };
    expect(redefinirSenhaSchema.parse(entrada)).toEqual(entrada);
    expect(campos(redefinirSenhaSchema, { ...entrada, novaSenha: 'senha@123' })).toEqual([
      {
        campo: 'novaSenha',
        codigo: 'comum',
        motivo: 'Essa senha é muito comum. Escolha outra, mais difícil de adivinhar',
      },
    ]);
    expect(campos(redefinirSenhaSchema, { email: entrada.email }).map((c) => c.campo)).toEqual([
      'codigo',
      'novaSenha',
    ]);
  });
});

describe('segundo fator (CA-09, S1)', () => {
  it('configuração e confirmação recebem o desafio', () => {
    expect(iniciarConfiguracaoSchema.safeParse({ desafio: 'desafio-1' }).success).toBe(true);
    expect(campos(iniciarConfiguracaoSchema, {})[0]?.codigo).toBe('obrigatorio');
    expect(confirmarConfiguracaoSchema.parse({ desafio: 'desafio-1', codigo: '654321' })).toEqual({
      desafio: 'desafio-1',
      codigo: '654321',
    });
  });

  it('a confirmação devolve os códigos de recuperação e a sessão', () => {
    const resposta = {
      codigosRecuperacao: Array.from({ length: 10 }, () => 'ABCDE23456'),
      sessao: { tokenAcesso: 't', expiraEm: '2026-10-16T12:15:00Z', emailVerificado: true },
    };
    expect(segundoFatorConfirmadoSchema.safeParse(resposta).success).toBe(true);
    const { codigosRecuperacao: _, ...semCodigos } = resposta;
    expect(segundoFatorConfirmadoSchema.safeParse(semCodigos).success).toBe(false);
  });

  it('leitura tolerante: quantidade e tamanho dos códigos são regra da API (R32)', () => {
    const sessao = { tokenAcesso: 't', expiraEm: '2026-10-16T12:15:00Z', emailVerificado: true };
    for (const codigosRecuperacao of [
      Array.from({ length: 9 }, () => 'ABCDE23456'),
      Array.from({ length: 12 }, () => 'ABCDEF234567'),
    ]) {
      expect(segundoFatorConfirmadoSchema.safeParse({ codigosRecuperacao, sessao }).success).toBe(
        true,
      );
    }
  });

  it('código do app autenticador fora do formato sai com o motivo da tela P1a (R33)', () => {
    const motivo = 'Código inválido ou expirado. Confira o horário do celular e tente de novo.';
    expect(codigoDoAutenticadorSchema.parse(' 123 456 ')).toBe('123456');
    expect(campos(confirmarConfiguracaoSchema, { desafio: 'd', codigo: '12345' })).toEqual([
      { campo: 'codigo', codigo: 'invalido', motivo },
    ]);
    expect(campos(verificarSegundoFatorSchema, { desafio: 'd', codigo: 'abcdef' })).toEqual([
      { campo: 'codigo', codigo: 'invalido', motivo },
    ]);
    // O código do e-mail continua com o motivo da spec 01, A3.
    expect(campos(verificarEmailSchema, { codigo: '12345' })).toEqual([
      {
        campo: 'codigo',
        codigo: 'invalido',
        motivo: 'Código inválido ou expirado. Confira ou peça um novo.',
      },
    ]);
    expect(codigoSchema.safeParse('123456').success).toBe(true);
  });

  it('a verificação aceita exatamente um código: TOTP ou de recuperação', () => {
    expect(verificarSegundoFatorSchema.parse({ desafio: 'd', codigo: '123456' })).toEqual({
      desafio: 'd',
      codigo: '123456',
    });
    expect(
      verificarSegundoFatorSchema.parse({ desafio: 'd', codigoRecuperacao: 'abcde-23456' }),
    ).toEqual({ desafio: 'd', codigoRecuperacao: 'ABCDE23456' });
    const motivo = 'Informe o código do app autenticador ou um código de recuperação';
    expect(campos(verificarSegundoFatorSchema, { desafio: 'd' })).toEqual([
      { campo: 'codigo', codigo: 'obrigatorio', motivo },
    ]);
    expect(
      campos(verificarSegundoFatorSchema, {
        desafio: 'd',
        codigo: '123456',
        codigoRecuperacao: 'ABCDE23456',
      }),
    ).toEqual([{ campo: 'codigo', codigo: 'invalido', motivo }]);
  });

  it('código de recuperação fora do formato', () => {
    expect(codigoDeRecuperacaoSchema.safeParse('ABCDE2345').success).toBe(false);
    expect(campos(verificarSegundoFatorSchema, { desafio: 'd', codigoRecuperacao: '1' })).toEqual([
      {
        campo: 'codigoRecuperacao',
        codigo: 'invalido',
        motivo: 'Código de recuperação inválido. Confira e tente de novo.',
      },
    ]);
  });
});

describe('privacidade (CA-10, CA-11)', () => {
  it('a consulta traz versão da política, data do aceite e prazo da cópia', () => {
    const privacidade = {
      politica: { versao: '1', conteudo: 'texto' },
      termos: { versao: '1' },
      aceitoEm: '2026-10-16T12:00:00.000Z',
      exportacaoDisponivelAte: null,
    };
    expect(privacidadeSchema.safeParse(privacidade).success).toBe(true);
    expect(privacidadeSchema.safeParse({ ...privacidade, aceitoEm: null }).success).toBe(true);
    const { aceitoEm: _, ...semAceite } = privacidade;
    expect(privacidadeSchema.safeParse(semAceite).success).toBe(false);
  });

  it('as datas da privacidade são lidas com ou sem deslocamento (R32)', () => {
    const privacidade = {
      politica: { versao: '1', conteudo: 'texto' },
      termos: { versao: '1' },
      aceitoEm: '2026-10-16T09:00:00-03:00',
      exportacaoDisponivelAte: '2026-10-23T09:00:00.000-03:00',
    };
    expect(privacidadeSchema.safeParse(privacidade).success).toBe(true);
  });

  it('a exclusão pede a senha atual, sem a regra de senha nova', () => {
    expect(solicitarExclusaoSchema.safeParse({ senha: 'senha123' }).success).toBe(true);
    expect(campos(solicitarExclusaoSchema, {})).toEqual([
      { campo: 'senha', codigo: 'obrigatorio', motivo: 'Campo obrigatório.' },
    ]);
  });
});

describe('eventos v1 da Identidade', () => {
  const contaId = '0199f0a2-7c3e-7d4a-9b1e-123456789abc';
  const eventos = Object.entries(EVENTOS_DE_IDENTIDADE);

  it('são os nove do plano (com o SegundoFatorFreado do S92), com tipo "identidade.<Fato>" e versão 1', () => {
    expect(eventos.map(([nome]) => nome)).toEqual([
      'ContaCriada',
      'CadastroRepetidoTentado',
      'VerificacaoReenviada',
      'RecuperacaoSolicitada',
      'SenhaRedefinida',
      'ExportacaoSolicitada',
      'ContaDesativada',
      'ContaAnonimizada',
      'SegundoFatorFreado',
    ]);
    for (const [nome, evento] of eventos) {
      expect(evento.tipo).toBe(`identidade.${nome}`);
      // Mesmo formato que o publicador da API exige (`FORMATO_DO_TIPO`).
      expect(evento.tipo).toMatch(/^[a-z][a-z0-9]*\.[A-Z][A-Za-z0-9]*$/);
      expect(evento.versao).toBe(1);
    }
  });

  it('o payload leva só ids e recusa qualquer outro campo, como e-mail ou código', () => {
    for (const [nome, evento] of eventos) {
      const payload =
        nome === 'ExportacaoSolicitada'
          ? { contaId, solicitacaoId: '0199f0a2-7c3e-7d4a-9b1e-cba987654321' }
          : { contaId };
      expect(evento.payload.safeParse(payload).success, nome).toBe(true);
      for (const extra of [{ email: 'ana@exemplo.com' }, { codigo: '123456' }, { nome: 'Ana' }]) {
        expect(evento.payload.safeParse({ ...payload, ...extra }).success, nome).toBe(false);
      }
      expect(evento.payload.safeParse({ ...payload, contaId: 'ana@exemplo.com' }).success).toBe(
        false,
      );
    }
  });
});

/** Todo corpo de entrada do 01b, com uma entrada válida. */
const CORPOS = [
  ['POST /v1/contas', criarContaSchema, cadastro],
  ['POST /v1/conta/verificacao-email', verificarEmailSchema, { codigo: '123456' }],
  [
    'POST /v1/sessoes',
    entrarSchema,
    { email: 'ana@exemplo.com', senha: 'senha atual', cliente: 'painel' },
  ],
  [
    'POST /v1/sessoes/renovacao',
    renovarSessaoSchema,
    { tokenRenovacao: 'abc.def-ghi_jkl', cliente: 'app_lojista' },
  ],
  ['POST /v1/senha/recuperacao', solicitarRecuperacaoSchema, { email: 'ana@exemplo.com' }],
  [
    'POST /v1/senha/redefinicao',
    redefinirSenhaSchema,
    { email: 'ana@exemplo.com', codigo: '123456', novaSenha: 'feira-do-bairro-7' },
  ],
  ['POST /v1/segundo-fator/configuracao', iniciarConfiguracaoSchema, { desafio: 'abc.def' }],
  [
    'POST /v1/segundo-fator/confirmacao',
    confirmarConfiguracaoSchema,
    { desafio: 'abc.def', codigo: '123456' },
  ],
  [
    'POST /v1/sessoes/segundo-fator',
    verificarSegundoFatorSchema,
    { desafio: 'abc.def', codigo: '123456' },
  ],
  ['POST /v1/privacidade/exclusao', solicitarExclusaoSchema, { senha: 'senha atual' }],
  ['rota sem corpo', corpoVazioSchema, {}],
] as const satisfies readonly (readonly [string, z.ZodType, unknown])[];

describe('campo desconhecido em todo corpo de entrada (CA-13, QA)', () => {
  it.each(CORPOS)('%s: a entrada de referência é válida', (_rota, esquema, valido) => {
    expect(esquema.safeParse(valido).success).toBe(true);
  });

  it.each(CORPOS)(
    '%s: um campo a mais gera um erro "desconhecido" só dele',
    (_rota, esquema, valido) => {
      expect(campos(esquema, { ...valido, campoQueNaoExiste: 1 })).toEqual([
        { campo: 'campoQueNaoExiste', codigo: 'desconhecido', motivo: 'Campo desconhecido.' },
      ]);
    },
  );

  it.each(CORPOS)('%s: vários campos a mais, um erro por campo', (_rota, esquema, valido) => {
    expect(campos(esquema, { ...valido, a: 1, b: null, c: 'x' }).map((c) => c.campo)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it.each(CORPOS)(
    '%s: perfil, admin e papel nunca entram por aqui (CA-07)',
    (_rota, esquema, valido) => {
      const resultado = campos(esquema, {
        ...valido,
        perfis: ['admin'],
        admin: true,
        role: 'admin',
      });
      expect(resultado.map((c) => c.campo)).toEqual(['perfis', 'admin', 'role']);
      expect(resultado.every((c) => c.codigo === 'desconhecido')).toBe(true);
    },
  );

  it('chave __proto__ vinda do JSON é campo desconhecido, não muda o protótipo', () => {
    const corpo = JSON.parse(`{"codigo":"123456","__proto__":{"admin":true}}`) as Record<
      string,
      unknown
    >;
    expect(campos(verificarEmailSchema, corpo)).toEqual([
      { campo: '__proto__', codigo: 'desconhecido', motivo: 'Campo desconhecido.' },
    ]);
  });

  it('chave desconhecida muito longa sai cortada em 100 caracteres, e o motivo é fixo', () => {
    const chave = 'k'.repeat(5000);
    const [erro, ...resto] = campos(verificarEmailSchema, { codigo: '123456', [chave]: 1 });
    expect(resto).toEqual([]);
    expect(erro?.campo).toHaveLength(100);
    expect(erro?.motivo).toBe('Campo desconhecido.');
  });

  it('aceites aninhado também é estrito, e o caminho do erro sai com ponto', () => {
    expect(
      campos(criarContaSchema, {
        ...cadastro,
        aceites: { ...cadastro.aceites, marketing: true, termos: '' },
      }),
    ).toEqual([
      { campo: 'aceites.termos', codigo: 'obrigatorio', motivo: 'Campo obrigatório.' },
      { campo: 'aceites.marketing', codigo: 'desconhecido', motivo: 'Campo desconhecido.' },
    ]);
  });

  it('corpo que não é objeto vira um erro só, no campo "corpo"', () => {
    for (const corpo of [null, 5, 'texto', true, []]) {
      for (const [, esquema] of CORPOS.filter(([rota]) => rota !== 'rota sem corpo')) {
        const resultado = campos(esquema, corpo);
        expect(resultado, JSON.stringify(corpo)).toHaveLength(1);
        expect(resultado[0]).toMatchObject({ campo: 'corpo', codigo: 'invalido' });
      }
    }
  });
});

describe('um erro por campo e motivo sem o valor recebido (CA-12, CA-13, QA)', () => {
  /** Valores que o cliente pode mandar no lugar de um texto (JSON válido). */
  const HOSTIS: readonly unknown[] = [
    null,
    0,
    5,
    true,
    false,
    {},
    { length: 5 },
    '',
    '   ',
    '\u0000',
  ];

  /** Campos de nível raiz de cada corpo, com o valor válido de referência. */
  const camposDe = (valido: object) => Object.entries(valido);

  const casos = CORPOS.flatMap(([rota, esquema, valido]) =>
    camposDe(valido).map(([campo]) => [rota, campo, esquema, valido] as const),
  );

  it.each(casos)(
    '%s, campo %s: valor de outro tipo ou vazio gera no máximo um erro por caminho',
    (_rota, campo, esquema, valido) => {
      for (const hostil of HOSTIS) {
        const resultado = esquema.safeParse({ ...valido, [campo]: hostil });
        if (resultado.success) continue;
        const caminhos = camposDoErroZod(resultado.error).map((erro) => erro.campo);
        expect(caminhos, `${campo} = ${JSON.stringify(hostil)}`).toEqual([...new Set(caminhos)]);
      }
    },
  );

  it('texto vazio ou só com espaços é "obrigatorio" em todo campo de texto', () => {
    for (const [rota, esquema, valido] of CORPOS) {
      for (const [campo, valor] of Object.entries(valido)) {
        if (typeof valor !== 'string' || campo === 'cliente') continue;
        // Senha atual e nova não cortam o texto: só o vazio é "obrigatorio".
        const vazio = campos(esquema, { ...valido, [campo]: '' });
        expect(vazio, `${rota} ${campo}`).toEqual([
          { campo, codigo: 'obrigatorio', motivo: 'Campo obrigatório.' },
        ]);
      }
    }
  });

  it('nenhum motivo repete o valor recebido, em nenhum campo de nenhum corpo', () => {
    const segredos = ['SEGREDO4711', 'SEGREDO4711\u0000@', 'segredo4711@exemplo', 'SEGREDO 4711 ç'];
    for (const [rota, esquema, valido] of CORPOS) {
      for (const [campo, valor] of Object.entries(valido)) {
        if (typeof valor !== 'string') continue;
        for (const segredo of segredos) {
          const resultado = esquema.safeParse({ ...valido, [campo]: segredo });
          if (resultado.success) continue;
          const saida = JSON.stringify(camposDoErroZod(resultado.error));
          expect(saida, `${rota} ${campo}`).not.toMatch(/segredo|4711/i);
        }
      }
    }
  });

  it('o valor numérico, booleano ou objeto no lugar do texto também não volta no motivo', () => {
    const saida = JSON.stringify(
      campos(criarContaSchema, {
        ...cadastro,
        nome: 987654321,
        email: { valor: 'segredo4711' },
        senha: ['segredo4711'],
      }),
    );
    expect(saida).not.toMatch(/segredo|4711|987654321/);
  });

  it('com todos os campos errados, sai um erro de cada, na ordem do esquema', () => {
    const resultado = campos(criarContaSchema, {
      nome: '',
      email: 'sem-arroba',
      telefone: '(20) 98888-7777',
      senha: 'curta',
      aceites: { termos: '', privacidade: '../x' },
    });
    expect(resultado.map((c) => [c.campo, c.codigo])).toEqual([
      ['nome', 'obrigatorio'],
      ['email', 'invalido'],
      ['telefone', 'invalido'],
      ['senha', 'invalido'],
      ['aceites.termos', 'obrigatorio'],
      ['aceites.privacidade', 'invalido'],
    ]);
  });

  it('nome de até 80 pontos de código passa, mesmo com emoji; com 81, não', () => {
    expect(criarContaSchema.safeParse({ ...cadastro, nome: '😀'.repeat(80) }).success).toBe(true);
    expect(campos(criarContaSchema, { ...cadastro, nome: '😀'.repeat(81) })).toEqual([
      { campo: 'nome', codigo: 'invalido', motivo: 'Use até 80 caracteres' },
    ]);
  });

  it('o token só aceita base64url, ponto e hífen: espaço e letra acentuada são recusados', () => {
    for (const tokenRenovacao of ['abc def', 'abc\tdef', 'tóken', 'abc+def', 'abc/def', 'abc=']) {
      expect(
        campos(renovarSessaoSchema, { tokenRenovacao, cliente: 'app_consumidor' }),
        tokenRenovacao,
      ).toEqual([{ campo: 'tokenRenovacao', codigo: 'invalido', motivo: 'Token inválido' }]);
    }
    expect(
      renovarSessaoSchema.safeParse({ tokenRenovacao: 'v1.AbC-d_e.f', cliente: 'app_consumidor' })
        .success,
    ).toBe(true);
  });

  it('a senha de login vale até 128 pontos de código e a de cadastro também', () => {
    const emojis = (n: number) =>
      Array.from({ length: n }, (_, i) => String.fromCodePoint(0x1f600 + i)).join('');
    const entrar = { email: 'ana@exemplo.com', cliente: 'painel' };
    expect(entrarSchema.safeParse({ ...entrar, senha: emojis(128) }).success).toBe(true);
    expect(campos(entrarSchema, { ...entrar, senha: emojis(129) })).toEqual([
      { campo: 'senha', codigo: 'invalido', motivo: 'Use até 128 caracteres' },
    ]);
    expect(criarContaSchema.safeParse({ ...cadastro, senha: emojis(128) }).success).toBe(true);
    expect(campos(criarContaSchema, { ...cadastro, senha: emojis(129) })[0]?.motivo).toBe(
      'Use até 128 caracteres',
    );
  });

  // Q14: `[]` (e `{"length": 0}`) no lugar do texto passa pelo `.min(1)` e gera um segundo erro,
  // "Pequeno demais ... vetor", no mesmo campo.
  it('vetor vazio ou objeto com length 0 no lugar do texto gera um erro só (Q14)', () => {
    for (const [rota, esquema, valido] of CORPOS) {
      for (const [campo, valor] of Object.entries(valido)) {
        if (typeof valor !== 'string' || campo === 'cliente') continue;
        for (const hostil of [[], { length: 0 }]) {
          const resultado = campos(esquema, { ...valido, [campo]: hostil }).filter(
            (erro) => erro.campo === campo,
          );
          expect(resultado, `${rota} ${campo} = ${JSON.stringify(hostil)}`).toHaveLength(1);
        }
      }
    }
  });
});

describe('um erro por campo também em campo aninhado e com length grande (Q14)', () => {
  /** Valores com `length` que não são texto: os checks de tamanho do zod rodariam neles. */
  const COM_LENGTH: readonly unknown[] = [
    [],
    ['a'],
    Array.from({ length: 600 }, () => 'a'),
    { length: 0 },
    { length: 5 },
    { length: 1000 },
  ];

  /** Caminhos de texto de cada corpo, inclusive dentro de objetos aninhados. */
  function caminhosDeTexto(valor: object, prefixo: string[] = []): string[][] {
    return Object.entries(valor as Record<string, unknown>).flatMap(([chave, filho]) => {
      if (typeof filho === 'string') return [[...prefixo, chave]];
      if (filho !== null && typeof filho === 'object')
        return caminhosDeTexto(filho, [...prefixo, chave]);
      return [];
    });
  }

  function trocar(valor: object, caminho: readonly string[], novo: unknown): object {
    const [chave, ...resto] = caminho;
    if (chave === undefined) return valor;
    const atual = (valor as Record<string, unknown>)[chave];
    return {
      ...valor,
      [chave]: resto.length === 0 ? novo : trocar(atual as object, resto, novo),
    };
  }

  it('em todo campo de texto de todo corpo, sai exatamente um erro', () => {
    for (const [rota, esquema, valido] of CORPOS) {
      for (const caminho of caminhosDeTexto(valido)) {
        for (const hostil of COM_LENGTH) {
          const resultado = esquema.safeParse(trocar(valido, caminho, hostil));
          expect(resultado.success, `${rota} ${caminho.join('.')}`).toBe(false);
          if (resultado.success) continue;
          const erros = camposDoErroZod(resultado.error);
          const descricao = `${rota} ${caminho.join('.')} = ${JSON.stringify(hostil).slice(0, 40)}`;
          expect(
            erros.map(({ campo, codigo }) => [campo, codigo]),
            descricao,
          ).toEqual([[caminho.join('.'), 'invalido']]);
          expect(erros[0]?.motivo, descricao).not.toBe('');
        }
      }
    }
  });
});

// QA da etapa 5b (S73, R34, S74): os dois corpos com senha nova e o cadastro com nome.
describe('QA da etapa 5b: nome, motivo próprio e login', () => {
  const MOTIVO_SO_DIGITOS =
    'Use letras também: senha só com números e símbolos é fácil de adivinhar';
  const redefinicao = {
    email: 'ana@exemplo.com',
    codigo: '012345',
    novaSenha: 'feira-do-bairro-7',
  };

  it('nome feito só de seletor de emoji (U+FE0F, U+FE0E) é recusado no cadastro (S73)', () => {
    for (const nome of ['️', '︎', '️️', ' ️ ']) {
      // Um erro só, no campo `nome`: o código (`invalido` ou `obrigatorio`) é do dev.
      expect(
        campos(criarContaSchema, { ...cadastro, nome }).map((erro) => erro.campo),
        JSON.stringify(nome),
      ).toEqual(['nome']);
    }
  });

  it('nome com emoji e seletor continua aceito no cadastro', () => {
    expect(criarContaSchema.parse({ ...cadastro, nome: ' Ana ❤️ ' }).nome).toBe('Ana ❤️');
  });

  it('a redefinição também dá o motivo próprio à senha só de dígitos e símbolos (R34)', () => {
    expect(campos(redefinirSenhaSchema, { ...redefinicao, novaSenha: '10203040' })).toEqual([
      { campo: 'novaSenha', codigo: 'comum', motivo: MOTIVO_SO_DIGITOS },
    ]);
    expect(campos(redefinirSenhaSchema, { ...redefinicao, novaSenha: 'joaopedro123' })).toEqual([
      {
        campo: 'novaSenha',
        codigo: 'comum',
        motivo: 'Essa senha é muito comum. Escolha outra, mais difícil de adivinhar',
      },
    ]);
  });

  it('senha curta só de dígitos fica "curta": o tamanho vem antes do motivo próprio', () => {
    expect(campos(criarContaSchema, { ...cadastro, senha: '1234567' })).toEqual([
      { campo: 'senha', codigo: 'invalido', motivo: 'Use 8 caracteres ou mais' },
    ]);
  });

  it('o login aceita a senha de conta antiga mesmo que hoje seja só de dígitos ou comum', () => {
    for (const senha of ['12345678', '10203040', 'joaopedro123', 'senhasenha']) {
      expect(
        entrarSchema.safeParse({ email: 'ana@exemplo.com', senha, cliente: 'painel' }).success,
        senha,
      ).toBe(true);
    }
  });

  it('o cadastro não recusa por regra de forma uma senha forte parecida com as recusadas', () => {
    for (const senha of ['joaopedro-feira-77', 'Gabriel&Silva#Zq9', 'sen-ha-Xk7q-Lm2z']) {
      expect(criarContaSchema.safeParse({ ...cadastro, senha }).success, senha).toBe(true);
    }
  });
});
