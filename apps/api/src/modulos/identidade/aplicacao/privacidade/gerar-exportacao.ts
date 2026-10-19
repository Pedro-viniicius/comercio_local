// Geração da cópia dos dados (CA-10, S10), chamada pelo assinante de
// `ExportacaoSolicitada` (etapa 13): monta o JSON com o que a Identidade guarda
// da conta, cifra com AES-GCM e a conta como AAD (`Cifrador`, finalidade
// `exportacao_titular`), grava em `exportacoes_titular` com validade de 7 dias
// e conclui a solicitação, tudo na mesma transação.
//
// O arquivo só sai pela tela de Privacidade, com sessão (`BaixarExportacaoCasoDeUso`);
// o e-mail do assinante só avisa que está pronto, sem anexo nem link com
// segredo (S10). Nada do conteúdo vai para log, evento ou erro.
//
// Idempotente para a reentrega do evento: solicitação já concluída, de outra
// conta, de outro tipo ou inexistente não gera nada (`ignorada`). A conta é
// travada antes de ler a solicitação (`buscarPorIdParaAtualizar`), então duas
// entregas simultâneas do mesmo evento não geram duas cópias: a segunda espera
// e acha a solicitação concluída. Antes de gravar a cópia nova, as anteriores
// ainda não baixadas são apagadas (S98): só a mais recente pode ser baixada.
import { Injectable } from '@nestjs/common';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import type { Conta } from '../../dominio/conta.ts';
import {
  RepositorioDeContas,
  RepositorioDeDocumentosLegais,
  RepositorioDeExportacoes,
  RepositorioDeSegundoFator,
  RepositorioDeSolicitacoes,
  type SolicitacaoDoTitular,
} from '../../dominio/repositorios.ts';
import { Cifrador } from '../portas/cifrador.ts';
import { GeradorDeSegredos } from '../portas/gerador-de-segredos.ts';

/** Dias em que a cópia pronta pode ser baixada (S10). */
export const DIAS_DE_VALIDADE_DA_EXPORTACAO = 7;

const VALIDADE_EM_MS = DIAS_DE_VALIDADE_DA_EXPORTACAO * 24 * 60 * 60 * 1000;

/** Identifica o formato do arquivo, para uma mudança futura virar versão nova. */
export const FORMATO_DA_EXPORTACAO = 'bairrin.exportacao-do-titular';
export const VERSAO_DA_EXPORTACAO = 1;

/**
 * O arquivo, antes de cifrar. Só dados da própria conta: nada de segredo
 * (hash da senha, segredo TOTP, tokens, HMACs) nem id de outra conta (quem
 * concedeu um perfil).
 */
export interface ArquivoDeExportacao {
  formato: typeof FORMATO_DA_EXPORTACAO;
  versao: typeof VERSAO_DA_EXPORTACAO;
  geradaEm: string;
  identidade: {
    conta: {
      id: string;
      nome: string;
      email: string;
      telefone: string | null;
      status: string;
      criadaEm: string;
      emailVerificadoEm: string | null;
      ultimoLoginEm: string | null;
    };
    perfis: { perfil: string; concedidoEm: string }[];
    /** Todos os aceites da conta, inclusive de versões fora de vigor, do mais antigo ao mais novo. */
    aceites: { documento: string; versao: string; aceitoEm: string }[];
    segundoFator: { configurado: boolean; confirmadoEm: string | null };
  };
}

export interface EntradaDaGeracaoDeExportacao {
  /** Do payload de `ExportacaoSolicitada`. */
  contaId: string;
  solicitacaoId: string;
}

/**
 * - `gerada`: arquivo gravado, válido até `expiraEm`; o assinante manda o aviso;
 * - `ignorada`: nada a fazer (reentrega ou payload que não confere);
 * - `conta_indisponivel`: a conta foi excluída depois do pedido; a solicitação
 *   é concluída sem arquivo e nenhum aviso sai.
 */
export type ResultadoDaGeracaoDeExportacao =
  { tipo: 'gerada'; expiraEm: Date } | { tipo: 'ignorada' } | { tipo: 'conta_indisponivel' };

@Injectable()
export class GerarExportacaoCasoDeUso {
  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly contas: RepositorioDeContas,
    private readonly documentos: RepositorioDeDocumentosLegais,
    private readonly segundoFator: RepositorioDeSegundoFator,
    private readonly solicitacoes: RepositorioDeSolicitacoes,
    private readonly exportacoes: RepositorioDeExportacoes,
    private readonly cifrador: Cifrador,
    private readonly gerador: GeradorDeSegredos,
    private readonly relogio: Relogio,
  ) {}

  executar({
    contaId,
    solicitacaoId,
  }: EntradaDaGeracaoDeExportacao): Promise<ResultadoDaGeracaoDeExportacao> {
    return this.unidade.executar(async () => {
      const agora = this.relogio.agora();
      const conta = await this.contas.buscarPorIdParaAtualizar(contaId);
      const solicitacao = await this.solicitacoes.buscarPorId(solicitacaoId);
      if (
        solicitacao === null ||
        solicitacao.contaId !== contaId ||
        solicitacao.tipo !== 'exportacao' ||
        solicitacao.status === 'concluida'
      ) {
        return { tipo: 'ignorada' };
      }
      if (conta === null || conta.status !== 'ativa') {
        await this.#concluir(solicitacao, agora);
        return { tipo: 'conta_indisponivel' };
      }
      const arquivo = await this.#montar(conta, agora);
      const expiraEm = new Date(agora.getTime() + VALIDADE_EM_MS);
      await this.exportacoes.apagarNaoBaixadas(contaId);
      await this.exportacoes.inserir({
        id: this.gerador.novoId(),
        contaId,
        conteudoCifrado: this.cifrador.cifrar(
          'exportacao_titular',
          JSON.stringify(arquivo),
          contaId,
        ),
        criadaEm: agora,
        expiraEm,
        baixadaEm: null,
      });
      await this.#concluir(solicitacao, agora);
      return { tipo: 'gerada', expiraEm };
    });
  }

  async #montar(conta: Conta, agora: Date): Promise<ArquivoDeExportacao> {
    const dados = conta.dados;
    const consentimentos = await this.documentos.listarConsentimentos(conta.id);
    const fator = await this.segundoFator.buscar(conta.id);
    const fatorConfirmadoEm = fator?.confirmadoEm ?? null;
    return {
      formato: FORMATO_DA_EXPORTACAO,
      versao: VERSAO_DA_EXPORTACAO,
      geradaEm: agora.toISOString(),
      identidade: {
        conta: {
          id: dados.id,
          nome: dados.nome,
          email: dados.emailNormalizado,
          telefone: dados.telefoneE164,
          status: dados.status,
          criadaEm: dados.criadaEm.toISOString(),
          emailVerificadoEm: iso(dados.emailVerificadoEm),
          ultimoLoginEm: iso(dados.ultimoLoginEm),
        },
        perfis: dados.perfis.map(({ perfil, concedidoEm }) => ({
          perfil,
          concedidoEm: concedidoEm.toISOString(),
        })),
        aceites: consentimentos.map(({ tipo, versao, aceitoEm }) => ({
          documento: tipo,
          versao,
          aceitoEm: aceitoEm.toISOString(),
        })),
        segundoFator: {
          configurado: fatorConfirmadoEm !== null,
          confirmadoEm: iso(fatorConfirmadoEm),
        },
      },
    };
  }

  async #concluir(solicitacao: SolicitacaoDoTitular, agora: Date): Promise<void> {
    await this.solicitacoes.atualizar({ ...solicitacao, status: 'concluida', concluidaEm: agora });
  }
}

function iso(data: Date | null): string | null {
  return data === null ? null : data.toISOString();
}
