// Assinantes da Identidade (plano 01b, etapa 13; CA-01, CA-02, CA-06, CA-10;
// P4, S10, S15, S92, S93): o código nasce no envio, com HMAC ligado à conta e à
// finalidade, invalida o anterior e respeita o teto de 10 por dia; o aviso de
// cadastro repetido sai no máximo uma vez por hora por e-mail; a exportação só
// avisa quando foi gerada; o aviso do freio do 2FA muda com a senha apagada; o
// destinatário é sempre o e-mail normalizado da conta, lido pelo id do payload.
import { describe, expect, it, vi } from 'vitest';
import type { EventoPublicado } from '../../../../compartilhado/eventos/assinantes.ts';
import { EventoInvalido } from '../../../../compartilhado/eventos/publicador.ts';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import { EnviadorDeEmailFalso } from '../../../../../test/fakes/compartilhado/enviador-de-email-falso.ts';
import {
  criarIdentidadeEmMemoria,
  type IdentidadeEmMemoria,
} from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import {
  CifradorFalso,
  GeradorDeSegredosFalso,
} from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { Conta } from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import { Telefone } from '../../dominio/telefone.ts';
import { chaveDoFreioPorEmail } from '../comum/chaves.ts';
import { GerarExportacaoCasoDeUso } from '../privacidade/gerar-exportacao.ts';
import {
  AvisarCadastroRepetidoAssinante,
  chaveDoAvisoDeCadastroRepetido,
  INTERVALO_ENTRE_AVISOS_EM_MS,
} from './avisar-cadastro-repetido.assinante.ts';
import { AvisarSegundoFatorFreadoAssinante } from './avisar-segundo-fator-freado.assinante.ts';
import { JANELA_DO_TETO_EM_MS, TETO_DE_CODIGOS_POR_DIA } from './comum.ts';
import { EnviarCodigoDeRecuperacaoAssinante } from './enviar-codigo-de-recuperacao.assinante.ts';
import { EnviarCodigoDeVerificacaoAssinante } from './enviar-codigo-de-verificacao.assinante.ts';
import { GerarExportacaoAssinante } from './gerar-exportacao.assinante.ts';
import {
  type ConteudoDoEmail,
  type DadosDoCodigo,
  ModelosDeEmailDaIdentidade,
  type NomeNaSaudacao,
} from './modelos-de-email.ts';

const AGORA = new Date('2026-10-20T12:00:00.000Z');
const UMA_HORA = 60 * 60 * 1000;
const CONTA = 'f0f0f0f0-0000-4000-8000-000000000001';
const OUTRA_CONTA = 'f0f0f0f0-0000-4000-8000-000000000002';
const SOLICITACAO = 'f1f1f1f1-0000-4000-8000-000000000001';
const EMAIL_DIGITADO = 'Ana.Souza@Exemplo.com';
const EMAIL_NORMALIZADO = 'ana.souza@exemplo.com';

/** Como o modelo falso escreve a saudação sem nome (e-mail não verificado, S102). */
const SEM_NOME = '(sem nome)';
const nomeOuSemNome = (nome: NomeNaSaudacao): string => nome ?? SEM_NOME;

/** Modelos falsos: o assunto diz qual modelo saiu, e o texto leva os dados. */
class ModelosFalsos extends ModelosDeEmailDaIdentidade {
  override codigoDeVerificacao({ codigo }: { codigo: string }): ConteudoDoEmail {
    return { assunto: 'verificacao', texto: `${SEM_NOME}|${codigo}`, html: '' };
  }
  override cadastroRepetido({ nome }: { nome: NomeNaSaudacao }): ConteudoDoEmail {
    return { assunto: 'cadastro_repetido', texto: nomeOuSemNome(nome), html: '' };
  }
  override codigoDeRecuperacao({ nome, codigo }: DadosDoCodigo): ConteudoDoEmail {
    return { assunto: 'recuperacao', texto: `${nomeOuSemNome(nome)}|${codigo}`, html: '' };
  }
  override exportacaoPronta(dados: { nome: NomeNaSaudacao; disponivelAte: Date }): ConteudoDoEmail {
    return {
      assunto: 'exportacao',
      texto: `${nomeOuSemNome(dados.nome)}|${dados.disponivelAte.toISOString()}`,
      html: '',
    };
  }
  override segundoFatorFreado(dados: {
    nome: NomeNaSaudacao;
    senhaRemovida: boolean;
  }): ConteudoDoEmail {
    return {
      assunto: dados.senhaRemovida ? 'senha_removida' : 'segundo_fator_freado',
      texto: nomeOuSemNome(dados.nome),
      html: '',
    };
  }
}

const cifrador = new CifradorFalso();
const modelos = new ModelosFalsos();

function cenario() {
  const identidade = criarIdentidadeEmMemoria();
  const relogio = new RelogioFixo(AGORA);
  const gerador = new GeradorDeSegredosFalso();
  const enviador = new EnviadorDeEmailFalso();
  const verificacao = new EnviarCodigoDeVerificacaoAssinante(
    identidade.unidade,
    relogio,
    identidade.contas,
    identidade.codigos,
    cifrador,
    gerador,
    modelos,
    enviador,
  );
  const recuperacao = new EnviarCodigoDeRecuperacaoAssinante(
    identidade.unidade,
    relogio,
    identidade.contas,
    identidade.codigos,
    cifrador,
    gerador,
    modelos,
    enviador,
  );
  const cadastroRepetido = new AvisarCadastroRepetidoAssinante(
    identidade.unidade,
    relogio,
    identidade.contas,
    identidade.bloqueios,
    cifrador,
    modelos,
    enviador,
  );
  const gerar = new GerarExportacaoCasoDeUso(
    identidade.unidade,
    identidade.contas,
    identidade.documentos,
    identidade.segundoFator,
    identidade.solicitacoes,
    identidade.exportacoes,
    cifrador,
    gerador,
    relogio,
  );
  const exportacao = new GerarExportacaoAssinante(
    identidade.unidade,
    identidade.contas,
    gerar,
    modelos,
    enviador,
  );
  const segundoFator = new AvisarSegundoFatorFreadoAssinante(
    identidade.unidade,
    identidade.contas,
    modelos,
    enviador,
  );
  return {
    identidade,
    relogio,
    gerador,
    enviador,
    verificacao,
    recuperacao,
    cadastroRepetido,
    exportacao,
    segundoFator,
  };
}

let sequencia = 0;

/** O evento como o pg-boss entrega ao assinante. */
function evento(
  tipo: string,
  payload: Record<string, string>,
  agregadoId = payload['contaId'] ?? CONTA,
): EventoPublicado {
  sequencia += 1;
  return {
    id: `e0e0e0e0-0000-4000-8000-${String(sequencia).padStart(12, '0')}`,
    tipo,
    versao: 1,
    agregadoId,
    payload,
    ocorridoEm: AGORA.toISOString(),
  };
}

const ContaCriada = (contaId = CONTA) => evento('identidade.ContaCriada', { contaId });
const VerificacaoReenviada = (contaId = CONTA) =>
  evento('identidade.VerificacaoReenviada', { contaId });
const RecuperacaoSolicitada = (contaId = CONTA) =>
  evento('identidade.RecuperacaoSolicitada', { contaId });
const CadastroRepetidoTentado = (contaId = CONTA) =>
  evento('identidade.CadastroRepetidoTentado', { contaId });

/** Como o `EntregadorDeEventos`: o assinante roda dentro de uma unidade de trabalho. */
async function entregar(
  identidade: IdentidadeEmMemoria,
  assinante: { tratar(evento: EventoPublicado): Promise<void> },
  entregue: EventoPublicado,
): Promise<void> {
  await identidade.unidade.executar(() => assinante.tratar(entregue));
}

async function inserirConta(
  identidade: IdentidadeEmMemoria,
  opcoes: {
    id?: string;
    email?: string;
    nome?: string;
    verificada?: boolean;
    desativada?: boolean;
    semSenha?: boolean;
  } = {},
): Promise<void> {
  const conta = Conta.criar({
    id: opcoes.id ?? CONTA,
    nome: opcoes.nome ?? 'Ana Souza',
    email: Email.criar(opcoes.email ?? EMAIL_DIGITADO),
    telefone: Telefone.criar('35999991234'),
    senhaHash: 'hash-falso:senha',
    agora: new Date(AGORA.getTime() - 24 * UMA_HORA),
  });
  if (opcoes.verificada === true) conta.verificarEmail(AGORA);
  if (opcoes.desativada === true) conta.desativar(AGORA);
  const dados = conta.dados;
  await identidade.contas.inserir(
    Conta.reconstituir(opcoes.semSenha === true ? { ...dados, senhaHash: null } : dados),
  );
}

function codigosDe(identidade: IdentidadeEmMemoria, finalidade: string, contaId = CONTA) {
  return identidade.codigos
    .todos()
    .filter((codigo) => codigo.contaId === contaId && codigo.finalidade === finalidade);
}

/** O código em claro que saiu no texto do e-mail falso (`nome|codigo`). */
function codigoDoEmail(texto: string): string {
  return texto.split('|')[1] ?? '';
}

describe('EnviarCodigoDeVerificacaoAssinante (CA-01, P4)', () => {
  it('assina ContaCriada e VerificacaoReenviada, com nome estável', () => {
    const { verificacao } = cenario();
    expect(verificacao.nome).toBe('identidade.enviar-codigo-de-verificacao');
    expect(verificacao.eventos).toEqual([
      'identidade.ContaCriada',
      'identidade.VerificacaoReenviada',
    ]);
  });

  it('envia para o e-mail normalizado da conta, lido pelo id, um código cujo HMAC é da conta e da finalidade', async () => {
    const { identidade, verificacao, enviador, gerador } = cenario();
    await inserirConta(identidade);
    gerador.definirProximosCodigos('482913');

    await entregar(identidade, verificacao, ContaCriada());

    expect(enviador.enviadas).toEqual([
      { para: EMAIL_NORMALIZADO, assunto: 'verificacao', texto: `${SEM_NOME}|482913`, html: '' },
    ]);
    const [gravado] = codigosDe(identidade, 'verificacao_email');
    expect(gravado).toMatchObject({ contaId: CONTA, tentativas: 0, usadoEm: null });
    expect(
      cifrador.hmacConfere('verificacao_email', [CONTA, '482913'], gravado?.codigoHmac ?? ''),
    ).toBe(true);
    // O mesmo código não confere em outra conta nem em outra finalidade.
    expect(
      cifrador.hmacConfere('verificacao_email', [OUTRA_CONTA, '482913'], gravado?.codigoHmac ?? ''),
    ).toBe(false);
    expect(
      cifrador.hmacConfere('recuperacao_senha', [CONTA, '482913'], gravado?.codigoHmac ?? ''),
    ).toBe(false);
    // O banco não guarda o código em claro.
    expect(JSON.stringify(identidade.codigos.todos())).not.toContain('482913');
  });

  it('código novo invalida o anterior: só o último vale', async () => {
    const { identidade, verificacao, relogio } = cenario();
    await inserirConta(identidade);
    await entregar(identidade, verificacao, ContaCriada());
    relogio.definir(new Date(AGORA.getTime() + 60_000));

    await entregar(identidade, verificacao, VerificacaoReenviada());

    const [primeiro, segundo] = codigosDe(identidade, 'verificacao_email');
    expect(primeiro?.usadoEm).toEqual(relogio.agora());
    expect(segundo?.usadoEm).toBeNull();
  });

  it.each([
    ['já verificada', { verificada: true }],
    ['desativada', { desativada: true }],
  ])('conta %s: nada é emitido nem enviado', async (_caso, opcoes) => {
    const { identidade, verificacao, enviador } = cenario();
    await inserirConta(identidade, opcoes);

    await entregar(identidade, verificacao, ContaCriada());

    expect(enviador.enviadas).toEqual([]);
    expect(identidade.codigos.todos()).toEqual([]);
  });

  it('conta que não existe mais: nada é emitido nem enviado, sem erro', async () => {
    const { identidade, verificacao, enviador } = cenario();

    await entregar(identidade, verificacao, ContaCriada());

    expect(enviador.enviadas).toEqual([]);
    expect(identidade.codigos.todos()).toEqual([]);
  });

  it('falha no envio: rejeita, e o código novo some (o anterior continua valendo)', async () => {
    const { identidade, verificacao, enviador } = cenario();
    await inserirConta(identidade);
    await entregar(identidade, verificacao, ContaCriada());
    enviador.falharNasProximas(1);

    await expect(entregar(identidade, verificacao, VerificacaoReenviada())).rejects.toMatchObject({
      name: 'FalhaNoEnvioDeEmail',
    });

    const codigos = codigosDe(identidade, 'verificacao_email');
    expect(codigos).toHaveLength(1);
    expect(codigos[0]?.usadoEm).toBeNull();
  });
});

describe('teto de 10 códigos por conta e finalidade em 24 h (S93, P16)', () => {
  it('o 11º código do dia não sai, e o 10º continua valendo', async () => {
    const { identidade, verificacao, enviador, relogio } = cenario();
    await inserirConta(identidade);
    for (let envio = 0; envio < TETO_DE_CODIGOS_POR_DIA; envio += 1) {
      relogio.definir(new Date(AGORA.getTime() + envio * 60_000));
      await entregar(identidade, verificacao, VerificacaoReenviada());
    }
    expect(enviador.enviadas).toHaveLength(TETO_DE_CODIGOS_POR_DIA);

    relogio.definir(new Date(AGORA.getTime() + 20 * 60_000));
    await entregar(identidade, verificacao, VerificacaoReenviada());

    expect(enviador.enviadas).toHaveLength(TETO_DE_CODIGOS_POR_DIA);
    const codigos = codigosDe(identidade, 'verificacao_email');
    expect(codigos).toHaveLength(TETO_DE_CODIGOS_POR_DIA);
    expect(codigos.at(-1)?.usadoEm).toBeNull();
  });

  it('passadas 24 h do primeiro, o próximo volta a sair', async () => {
    const { identidade, verificacao, enviador, relogio } = cenario();
    await inserirConta(identidade);
    for (let envio = 0; envio < TETO_DE_CODIGOS_POR_DIA; envio += 1) {
      relogio.definir(new Date(AGORA.getTime() + envio * 60_000));
      await entregar(identidade, verificacao, VerificacaoReenviada());
    }

    // 1 ms antes de completar 24 h do primeiro, ele ainda conta (`criado_em > agora - 24 h`).
    relogio.definir(new Date(AGORA.getTime() + JANELA_DO_TETO_EM_MS - 1));
    await entregar(identidade, verificacao, VerificacaoReenviada());
    expect(enviador.enviadas).toHaveLength(TETO_DE_CODIGOS_POR_DIA);

    relogio.definir(new Date(AGORA.getTime() + JANELA_DO_TETO_EM_MS));
    await entregar(identidade, verificacao, VerificacaoReenviada());
    expect(enviador.enviadas).toHaveLength(TETO_DE_CODIGOS_POR_DIA + 1);
  });

  it('o teto é por finalidade e por conta: 10 de verificação não seguram a recuperação nem a outra conta', async () => {
    const { identidade, verificacao, recuperacao, enviador } = cenario();
    await inserirConta(identidade);
    await inserirConta(identidade, { id: OUTRA_CONTA, email: 'bia@exemplo.com' });
    for (let envio = 0; envio < TETO_DE_CODIGOS_POR_DIA; envio += 1) {
      await entregar(identidade, verificacao, VerificacaoReenviada());
    }

    await entregar(identidade, recuperacao, RecuperacaoSolicitada());
    await entregar(identidade, verificacao, VerificacaoReenviada(OUTRA_CONTA));

    expect(enviador.enviadas.slice(-2).map((m) => [m.para, m.assunto])).toEqual([
      [EMAIL_NORMALIZADO, 'recuperacao'],
      ['bia@exemplo.com', 'verificacao'],
    ]);
  });
});

describe('emissões simultâneas para a mesma conta (Q27, S107)', () => {
  it('duas entregas ao mesmo tempo deixam um código só valendo: a segunda espera a primeira', async () => {
    const { identidade, verificacao, enviador } = cenario();
    await inserirConta(identidade);

    await Promise.all([
      entregar(identidade, verificacao, ContaCriada()),
      entregar(identidade, verificacao, VerificacaoReenviada()),
    ]);

    const codigos = codigosDe(identidade, 'verificacao_email');
    expect(codigos).toHaveLength(2);
    expect(codigos.filter((codigo) => codigo.usadoEm === null)).toHaveLength(1);
    expect(enviador.enviadas).toHaveLength(2);
  });

  it('a trava é por conta e finalidade: outra conta não espera', async () => {
    const { identidade, verificacao, recuperacao } = cenario();
    await inserirConta(identidade);
    await inserirConta(identidade, { id: OUTRA_CONTA, email: 'bia@exemplo.com' });
    const travar = vi.spyOn(identidade.codigos, 'travarEmissao');

    await Promise.all([
      entregar(identidade, verificacao, ContaCriada()),
      entregar(identidade, verificacao, ContaCriada(OUTRA_CONTA)),
      entregar(identidade, recuperacao, RecuperacaoSolicitada()),
    ]);

    expect(travar.mock.calls).toEqual([
      [CONTA, 'verificacao_email'],
      [OUTRA_CONTA, 'verificacao_email'],
      [CONTA, 'recuperacao_senha'],
    ]);
    expect(codigosDe(identidade, 'verificacao_email', OUTRA_CONTA)).toHaveLength(1);
  });
});

describe('EnviarCodigoDeRecuperacaoAssinante (CA-06)', () => {
  it('envia o código de recuperação com HMAC da finalidade recuperacao_senha', async () => {
    const { identidade, recuperacao, enviador } = cenario();
    await inserirConta(identidade, { verificada: true });

    await entregar(identidade, recuperacao, RecuperacaoSolicitada());

    const [mensagem] = enviador.enviadas;
    expect(mensagem).toMatchObject({ para: EMAIL_NORMALIZADO, assunto: 'recuperacao' });
    const [gravado] = codigosDe(identidade, 'recuperacao_senha');
    expect(
      cifrador.hmacConfere(
        'recuperacao_senha',
        [CONTA, codigoDoEmail(mensagem?.texto ?? '')],
        gravado?.codigoHmac ?? '',
      ),
    ).toBe(true);
  });

  it('a conta sem senha (admin da CLI, senha apagada) recebe o código para definir a senha', async () => {
    const { identidade, recuperacao, enviador } = cenario();
    await inserirConta(identidade, { semSenha: true });

    await entregar(identidade, recuperacao, RecuperacaoSolicitada());

    expect(enviador.enviadas).toHaveLength(1);
  });

  it('código novo invalida o anterior; conta desativada não recebe', async () => {
    const { identidade, recuperacao, enviador } = cenario();
    await inserirConta(identidade);
    await entregar(identidade, recuperacao, RecuperacaoSolicitada());
    await entregar(identidade, recuperacao, RecuperacaoSolicitada());
    const [primeiro, segundo] = codigosDe(identidade, 'recuperacao_senha');
    expect(primeiro?.usadoEm).not.toBeNull();
    expect(segundo?.usadoEm).toBeNull();

    const outro = cenario();
    await inserirConta(outro.identidade, { desativada: true });
    await entregar(outro.identidade, outro.recuperacao, RecuperacaoSolicitada());
    expect(outro.enviador.enviadas).toEqual([]);
    expect(enviador.enviadas).toHaveLength(2);
  });
});

describe('payload lido com o esquema do contrato (P4)', () => {
  it.each([
    ['campo a mais', evento('identidade.RecuperacaoSolicitada', { contaId: CONTA, email: 'x' })],
    ['id mal formado', evento('identidade.RecuperacaoSolicitada', { contaId: 'ana@exemplo.com' })],
    [
      'agregadoId diferente do contaId',
      evento('identidade.RecuperacaoSolicitada', { contaId: CONTA }, OUTRA_CONTA),
    ],
    ['tipo que o assinante não assina', evento('identidade.ContaCriada', { contaId: CONTA })],
    [
      'versão desconhecida',
      { ...evento('identidade.RecuperacaoSolicitada', { contaId: CONTA }), versao: 2 },
    ],
  ])('%s: EventoInvalido sem o valor na mensagem, nada enviado', async (_caso, entregue) => {
    const { identidade, recuperacao, enviador } = cenario();
    await inserirConta(identidade);

    const erro: unknown = await entregar(identidade, recuperacao, entregue).then(
      () => null,
      (e: unknown) => e,
    );

    expect(erro).toBeInstanceOf(EventoInvalido);
    expect(String((erro as Error).message)).not.toMatch(/ana@exemplo|"x"/);
    expect(enviador.enviadas).toEqual([]);
    expect(identidade.codigos.todos()).toEqual([]);
  });
});

describe('AvisarCadastroRepetidoAssinante (CA-02, P1-dono, S15)', () => {
  it('avisa o dono do e-mail, também com a conta não verificada (sem o nome, S102)', async () => {
    const { identidade, cadastroRepetido, enviador } = cenario();
    await inserirConta(identidade);

    await entregar(identidade, cadastroRepetido, CadastroRepetidoTentado());

    expect(enviador.enviadas).toEqual([
      { para: EMAIL_NORMALIZADO, assunto: 'cadastro_repetido', texto: SEM_NOME, html: '' },
    ]);
  });

  it('no máximo um aviso por hora por e-mail; depois da hora, sai outro', async () => {
    const { identidade, cadastroRepetido, enviador, relogio } = cenario();
    await inserirConta(identidade, { verificada: true });

    await entregar(identidade, cadastroRepetido, CadastroRepetidoTentado());
    relogio.definir(new Date(AGORA.getTime() + INTERVALO_ENTRE_AVISOS_EM_MS - 1));
    await entregar(identidade, cadastroRepetido, CadastroRepetidoTentado());
    expect(enviador.enviadas).toHaveLength(1);

    relogio.definir(new Date(AGORA.getTime() + INTERVALO_ENTRE_AVISOS_EM_MS));
    await entregar(identidade, cadastroRepetido, CadastroRepetidoTentado());
    expect(enviador.enviadas).toHaveLength(2);
  });

  it('dois e-mails são independentes, e a marca não mexe no freio de login', async () => {
    const { identidade, cadastroRepetido, enviador } = cenario();
    await inserirConta(identidade);
    await inserirConta(identidade, { id: OUTRA_CONTA, email: 'bia@exemplo.com' });

    await entregar(identidade, cadastroRepetido, CadastroRepetidoTentado());
    await entregar(identidade, cadastroRepetido, CadastroRepetidoTentado(OUTRA_CONTA));

    expect(enviador.enviadas.map((m) => m.para)).toEqual([EMAIL_NORMALIZADO, 'bia@exemplo.com']);
    const email = Email.criar(EMAIL_NORMALIZADO);
    const chaves = identidade.bloqueios.todos().map((b) => b.chaveHmac);
    expect(chaves).toContain(chaveDoAvisoDeCadastroRepetido(cifrador, email));
    expect(chaves).not.toContain(chaveDoFreioPorEmail(cifrador, email));
  });

  it('falha no envio: a marca some junto, e a próxima tentativa avisa', async () => {
    const { identidade, cadastroRepetido, enviador } = cenario();
    await inserirConta(identidade);
    enviador.falharNasProximas(1);

    await expect(
      entregar(identidade, cadastroRepetido, CadastroRepetidoTentado()),
    ).rejects.toMatchObject({ name: 'FalhaNoEnvioDeEmail' });
    expect(identidade.bloqueios.todos()).toEqual([]);

    await entregar(identidade, cadastroRepetido, CadastroRepetidoTentado());
    expect(enviador.enviadas).toHaveLength(1);
  });

  it('conta desativada não recebe aviso', async () => {
    const { identidade, cadastroRepetido, enviador } = cenario();
    await inserirConta(identidade, { desativada: true });

    await entregar(identidade, cadastroRepetido, CadastroRepetidoTentado());

    expect(enviador.enviadas).toEqual([]);
  });
});

describe('GerarExportacaoAssinante (CA-10, S10)', () => {
  async function pedirExportacao(identidade: IdentidadeEmMemoria): Promise<EventoPublicado> {
    await identidade.solicitacoes.inserir({
      id: SOLICITACAO,
      contaId: CONTA,
      tipo: 'exportacao',
      status: 'pendente',
      solicitadaEm: AGORA,
      concluidaEm: null,
    });
    return evento('identidade.ExportacaoSolicitada', {
      contaId: CONTA,
      solicitacaoId: SOLICITACAO,
    });
  }

  it('gera a cópia e só avisa que está pronta, com a validade, sem o conteúdo', async () => {
    const { identidade, exportacao, enviador } = cenario();
    await inserirConta(identidade, { verificada: true });
    const entregue = await pedirExportacao(identidade);

    await entregar(identidade, exportacao, entregue);

    expect(identidade.exportacoes.todas()).toHaveLength(1);
    const validade = new Date(AGORA.getTime() + 7 * 24 * UMA_HORA);
    expect(enviador.enviadas).toEqual([
      {
        para: EMAIL_NORMALIZADO,
        assunto: 'exportacao',
        texto: `Ana Souza|${validade.toISOString()}`,
        html: '',
      },
    ]);
  });

  it('reentrega do mesmo pedido (ignorada): nada de cópia nova nem de aviso', async () => {
    const { identidade, exportacao, enviador } = cenario();
    await inserirConta(identidade);
    const entregue = await pedirExportacao(identidade);
    await entregar(identidade, exportacao, entregue);

    await entregar(identidade, exportacao, entregue);

    expect(identidade.exportacoes.todas()).toHaveLength(1);
    expect(enviador.enviadas).toHaveLength(1);
  });

  it('conta excluída depois do pedido (conta_indisponivel): nenhum aviso', async () => {
    const { identidade, exportacao, enviador } = cenario();
    await inserirConta(identidade, { desativada: true });
    const entregue = await pedirExportacao(identidade);

    await entregar(identidade, exportacao, entregue);

    expect(identidade.exportacoes.todas()).toEqual([]);
    expect(enviador.enviadas).toEqual([]);
  });

  it('falha no envio do aviso: a cópia gerada some junto e a reentrega gera de novo', async () => {
    const { identidade, exportacao, enviador } = cenario();
    await inserirConta(identidade);
    const entregue = await pedirExportacao(identidade);
    enviador.falharNasProximas(1);

    await expect(entregar(identidade, exportacao, entregue)).rejects.toMatchObject({
      name: 'FalhaNoEnvioDeEmail',
    });
    expect(identidade.exportacoes.todas()).toEqual([]);

    await entregar(identidade, exportacao, entregue);
    expect(identidade.exportacoes.todas()).toHaveLength(1);
    expect(enviador.enviadas).toHaveLength(1);
  });
});

describe('AvisarSegundoFatorFreadoAssinante (S92, P16)', () => {
  const SegundoFatorFreado = () => evento('identidade.SegundoFatorFreado', { contaId: CONTA });

  it('com a senha ainda na conta: o aviso de tentativas erradas', async () => {
    const { identidade, segundoFator, enviador } = cenario();
    await inserirConta(identidade, { verificada: true });

    await entregar(identidade, segundoFator, SegundoFatorFreado());

    expect(enviador.enviadas).toEqual([
      { para: EMAIL_NORMALIZADO, assunto: 'segundo_fator_freado', texto: 'Ana Souza', html: '' },
    ]);
  });

  it('com a senha apagada pelo freio no nível máximo: o aviso manda recuperar a senha', async () => {
    const { identidade, segundoFator, enviador } = cenario();
    await inserirConta(identidade, { semSenha: true });

    await entregar(identidade, segundoFator, SegundoFatorFreado());

    expect(enviador.enviadas.map((m) => m.assunto)).toEqual(['senha_removida']);
  });

  it('conta desativada não recebe aviso', async () => {
    const { identidade, segundoFator, enviador } = cenario();
    await inserirConta(identidade, { desativada: true });

    await entregar(identidade, segundoFator, SegundoFatorFreado());

    expect(enviador.enviadas).toEqual([]);
  });
});

describe('nome só para e-mail verificado (S102)', () => {
  // O nome é texto livre do cadastro: quem cadastra o e-mail de outra pessoa o escolhe.
  const NOME_DE_ISCA = 'Acesse exemplo.com';

  async function todosOsAvisos(verificada: boolean) {
    const { identidade, enviador, recuperacao, cadastroRepetido, exportacao, segundoFator } =
      cenario();
    await inserirConta(identidade, { nome: NOME_DE_ISCA, verificada });
    await identidade.solicitacoes.inserir({
      id: SOLICITACAO,
      contaId: CONTA,
      tipo: 'exportacao',
      status: 'pendente',
      solicitadaEm: AGORA,
      concluidaEm: null,
    });
    await entregar(identidade, recuperacao, RecuperacaoSolicitada());
    await entregar(identidade, cadastroRepetido, CadastroRepetidoTentado());
    await entregar(
      identidade,
      exportacao,
      evento('identidade.ExportacaoSolicitada', { contaId: CONTA, solicitacaoId: SOLICITACAO }),
    );
    await entregar(
      identidade,
      segundoFator,
      evento('identidade.SegundoFatorFreado', { contaId: CONTA }),
    );
    return enviador.enviadas;
  }

  it('conta não verificada: nenhum aviso leva o nome, só a saudação sem nome', async () => {
    const enviadas = await todosOsAvisos(false);

    expect(enviadas.map((m) => m.assunto)).toEqual([
      'recuperacao',
      'cadastro_repetido',
      'exportacao',
      'segundo_fator_freado',
    ]);
    for (const mensagem of enviadas) {
      expect(mensagem.texto, mensagem.assunto).not.toContain(NOME_DE_ISCA);
      expect(mensagem.texto.startsWith(SEM_NOME), mensagem.assunto).toBe(true);
    }
  });

  it('conta verificada: os avisos mantêm o nome', async () => {
    const enviadas = await todosOsAvisos(true);

    expect(enviadas).toHaveLength(4);
    for (const mensagem of enviadas) {
      expect(mensagem.texto.startsWith(NOME_DE_ISCA), mensagem.assunto).toBe(true);
    }
  });

  it('o código de verificação nunca leva o nome', async () => {
    const { identidade, verificacao, enviador } = cenario();
    await inserirConta(identidade, { nome: NOME_DE_ISCA });

    await entregar(identidade, verificacao, ContaCriada());

    expect(enviador.enviadas).toHaveLength(1);
    expect(enviador.enviadas[0]?.texto).not.toContain(NOME_DE_ISCA);
  });
});
