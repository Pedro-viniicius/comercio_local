// Ajudas dos testes de integração que ligam os casos de uso da Identidade (etapas 8 a 11) aos
// repositórios Prisma e aos adaptadores de cripto reais, contra o Postgres de teste (papel
// `bairrin_app`). Não é um teste: fica fora do filtro `*.int.test.ts`.
//
// Cada `montarPilha()` abre um pool próprio de conexões; duas pilhas fazem duas requisições
// ao mesmo tempo. O relógio é falso (`RelogioFixo`) e compartilhado dentro da pilha, para o
// teste controlar a hora; o banco só usa `now()` na trigger `contas_so_expurgo`.
import { randomUUID } from 'node:crypto';
import type { PinoLogger } from 'nestjs-pino';
import { Secret, TOTP } from 'otpauth';
import pg from 'pg';
import type { Ambiente } from '../../../src/compartilhado/config/ambiente.ts';
import { PrismaService } from '../../../src/compartilhado/infra/prisma.service.ts';
import { PublicadorDeEventosNaOutbox } from '../../../src/compartilhado/infra/publicador-na-outbox.ts';
import { RepositorioDeAuditoriaPrisma } from '../../../src/compartilhado/infra/repositorio-de-auditoria-prisma.ts';
import { UnidadeDeTrabalhoPrisma } from '../../../src/compartilhado/infra/unidade-de-trabalho-prisma.ts';
import { RelogioFixo } from '../../../src/compartilhado/tempo/relogio.ts';
import { RegistroDeAnonimizadores } from '../../../src/compartilhado/titular/anonimizador-de-titular.ts';
import { CriarContaCasoDeUso } from '../../../src/modulos/identidade/aplicacao/cadastro/criar-conta.caso-de-uso.ts';
import { ReenviarVerificacaoCasoDeUso } from '../../../src/modulos/identidade/aplicacao/cadastro/reenviar-verificacao.caso-de-uso.ts';
import { VerificarEmailCasoDeUso } from '../../../src/modulos/identidade/aplicacao/cadastro/verificar-email.caso-de-uso.ts';
import { AnonimizadorDeIdentidade } from '../../../src/modulos/identidade/aplicacao/privacidade/anonimizador-identidade.ts';
import { AnonimizarContaCasoDeUso } from '../../../src/modulos/identidade/aplicacao/privacidade/anonimizar-conta.ts';
import { BaixarExportacaoCasoDeUso } from '../../../src/modulos/identidade/aplicacao/privacidade/baixar-exportacao.ts';
import { ConsultarPrivacidadeCasoDeUso } from '../../../src/modulos/identidade/aplicacao/privacidade/consultar-privacidade.ts';
import { GerarExportacaoCasoDeUso } from '../../../src/modulos/identidade/aplicacao/privacidade/gerar-exportacao.ts';
import { SolicitarExclusaoCasoDeUso } from '../../../src/modulos/identidade/aplicacao/privacidade/solicitar-exclusao.ts';
import { SolicitarExportacaoCasoDeUso } from '../../../src/modulos/identidade/aplicacao/privacidade/solicitar-exportacao.ts';
import { ConfirmarConfiguracaoDoSegundoFatorCasoDeUso } from '../../../src/modulos/identidade/aplicacao/segundo-fator/confirmar-configuracao.caso-de-uso.ts';
import { IniciarConfiguracaoDoSegundoFatorCasoDeUso } from '../../../src/modulos/identidade/aplicacao/segundo-fator/iniciar-configuracao.caso-de-uso.ts';
import { ReconfigurarSegundoFatorCasoDeUso } from '../../../src/modulos/identidade/aplicacao/segundo-fator/reconfigurar-segundo-fator.caso-de-uso.ts';
import { VerificarSegundoFatorCasoDeUso } from '../../../src/modulos/identidade/aplicacao/segundo-fator/verificar-segundo-fator.caso-de-uso.ts';
import { EncerrarSessaoCasoDeUso } from '../../../src/modulos/identidade/aplicacao/sessao/encerrar-sessao.caso-de-uso.ts';
import { EntrarCasoDeUso } from '../../../src/modulos/identidade/aplicacao/sessao/entrar.caso-de-uso.ts';
import { RedefinirSenhaCasoDeUso } from '../../../src/modulos/identidade/aplicacao/sessao/redefinir-senha.caso-de-uso.ts';
import { RenovarSessaoCasoDeUso } from '../../../src/modulos/identidade/aplicacao/sessao/renovar-sessao.caso-de-uso.ts';
import { SolicitarRecuperacaoCasoDeUso } from '../../../src/modulos/identidade/aplicacao/sessao/solicitar-recuperacao.caso-de-uso.ts';
import { Argon2Hasher } from '../../../src/modulos/identidade/infra/cripto/argon2.hasher.ts';
import { CifradorAesGcm } from '../../../src/modulos/identidade/infra/cripto/cifrador-aes-gcm.ts';
import { EmissorJwt } from '../../../src/modulos/identidade/infra/cripto/emissor-jwt.ts';
import { GeradorDeSegredosCripto } from '../../../src/modulos/identidade/infra/cripto/gerador-de-segredos.ts';
import { VerificadorTotpOtpauth } from '../../../src/modulos/identidade/infra/cripto/verificador-totp.ts';
import { RepositorioDeBloqueiosPrisma } from '../../../src/modulos/identidade/infra/prisma/bloqueios.repositorio.ts';
import {
  RepositorioDeCodigosDeVerificacaoPrisma,
  RepositorioDeDesafiosPrisma,
} from '../../../src/modulos/identidade/infra/prisma/codigos.repositorio.ts';
import { RepositorioDeContasPrisma } from '../../../src/modulos/identidade/infra/prisma/contas.repositorio.ts';
import { RepositorioDeDocumentosLegaisPrisma } from '../../../src/modulos/identidade/infra/prisma/documentos-legais.repositorio.ts';
import { RepositorioDeExportacoesPrisma } from '../../../src/modulos/identidade/infra/prisma/exportacoes.repositorio.ts';
import { RepositorioDeSegundoFatorPrisma } from '../../../src/modulos/identidade/infra/prisma/segundo-fator.repositorio.ts';
import { RepositorioDeSessoesPrisma } from '../../../src/modulos/identidade/infra/prisma/sessoes.repositorio.ts';
import { RepositorioDeSolicitacoesPrisma } from '../../../src/modulos/identidade/infra/prisma/solicitacoes.repositorio.ts';
import { VerificadorDePendenciasFalso } from '../../fakes/identidade/servicos-falsos.ts';
import { URL_APP_TESTE, URL_MIGRACAO_TESTE } from '../preparar-banco.ts';

/** Instante de partida dos testes (o relógio da pilha começa aqui). */
export const T0 = new Date('2026-10-19T12:00:00.000Z');
export const UM_MINUTO = 60_000;
export const UM_DIA = 24 * 60 * UM_MINUTO;

/** Chaves só de teste (32 bytes cada, diferentes entre si, como o `carregarAmbiente` exige). */
export const CHAVES = {
  JWT_SEGREDO: Buffer.alloc(32, 1).toString('base64'),
  CHAVE_CIFRAGEM_DADOS: Buffer.alloc(32, 2).toString('base64'),
  CHAVE_HMAC: Buffer.alloc(32, 3).toString('base64'),
};

/** Senha de teste: não está na lista de senhas comuns nem é curta. */
export const SENHA = 'cavalo-grampo-azul-72';
export const OUTRA_SENHA = 'lampada-verde-trilho-48';

function loggerSilencioso(): PinoLogger {
  const nada = () => undefined;
  return {
    setContext: nada,
    trace: nada,
    debug: nada,
    info: nada,
    warn: nada,
    error: nada,
    fatal: nada,
  } as unknown as PinoLogger;
}

/** Uma conexão da aplicação com os repositórios, os adaptadores e os casos de uso. */
export function montarPilha() {
  const prisma = new PrismaService({ DATABASE_URL: URL_APP_TESTE } as Ambiente, loggerSilencioso());
  const unidade = new UnidadeDeTrabalhoPrisma(prisma);
  const relogio = new RelogioFixo(T0);

  const contas = new RepositorioDeContasPrisma(unidade);
  const sessoes = new RepositorioDeSessoesPrisma(unidade);
  const codigos = new RepositorioDeCodigosDeVerificacaoPrisma(unidade);
  const desafios = new RepositorioDeDesafiosPrisma(unidade);
  const bloqueios = new RepositorioDeBloqueiosPrisma(unidade);
  const documentos = new RepositorioDeDocumentosLegaisPrisma(unidade);
  const segundoFator = new RepositorioDeSegundoFatorPrisma(unidade);
  const solicitacoes = new RepositorioDeSolicitacoesPrisma(unidade);
  const exportacoes = new RepositorioDeExportacoesPrisma(unidade);
  const auditoria = new RepositorioDeAuditoriaPrisma(unidade, relogio);
  const publicador = new PublicadorDeEventosNaOutbox(unidade, relogio);

  const hasher = new Argon2Hasher();
  const cifrador = new CifradorAesGcm(CHAVES);
  const emissor = new EmissorJwt(CHAVES);
  const gerador = new GeradorDeSegredosCripto();
  const totp = new VerificadorTotpOtpauth();
  const pendencias = new VerificadorDePendenciasFalso();

  const anonimizadores = new RegistroDeAnonimizadores();
  anonimizadores.registrar(
    new AnonimizadorDeIdentidade(contas, sessoes, codigos, segundoFator, exportacoes, relogio),
  );

  return {
    prisma,
    unidade,
    relogio,
    repos: {
      contas,
      sessoes,
      codigos,
      desafios,
      bloqueios,
      documentos,
      segundoFator,
      solicitacoes,
      exportacoes,
    },
    servicos: { hasher, cifrador, emissor, gerador, totp, pendencias },
    casos: {
      criarConta: new CriarContaCasoDeUso(
        unidade,
        publicador,
        relogio,
        contas,
        documentos,
        hasher,
        gerador,
      ),
      verificarEmail: new VerificarEmailCasoDeUso(
        unidade,
        relogio,
        contas,
        sessoes,
        codigos,
        bloqueios,
        cifrador,
        gerador,
        emissor,
      ),
      reenviarVerificacao: new ReenviarVerificacaoCasoDeUso(unidade, publicador, contas),
      entrar: new EntrarCasoDeUso(
        unidade,
        relogio,
        contas,
        sessoes,
        bloqueios,
        desafios,
        segundoFator,
        hasher,
        cifrador,
        gerador,
        emissor,
      ),
      renovar: new RenovarSessaoCasoDeUso(
        unidade,
        relogio,
        contas,
        sessoes,
        cifrador,
        gerador,
        emissor,
      ),
      encerrar: new EncerrarSessaoCasoDeUso(unidade, relogio, sessoes, cifrador),
      solicitarRecuperacao: new SolicitarRecuperacaoCasoDeUso(unidade, publicador, contas),
      redefinirSenha: new RedefinirSenhaCasoDeUso(
        unidade,
        relogio,
        contas,
        sessoes,
        codigos,
        desafios,
        bloqueios,
        publicador,
        hasher,
        cifrador,
      ),
      iniciarConfiguracao: new IniciarConfiguracaoDoSegundoFatorCasoDeUso(
        unidade,
        relogio,
        contas,
        desafios,
        bloqueios,
        segundoFator,
        cifrador,
        totp,
      ),
      confirmarConfiguracao: new ConfirmarConfiguracaoDoSegundoFatorCasoDeUso(
        unidade,
        relogio,
        contas,
        desafios,
        bloqueios,
        segundoFator,
        sessoes,
        cifrador,
        gerador,
        totp,
        emissor,
        publicador,
        auditoria,
      ),
      verificarSegundoFator: new VerificarSegundoFatorCasoDeUso(
        unidade,
        relogio,
        contas,
        desafios,
        bloqueios,
        segundoFator,
        sessoes,
        cifrador,
        gerador,
        totp,
        emissor,
        publicador,
        auditoria,
      ),
      reconfigurarSegundoFator: new ReconfigurarSegundoFatorCasoDeUso(
        unidade,
        relogio,
        contas,
        desafios,
        bloqueios,
        segundoFator,
        sessoes,
        auditoria,
        publicador,
        cifrador,
      ),
      solicitarExclusao: new SolicitarExclusaoCasoDeUso(
        unidade,
        contas,
        sessoes,
        bloqueios,
        solicitacoes,
        pendencias,
        publicador,
        hasher,
        cifrador,
        gerador,
        relogio,
      ),
      anonimizarConta: new AnonimizarContaCasoDeUso(
        unidade,
        contas,
        solicitacoes,
        anonimizadores,
        publicador,
        relogio,
      ),
      consultarPrivacidade: new ConsultarPrivacidadeCasoDeUso(documentos, exportacoes, relogio),
      solicitarExportacao: new SolicitarExportacaoCasoDeUso(
        unidade,
        contas,
        solicitacoes,
        publicador,
        gerador,
        relogio,
      ),
      gerarExportacao: new GerarExportacaoCasoDeUso(
        unidade,
        contas,
        documentos,
        segundoFator,
        solicitacoes,
        exportacoes,
        cifrador,
        gerador,
        relogio,
      ),
      baixarExportacao: new BaixarExportacaoCasoDeUso(unidade, exportacoes, cifrador, relogio),
    },
  };
}

export type Pilha = ReturnType<typeof montarPilha>;

// ---------------------------------------------------------------------------
// Dono do banco: leitura direta, documentos legais e limpeza

/** Conexão do dono (papel de migração) para ler o que os casos de uso gravaram e limpar. */
export async function conectarDono(): Promise<pg.Client> {
  const dono = new pg.Client({ connectionString: URL_MIGRACAO_TESTE });
  await dono.connect();
  return dono;
}

export interface DocumentosDeTeste {
  readonly termos: { id: string; versao: string };
  readonly privacidade: { id: string; versao: string };
  /** Apaga o que `semearDocumentos` gravou (e os aceites deles). */
  remover(): Promise<void>;
}

/**
 * Grava, como dono (a aplicação só lê `documentos_legais`, S79), um termo e uma política
 * vigentes desde 2026-06-01, com versões únicas deste teste. O relógio de `T0` fica depois.
 */
export async function semearDocumentos(dono: pg.Client): Promise<DocumentosDeTeste> {
  const sufixo = randomUUID().slice(0, 8);
  const termos = { id: randomUUID(), versao: `e2e-t-${sufixo}` };
  const privacidade = { id: randomUUID(), versao: `e2e-p-${sufixo}` };
  for (const [tipo, documento] of [
    ['termos', termos],
    ['privacidade', privacidade],
  ] as const) {
    await dono.query(
      `INSERT INTO identidade.documentos_legais (id, tipo, versao, conteudo, vigente_desde)
       VALUES ($1, $2, $3, $4, '2026-06-01T00:00:00Z')`,
      [documento.id, tipo, documento.versao, `Texto de ${tipo} do teste`],
    );
  }
  return {
    termos,
    privacidade,
    async remover() {
      const ids = [termos.id, privacidade.id];
      await dono.query(
        'DELETE FROM identidade.consentimentos WHERE documento_id = ANY($1::uuid[])',
        [ids],
      );
      await dono.query('DELETE FROM identidade.documentos_legais WHERE id = ANY($1::uuid[])', [
        ids,
      ]);
    },
  };
}

/**
 * Apaga, como dono, as contas do teste e o que é delas (sessões, histórico, códigos, aceites,
 * solicitações, exportações), os eventos da outbox e a auditoria delas. A trigger
 * `contas_so_expurgo` (S78) vale também para o dono: a conta volta antes à forma que o
 * expurgo aceita (ativa, não verificada, sem admin nem lojista, criada há 8 dias).
 */
export async function apagarContasDoTeste(
  dono: pg.Client,
  ids: readonly string[],
  chavesDeFreio: readonly string[] = [],
): Promise<void> {
  if (chavesDeFreio.length > 0) {
    await dono.query('DELETE FROM identidade.bloqueios_login WHERE chave_hmac = ANY($1::text[])', [
      chavesDeFreio,
    ]);
  }
  if (ids.length === 0) return;
  await dono.query('DELETE FROM compartilhado.outbox WHERE agregado_id = ANY($1::uuid[])', [ids]);
  await dono.query('BEGIN');
  try {
    await dono.query(
      "DELETE FROM identidade.perfis_conta WHERE conta_id = ANY($1::uuid[]) AND perfil IN ('admin', 'lojista')",
      [ids],
    );
    await dono.query(
      `UPDATE identidade.contas
          SET status = 'ativa', desativada_em = NULL, anonimizada_em = NULL,
              telefone_e164 = coalesce(telefone_e164, '+5535999990000'),
              senha_hash = coalesce(senha_hash, '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA'),
              email_verificado_em = NULL, ultimo_login_em = NULL,
              criada_em = now() - interval '8 days'
        WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    await dono.query('DELETE FROM identidade.contas WHERE id = ANY($1::uuid[])', [ids]);
    await dono.query('COMMIT');
  } catch (erro) {
    await dono.query('ROLLBACK');
    throw erro;
  }
}

/** E-mail único do teste, já na forma normalizada. */
export function emailUnico(prefixo = 'qa'): string {
  return `${prefixo}.${randomUUID().slice(0, 12)}@exemplo.com.br`;
}

// ---------------------------------------------------------------------------
// Pontos de pausa e de espera, para ordenar duas requisições sem depender do acaso

export interface Pausa {
  /** Resolve quando a requisição chegou ao ponto de pausa. */
  readonly chegou: Promise<void>;
  /** Deixa a requisição seguir. */
  liberar(): void;
}

/**
 * Na próxima chamada de `alvo[metodo]`, avisa que chegou e espera `liberar()` antes de
 * executar o método de verdade. Vale uma vez só: o método volta ao original na primeira
 * chamada. O ponto de pausa fica DENTRO da unidade de trabalho do caso de uso (o método do
 * repositório é chamado de dentro dela), então o que a requisição já gravou segue travado.
 */
export function pausarAntes<T extends object>(alvo: T, metodo: keyof T & string): Pausa {
  const objeto = alvo as unknown as Record<string, (...argumentos: unknown[]) => Promise<unknown>>;
  const original = objeto[metodo];
  if (original === undefined) throw new Error(`o alvo não tem o método ${metodo}`);
  let avisar: () => void = () => undefined;
  let liberar: () => void = () => undefined;
  const chegou = new Promise<void>((resolver) => {
    avisar = resolver;
  });
  const liberada = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  objeto[metodo] = async (...argumentos: unknown[]) => {
    objeto[metodo] = original;
    avisar();
    await liberada;
    return original.apply(alvo, argumentos);
  };
  return { chegou, liberar };
}

/**
 * Como `pausarAntes`, mas a pausa fica na `n`-ésima chamada (a partir de 1) de `alvo[metodo]`;
 * as anteriores passam direto. Serve para parar o login na conclusão (o 3º `salvar` do freio:
 * os dois primeiros são da reserva), com o freio por e-mail travado e ainda por zerar.
 */
export function pausarAntesDaChamada<T extends object>(
  alvo: T,
  metodo: keyof T & string,
  n: number,
): Pausa {
  const objeto = alvo as unknown as Record<string, (...argumentos: unknown[]) => Promise<unknown>>;
  const original = objeto[metodo];
  if (original === undefined) throw new Error(`o alvo não tem o método ${metodo}`);
  let avisar: () => void = () => undefined;
  let liberar: () => void = () => undefined;
  const chegou = new Promise<void>((resolver) => {
    avisar = resolver;
  });
  const liberada = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  let chamadas = 0;
  objeto[metodo] = async (...argumentos: unknown[]) => {
    chamadas += 1;
    if (chamadas < n) return original.apply(alvo, argumentos);
    objeto[metodo] = original;
    avisar();
    await liberada;
    return original.apply(alvo, argumentos);
  };
  return { chegou, liberar };
}

/** Como `pausarAntes`, mas a pausa vem DEPOIS de o método executar (o que ele gravou fica travado). */
export function pausarDepois<T extends object>(alvo: T, metodo: keyof T & string): Pausa {
  const objeto = alvo as unknown as Record<string, (...argumentos: unknown[]) => Promise<unknown>>;
  const original = objeto[metodo];
  if (original === undefined) throw new Error(`o alvo não tem o método ${metodo}`);
  let avisar: () => void = () => undefined;
  let liberar: () => void = () => undefined;
  const chegou = new Promise<void>((resolver) => {
    avisar = resolver;
  });
  const liberada = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  objeto[metodo] = async (...argumentos: unknown[]) => {
    objeto[metodo] = original;
    const resultado = await original.apply(alvo, argumentos);
    avisar();
    await liberada;
    return resultado;
  };
  return { chegou, liberar };
}

/** Quantas transações estão paradas numa trava (pedido não concedido em `pg_locks`). */
async function esperandoTrava(dono: pg.Client): Promise<number> {
  const { rows } = await dono.query<{ esperando: number }>(
    'SELECT count(*)::int AS esperando FROM pg_locks WHERE NOT granted',
  );
  return rows[0]?.esperando ?? 0;
}

/** Espera até haver uma transação parada numa trava (a segunda requisição esperando a primeira). */
export async function esperarAlguemNaTrava(dono: pg.Client): Promise<void> {
  const limite = Date.now() + 8_000;
  while (Date.now() < limite) {
    if ((await esperandoTrava(dono)) > 0) return;
    await new Promise((resolver) => setTimeout(resolver, 20));
  }
  throw new Error('nenhuma transação chegou a esperar uma trava');
}

/** Confere por um instante que NINGUÉM está esperando trava (a segunda não deveria bloquear). */
export async function ninguemEsperaTrava(dono: pg.Client, ms = 300): Promise<boolean> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if ((await esperandoTrava(dono)) > 0) return false;
    await new Promise((resolver) => setTimeout(resolver, 20));
  }
  return true;
}

// ---------------------------------------------------------------------------
// Dados de teste prontos

export interface ContaDeTeste {
  readonly id: string;
  readonly email: string;
  readonly nome: string;
  readonly telefone: string;
  readonly senha: string;
}

export const NOME_PADRAO = 'Ana Júlia Souza';
export const TELEFONE_PADRAO = '+5535999991234';

/** Cadastra pelo caso de uso (hash real) e devolve a conta lida do banco. */
export async function cadastrar(
  pilha: Pilha,
  documentos: DocumentosDeTeste,
  opcoes: { email?: string; nome?: string; telefone?: string; senha?: string } = {},
): Promise<ContaDeTeste> {
  const email = opcoes.email ?? emailUnico();
  const nome = opcoes.nome ?? NOME_PADRAO;
  const telefone = opcoes.telefone ?? TELEFONE_PADRAO;
  const senha = opcoes.senha ?? SENHA;
  const resultado = await pilha.casos.criarConta.executar({
    nome,
    email,
    telefone,
    senha,
    aceites: { termos: documentos.termos.versao, privacidade: documentos.privacidade.versao },
  });
  if (resultado.tipo !== 'aceito') throw new Error('o cadastro de teste não foi aceito');
  const { Email } = await import('../../../src/modulos/identidade/dominio/email.ts');
  const conta = await pilha.repos.contas.buscarPorEmail(Email.criar(email));
  if (conta === null) throw new Error('a conta de teste não foi gravada');
  return { id: conta.id, email, nome, telefone, senha };
}

/** Grava um código de e-mail (verificação ou recuperação) como o assinante da etapa 13 gravaria. */
export async function inserirCodigo(
  pilha: Pilha,
  contaId: string,
  finalidade: 'verificacao_email' | 'recuperacao_senha',
  codigo: string,
): Promise<void> {
  const { CodigoDeVerificacao } =
    await import('../../../src/modulos/identidade/dominio/codigo-de-verificacao.ts');
  const registro = CodigoDeVerificacao.emitir({
    id: randomUUID(),
    contaId,
    finalidade,
    codigoHmac: pilha.servicos.cifrador.hmac(finalidade, [contaId, codigo]),
    agora: pilha.relogio.agora(),
  });
  await pilha.unidade.executar(async () => {
    await pilha.repos.codigos.invalidarVigentes(contaId, finalidade, pilha.relogio.agora());
    await pilha.repos.codigos.inserir(registro);
  });
}

/** Eventos da outbox da conta: tipo e payload, ordenados por tipo. */
export async function eventosDaConta(
  dono: pg.Client,
  contaId: string,
): Promise<{ tipo: string; payload: unknown }[]> {
  const { rows } = await dono.query<{ tipo: string; payload: unknown }>(
    'SELECT tipo, payload FROM compartilhado.outbox WHERE agregado_id = $1::uuid ORDER BY tipo',
    [contaId],
  );
  return rows;
}

export interface LinhaDeSessao {
  id: string;
  cliente: string;
  token_hash: string;
  revogada_em: Date | null;
  motivo_revogacao: string | null;
  expira_em: Date;
  expira_absoluto_em: Date | null;
  mfa: boolean;
}

/** As sessões da conta, direto do banco, da mais antiga para a mais nova. */
export async function sessoesDaConta(dono: pg.Client, contaId: string): Promise<LinhaDeSessao[]> {
  const { rows } = await dono.query<LinhaDeSessao>(
    `SELECT id::text, cliente::text, token_hash, revogada_em, motivo_revogacao, expira_em,
            expira_absoluto_em, mfa
       FROM identidade.sessoes WHERE conta_id = $1::uuid ORDER BY criada_em, id`,
    [contaId],
  );
  return rows;
}

/** Quantas sessões da conta continuam sem revogação. */
export async function sessoesVivas(dono: pg.Client, contaId: string): Promise<number> {
  const { rows } = await dono.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM identidade.sessoes WHERE conta_id = $1::uuid AND revogada_em IS NULL',
    [contaId],
  );
  return rows[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Segundo fator do admin

/** O código de 6 dígitos que o app autenticador mostraria em `quando`. */
export function totpDe(segredoBase32: string, quando: Date): string {
  return new TOTP({
    secret: Secret.fromBase32(segredoBase32),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).generate({ timestamp: quando.getTime() });
}

/**
 * Cadastra uma conta, concede `admin` (como a CLI faria) e conclui a configuração do segundo
 * fator pelos casos de uso: login no painel, configuração, confirmação. Devolve o segredo, os
 * 10 códigos de recuperação e a sessão do painel aberta pela confirmação.
 */
/**
 * Uma conta admin ativa (cadastro + `admin` concedido direto, sem 2FA), para servir de
 * operador da CLI `seed:admin` (S106). Devolve a conta; quem chama a põe na limpeza.
 */
export async function operadorAdmin(
  pilha: Pilha,
  documentos: DocumentosDeTeste,
): Promise<ContaDeTeste> {
  const conta = await cadastrar(pilha, documentos);
  const { Email } = await import('../../../src/modulos/identidade/dominio/email.ts');
  const carregada = await pilha.repos.contas.buscarPorEmail(Email.criar(conta.email));
  if (carregada === null) throw new Error('conta sumiu');
  carregada.concederAdmin(pilha.relogio.agora());
  await pilha.repos.contas.atualizar(carregada);
  return conta;
}

export async function prepararAdmin(
  pilha: Pilha,
  documentos: DocumentosDeTeste,
  ip: string,
): Promise<{
  conta: ContaDeTeste;
  segredo: string;
  recuperacao: readonly string[];
  sessao: { tokenAcesso: string; tokenRenovacao: string };
}> {
  const conta = await cadastrar(pilha, documentos);
  const { Email } = await import('../../../src/modulos/identidade/dominio/email.ts');
  const carregada = await pilha.repos.contas.buscarPorEmail(Email.criar(conta.email));
  if (carregada === null) throw new Error('conta sumiu');
  carregada.concederAdmin(pilha.relogio.agora());
  await pilha.repos.contas.atualizar(carregada);

  const login = await pilha.casos.entrar.executar({
    email: conta.email,
    senha: conta.senha,
    cliente: 'painel',
    ip,
  });
  if (login.tipo !== 'desafio') throw new Error(`login do admin devolveu ${login.tipo}`);
  const configuracao = await pilha.casos.iniciarConfiguracao.executar({
    desafio: login.desafio.desafio,
  });
  if (configuracao.tipo !== 'configuracao') throw new Error('configuração recusada');
  const confirmacao = await pilha.casos.confirmarConfiguracao.executar({
    desafio: login.desafio.desafio,
    codigo: totpDe(configuracao.segredoBase32, pilha.relogio.agora()),
  });
  if (confirmacao.tipo !== 'concluido') throw new Error('confirmação recusada');
  return {
    conta,
    segredo: configuracao.segredoBase32,
    recuperacao: confirmacao.codigosRecuperacao,
    sessao: confirmacao.sessao,
  };
}
