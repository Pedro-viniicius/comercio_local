// Cadastro (CA-01, CA-02; plano 01b, etapa 8): conta nova com aceite versionado e
// `ContaCriada`; e-mail que já tem conta, verificada ou não, não muda nada, responde
// igual e gera `CadastroRepetidoTentado`; o hash da senha é calculado nos dois caminhos.
import type { CriarConta } from '@bairrin/contratos';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import {
  criarIdentidadeEmMemoria,
  ContasEmMemoria,
  DocumentosLegaisEmMemoria,
  type IdentidadeEmMemoria,
} from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import {
  GeradorDeSegredosFalso,
  HasherFalso,
} from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { Conta, type DadosDaConta } from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import type { Consentimento, RepositorioDeContas } from '../../dominio/repositorios.ts';
import { Telefone } from '../../dominio/telefone.ts';
import {
  CriarContaCasoDeUso,
  type EntradaDeCriarConta,
  SemDocumentoLegalVigente,
} from './criar-conta.caso-de-uso.ts';

const AGORA = new Date('2026-10-18T12:00:00.000Z');
const ONTEM = new Date('2026-10-17T12:00:00.000Z');
const TERMOS = 'aaaaaaaa-0000-4000-8000-000000000001';
const PRIVACIDADE = 'aaaaaaaa-0000-4000-8000-000000000002';
const EXISTENTE = 'bbbbbbbb-0000-4000-8000-000000000001';

const ENTRADA: EntradaDeCriarConta = {
  nome: 'Ana Souza',
  email: 'ana.souza@exemplo.com',
  telefone: '+5535999991234',
  senha: 'girassol-azul-42',
  aceites: { termos: '1', privacidade: '1' },
};

interface Cenario {
  identidade: IdentidadeEmMemoria;
  hasher: HasherFalso;
  casoDeUso: CriarContaCasoDeUso;
}

function cenario(
  opcoes: {
    contas?: (identidade: IdentidadeEmMemoria) => RepositorioDeContas;
    documentos?: (identidade: IdentidadeEmMemoria) => DocumentosLegaisEmMemoria;
    semDocumentos?: boolean;
  } = {},
): Cenario {
  const identidade = criarIdentidadeEmMemoria();
  const documentos = opcoes.documentos?.(identidade) ?? identidade.documentos;
  if (opcoes.semDocumentos !== true) {
    documentos.adicionarDocumento({
      id: TERMOS,
      tipo: 'termos',
      versao: '1',
      conteudo: 'Termos',
      vigenteDesde: ONTEM,
    });
    documentos.adicionarDocumento({
      id: PRIVACIDADE,
      tipo: 'privacidade',
      versao: '1',
      conteudo: 'Política',
      vigenteDesde: ONTEM,
    });
  }
  // O hasher rejeita chamada com a transação aberta (S91).
  const hasher = new HasherFalso(identidade.unidade);
  const casoDeUso = new CriarContaCasoDeUso(
    identidade.unidade,
    identidade.publicador,
    new RelogioFixo(AGORA),
    opcoes.contas?.(identidade) ?? identidade.contas,
    documentos,
    hasher,
    new GeradorDeSegredosFalso(),
  );
  return { identidade, hasher, casoDeUso };
}

function contaExistente(verificada: boolean): Conta {
  const conta = Conta.criar({
    id: EXISTENTE,
    nome: 'Ana Original',
    email: Email.criar('ana.souza@exemplo.com'),
    telefone: Telefone.criar('+5511988887777'),
    senhaHash: HasherFalso.hashDe('senha-da-dona-original'),
    agora: ONTEM,
  });
  if (verificada) conta.verificarEmail(ONTEM);
  return conta;
}

/** Texto de tudo o que saiu do caso de uso para fora da conta: eventos e consentimentos. */
function textoDoQueSaiu(identidade: IdentidadeEmMemoria): string {
  return JSON.stringify([identidade.publicador.publicados, identidade.documentos.consentimentos()]);
}

describe('CriarContaCasoDeUso: conta nova (CA-01)', () => {
  it('cria a conta ativa, não verificada, com perfil consumidor e o hash da senha', async () => {
    const { identidade, casoDeUso } = cenario();

    await expect(casoDeUso.executar(ENTRADA)).resolves.toEqual({ tipo: 'aceito' });

    const [conta] = identidade.contas.todas();
    expect(identidade.contas.todas()).toHaveLength(1);
    expect(conta).toMatchObject<Partial<DadosDaConta>>({
      nome: 'Ana Souza',
      emailNormalizado: 'ana.souza@exemplo.com',
      telefoneE164: '+5535999991234',
      senhaHash: HasherFalso.hashDe(ENTRADA.senha),
      emailVerificadoEm: null,
      ultimoLoginEm: null,
      status: 'ativa',
      criadaEm: AGORA,
    });
    expect(conta?.perfis.map(({ perfil }) => perfil)).toEqual(['consumidor']);
  });

  it('registra o aceite das versões vigentes de termos e privacidade, com a data do cadastro', async () => {
    const { identidade, casoDeUso } = cenario();

    await casoDeUso.executar(ENTRADA);

    const contaId = identidade.contas.todas()[0]?.id;
    const aceites = identidade.documentos
      .consentimentos()
      .map(({ contaId: dono, documentoId, aceitoEm }) => ({ dono, documentoId, aceitoEm }));
    expect(aceites).toEqual([
      { dono: contaId, documentoId: TERMOS, aceitoEm: AGORA },
      { dono: contaId, documentoId: PRIVACIDADE, aceitoEm: AGORA },
    ]);
  });

  it('publica só ContaCriada, com o id da conta; o código nasce no assinante, não aqui', async () => {
    const { identidade, casoDeUso } = cenario();

    await casoDeUso.executar(ENTRADA);

    const contaId = identidade.contas.todas()[0]?.id;
    expect(identidade.publicador.publicados).toEqual([
      { tipo: 'identidade.ContaCriada', versao: 1, agregadoId: contaId, payload: { contaId } },
    ]);
    expect(identidade.codigos.todos()).toEqual([]);
  });

  it('nada do que sai (eventos, consentimentos) leva nome, e-mail, telefone, senha ou hash (CA-12)', async () => {
    const { identidade, casoDeUso } = cenario();

    await casoDeUso.executar(ENTRADA);

    const texto = textoDoQueSaiu(identidade);
    for (const valor of [
      'Ana',
      'ana.souza',
      'exemplo.com',
      '99999',
      ENTRADA.senha,
      HasherFalso.hashDe(ENTRADA.senha),
    ]) {
      expect(texto).not.toContain(valor);
    }
  });

  it('aceita o corpo validado por criarContaSchema sem conversão', () => {
    expectTypeOf<CriarConta>().toExtend<EntradaDeCriarConta>();
  });
});

describe('CriarContaCasoDeUso: e-mail que já tem conta (CA-02, P1-dono)', () => {
  it.each([
    ['não verificada', false],
    ['verificada', true],
  ])(
    'conta %s: senha, nome, telefone e o resto da conta continuam os mesmos',
    async (_caso, verificada) => {
      const { identidade, casoDeUso } = cenario();
      await identidade.contas.inserir(contaExistente(verificada));
      const antes = identidade.contas.dadosDe(EXISTENTE);

      const resultado = await casoDeUso.executar({
        ...ENTRADA,
        nome: 'Outra Pessoa',
        telefone: '+5521977776666',
        senha: 'senha-de-quem-tenta',
      });

      expect(resultado).toEqual({ tipo: 'aceito' });
      const depois = identidade.contas.dadosDe(EXISTENTE);
      expect(depois).toEqual(antes);
      expect(depois?.senhaHash).toBe(HasherFalso.hashDe('senha-da-dona-original'));
      expect(depois?.nome).toBe('Ana Original');
      expect(depois?.telefoneE164).toBe('+5511988887777');
      expect(identidade.contas.todas()).toHaveLength(1);
      expect(identidade.documentos.consentimentos()).toEqual([]);
    },
  );

  it('publica só CadastroRepetidoTentado, com o id da conta existente', async () => {
    const { identidade, casoDeUso } = cenario();
    await identidade.contas.inserir(contaExistente(false));

    await casoDeUso.executar(ENTRADA);

    expect(identidade.publicador.publicados).toEqual([
      {
        tipo: 'identidade.CadastroRepetidoTentado',
        versao: 1,
        agregadoId: EXISTENTE,
        payload: { contaId: EXISTENTE },
      },
    ]);
    expect(identidade.codigos.todos()).toEqual([]);
  });

  it('conta desativada também não muda e gera o aviso', async () => {
    const { identidade, casoDeUso } = cenario();
    const conta = contaExistente(true);
    conta.desativar(ONTEM);
    await identidade.contas.inserir(conta);
    const antes = identidade.contas.dadosDe(EXISTENTE);

    await expect(casoDeUso.executar(ENTRADA)).resolves.toEqual({ tipo: 'aceito' });

    expect(identidade.contas.dadosDe(EXISTENTE)).toEqual(antes);
    expect(identidade.publicador.tipos).toEqual(['identidade.CadastroRepetidoTentado']);
  });

  it('compara pelo e-mail normalizado (caixa e espaços não criam outra conta)', async () => {
    const { identidade, casoDeUso } = cenario();
    await identidade.contas.inserir(contaExistente(false));

    await casoDeUso.executar({ ...ENTRADA, email: '  Ana.Souza@EXEMPLO.com ' });

    expect(identidade.contas.todas().map(({ id }) => id)).toEqual([EXISTENTE]);
    expect(identidade.publicador.tipos).toEqual(['identidade.CadastroRepetidoTentado']);
  });

  it('a resposta é idêntica à do cadastro novo, e os dois caminhos calculam o hash uma vez', async () => {
    const novo = cenario();
    const repetido = cenario();
    await repetido.identidade.contas.inserir(contaExistente(true));

    const respostaNova = await novo.casoDeUso.executar(ENTRADA);
    const respostaRepetida = await repetido.casoDeUso.executar(ENTRADA);

    expect(respostaRepetida).toStrictEqual(respostaNova);
    expect(novo.hasher.chamadas.gerarHash).toBe(1);
    expect(repetido.hasher.chamadas.gerarHash).toBe(1);
  });

  it('o aviso não leva nada do que a pessoa digitou (CA-12)', async () => {
    const { identidade, casoDeUso } = cenario();
    await identidade.contas.inserir(contaExistente(false));

    await casoDeUso.executar({ ...ENTRADA, nome: 'Outra Pessoa', senha: 'senha-de-quem-tenta' });

    const texto = textoDoQueSaiu(identidade);
    for (const valor of ['Outra', 'ana.souza', 'senha-de-quem-tenta', '99999']) {
      expect(texto).not.toContain(valor);
    }
  });
});

describe('CriarContaCasoDeUso: corrida entre dois cadastros do mesmo e-mail', () => {
  /** Lê como se a outra transação ainda não tivesse confirmado: a primeira busca não acha a conta. */
  class ContasQueLeemAntesDaOutra extends ContasEmMemoria {
    #buscas = 0;

    override buscarPorEmail(email: Email): Promise<Conta | null> {
      this.#buscas += 1;
      return this.#buscas === 1 ? Promise.resolve(null) : super.buscarPorEmail(email);
    }
  }

  it('o INSERT recusado (EmailJaCadastrado) responde igual, desfaz tudo e avisa a dona do e-mail', async () => {
    let contas: ContasQueLeemAntesDaOutra | undefined;
    const { identidade, hasher, casoDeUso } = cenario({
      contas: (identidade) => {
        contas = new ContasQueLeemAntesDaOutra(identidade.unidade);
        return contas;
      },
    });
    await contas?.inserir(contaExistente(false));
    const antes = contas?.dadosDe(EXISTENTE);

    await expect(casoDeUso.executar(ENTRADA)).resolves.toEqual({ tipo: 'aceito' });

    expect(contas?.todas()).toEqual([antes]);
    expect(identidade.documentos.consentimentos()).toEqual([]);
    expect(identidade.publicador.publicados).toEqual([
      {
        tipo: 'identidade.CadastroRepetidoTentado',
        versao: 1,
        agregadoId: EXISTENTE,
        payload: { contaId: EXISTENTE },
      },
    ]);
    expect(hasher.chamadas.gerarHash).toBe(1);
  });
});

describe('CriarContaCasoDeUso: aceite versionado (S24)', () => {
  it.each<[string, EntradaDeCriarConta['aceites'], string[]]>([
    ['termos', { termos: '0.9', privacidade: '1' }, ['termos']],
    ['privacidade', { termos: '1', privacidade: '2' }, ['privacidade']],
    ['os dois', { termos: '0', privacidade: '0' }, ['termos', 'privacidade']],
  ])(
    'versão diferente da vigente (%s) é recusada sem gravar, publicar nem calcular hash',
    async (_caso, aceites, documentos) => {
      const { identidade, hasher, casoDeUso } = cenario();

      await expect(casoDeUso.executar({ ...ENTRADA, aceites })).resolves.toEqual({
        tipo: 'aceites_divergentes',
        documentos,
      });

      expect(identidade.contas.todas()).toEqual([]);
      expect(identidade.documentos.consentimentos()).toEqual([]);
      expect(identidade.publicador.publicados).toEqual([]);
      expect(hasher.chamadas.gerarHash).toBe(0);
    },
  );

  it('a recusa não depende do e-mail ter conta (não revela cadastro)', async () => {
    const { identidade, casoDeUso } = cenario();
    await identidade.contas.inserir(contaExistente(true));

    await expect(
      casoDeUso.executar({ ...ENTRADA, aceites: { termos: '0.9', privacidade: '1' } }),
    ).resolves.toEqual({ tipo: 'aceites_divergentes', documentos: ['termos'] });
    expect(identidade.publicador.publicados).toEqual([]);
  });

  it('vale a versão vigente mais recente', async () => {
    const { identidade, casoDeUso } = cenario();
    identidade.documentos.adicionarDocumento({
      id: 'aaaaaaaa-0000-4000-8000-000000000003',
      tipo: 'termos',
      versao: '2',
      conteudo: 'Termos v2',
      vigenteDesde: AGORA,
    });

    await expect(casoDeUso.executar(ENTRADA)).resolves.toEqual({
      tipo: 'aceites_divergentes',
      documentos: ['termos'],
    });
    await expect(
      casoDeUso.executar({ ...ENTRADA, aceites: { termos: '2', privacidade: '1' } }),
    ).resolves.toEqual({ tipo: 'aceito' });
    expect(identidade.documentos.consentimentos().map(({ documentoId }) => documentoId)).toEqual([
      'aaaaaaaa-0000-4000-8000-000000000003',
      PRIVACIDADE,
    ]);
  });

  it('sem documento vigente, rejeita (erro de configuração) sem gravar nada', async () => {
    const { identidade, hasher, casoDeUso } = cenario({ semDocumentos: true });

    await expect(casoDeUso.executar(ENTRADA)).rejects.toBeInstanceOf(SemDocumentoLegalVigente);

    expect(identidade.contas.todas()).toEqual([]);
    expect(identidade.publicador.publicados).toEqual([]);
    expect(hasher.chamadas.gerarHash).toBe(0);
  });
});

describe('CriarContaCasoDeUso: falha no meio', () => {
  class DocumentosQueFalham extends DocumentosLegaisEmMemoria {
    override registrarConsentimento(consentimento: Consentimento): Promise<void> {
      return consentimento.documentoId === PRIVACIDADE
        ? Promise.reject(new Error('Falha simulada ao gravar o consentimento.'))
        : super.registrarConsentimento(consentimento);
    }
  }

  it('o consentimento que falha desfaz a conta, o outro consentimento e o evento', async () => {
    let documentos: DocumentosQueFalham | undefined;
    const { identidade, casoDeUso } = cenario({
      documentos: (identidade) => {
        documentos = new DocumentosQueFalham(identidade.unidade);
        return documentos;
      },
    });

    await expect(casoDeUso.executar(ENTRADA)).rejects.toThrow('Falha simulada');

    expect(identidade.contas.todas()).toEqual([]);
    expect(documentos?.consentimentos()).toEqual([]);
    expect(identidade.publicador.publicados).toEqual([]);
  });
});
