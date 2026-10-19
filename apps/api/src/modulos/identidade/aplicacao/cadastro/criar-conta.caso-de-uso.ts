// Cadastro (`POST /v1/contas`, público; CA-01, CA-02; plano 01b, etapa 8).
//
// - Aceite versionado (CA-01, S24): as versões que a pessoa leu precisam ser as
//   vigentes de termos e privacidade; senão, `aceites_divergentes` (400 na
//   etapa 16). A conferência vem antes de olhar o e-mail, então não revela se
//   ele tem conta.
// - E-mail que já tem conta, verificada ou não, em qualquer status (P1-dono,
//   substitui o S6): nada muda na conta, a resposta é a mesma do cadastro novo
//   e sai `CadastroRepetidoTentado`, para o dono do e-mail receber o aviso
//   (deduplicado em 1/h pelo assinante, S15, etapa 13).
// - O hash da senha é calculado nos dois caminhos, antes de saber se o e-mail
//   tem conta, para o tempo de resposta não separar um do outro. Fica fora da
//   transação: o Argon2id não segura conexão aberta.
// - Conta nova: perfil `consumidor`, e-mail não verificado, consentimento dos
//   dois documentos e `ContaCriada`. O código de verificação não nasce aqui: o
//   assinante de `ContaCriada` o gera no envio e guarda só o HMAC (etapa 13),
//   para o código nunca passar pela outbox.
// - O e-mail gravado e comparado é só `email_normalizado` (`Email`); este caso
//   de uso não guarda nem repassa o e-mail do corpo. Os eventos levam só o id.
import { Injectable } from '@nestjs/common';
import { PublicadorDeEventos } from '../../../../compartilhado/eventos/publicador.ts';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import {
  aceitesDivergentes,
  Conta,
  decidirCadastro,
  EmailJaCadastrado,
  type TipoDeDocumentoLegal,
} from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import {
  type DocumentoLegal,
  RepositorioDeContas,
  RepositorioDeDocumentosLegais,
} from '../../dominio/repositorios.ts';
import { Telefone } from '../../dominio/telefone.ts';
import { eventoDeIdentidade } from '../eventos.ts';
import { GeradorDeSegredos } from '../portas/gerador-de-segredos.ts';
import { Hasher } from '../portas/hasher.ts';

/**
 * Corpo do cadastro já validado por `criarContaSchema` (`@bairrin/contratos`):
 * e-mail normalizado, telefone em E.164 e senha como foi digitada.
 */
export interface EntradaDeCriarConta {
  readonly nome: string;
  readonly email: string;
  readonly telefone: string;
  readonly senha: string;
  /** Versões de termos e privacidade que a pessoa aceitou. */
  readonly aceites: Readonly<Record<TipoDeDocumentoLegal, string>>;
}

/**
 * - `aceito`: conta criada ou e-mail que já tinha conta, sem distinção (CA-02);
 * - `aceites_divergentes`: versão aceita diferente da vigente (S24), com os
 *   documentos que divergem, na ordem `termos`, `privacidade`.
 */
export type ResultadoDeCriarConta =
  | { readonly tipo: 'aceito' }
  | { readonly tipo: 'aceites_divergentes'; readonly documentos: TipoDeDocumentoLegal[] };

/** Falta documento legal vigente: erro de configuração (seed ou migração), não da entrada. */
export class SemDocumentoLegalVigente extends Error {
  constructor(readonly tipoDoDocumento: TipoDeDocumentoLegal) {
    super(`Não há documento legal vigente do tipo ${tipoDoDocumento}.`);
    this.name = 'SemDocumentoLegalVigente';
  }
}

type DocumentosVigentes = Readonly<Record<TipoDeDocumentoLegal, DocumentoLegal>>;

interface Cadastro {
  readonly nome: string;
  readonly email: Email;
  readonly telefone: Telefone;
  readonly senhaHash: string;
  readonly documentos: DocumentosVigentes;
  readonly agora: Date;
}

@Injectable()
export class CriarContaCasoDeUso {
  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly publicador: PublicadorDeEventos,
    private readonly relogio: Relogio,
    private readonly contas: RepositorioDeContas,
    private readonly documentosLegais: RepositorioDeDocumentosLegais,
    private readonly hasher: Hasher,
    private readonly gerador: GeradorDeSegredos,
  ) {}

  async executar(entrada: EntradaDeCriarConta): Promise<ResultadoDeCriarConta> {
    const agora = this.relogio.agora();
    const email = Email.criar(entrada.email);
    const telefone = Telefone.criar(entrada.telefone);

    const documentos = await this.#documentosVigentes(agora);
    const divergentes = aceitesDivergentes(entrada.aceites, {
      termos: documentos.termos.versao,
      privacidade: documentos.privacidade.versao,
    });
    if (divergentes.length > 0) return { tipo: 'aceites_divergentes', documentos: divergentes };

    // Antes de saber se o e-mail tem conta: os dois caminhos gastam o hash (CA-02).
    const senhaHash = await this.hasher.gerarHash(entrada.senha);
    const cadastro: Cadastro = {
      nome: entrada.nome,
      email,
      telefone,
      senhaHash,
      documentos,
      agora,
    };

    try {
      await this.unidade.executar(() => this.#cadastrar(cadastro));
    } catch (erro) {
      if (!(erro instanceof EmailJaCadastrado)) throw erro;
      // Outro cadastro do mesmo e-mail confirmou entre a busca e o INSERT. A
      // transação com o INSERT recusado foi desfeita; o aviso vai numa nova.
      await this.unidade.executar(() => this.#avisarCadastroRepetido(email));
    }
    return { tipo: 'aceito' };
  }

  async #cadastrar(cadastro: Cadastro): Promise<void> {
    const decisao = decidirCadastro(await this.contas.buscarPorEmail(cadastro.email));
    if (decisao.tipo === 'repetido') {
      await this.publicador.publicar(
        eventoDeIdentidade('CadastroRepetidoTentado', { contaId: decisao.contaId }),
      );
      return;
    }

    const conta = Conta.criar({
      id: this.gerador.novoId(),
      nome: cadastro.nome,
      email: cadastro.email,
      telefone: cadastro.telefone,
      senhaHash: cadastro.senhaHash,
      agora: cadastro.agora,
    });
    await this.contas.inserir(conta);
    for (const documento of [cadastro.documentos.termos, cadastro.documentos.privacidade]) {
      await this.documentosLegais.registrarConsentimento({
        id: this.gerador.novoId(),
        contaId: conta.id,
        documentoId: documento.id,
        aceitoEm: cadastro.agora,
      });
    }
    await this.publicador.publicar(eventoDeIdentidade('ContaCriada', { contaId: conta.id }));
  }

  async #avisarCadastroRepetido(email: Email): Promise<void> {
    const existente = await this.contas.buscarPorEmail(email);
    // Sem conta aqui, a vencedora já sumiu (expurgo no meio): não há a quem avisar.
    if (existente === null) return;
    await this.publicador.publicar(
      eventoDeIdentidade('CadastroRepetidoTentado', { contaId: existente.id }),
    );
  }

  async #documentosVigentes(agora: Date): Promise<DocumentosVigentes> {
    const termos = await this.documentosLegais.buscarVigente('termos', agora);
    if (termos === null) throw new SemDocumentoLegalVigente('termos');
    const privacidade = await this.documentosLegais.buscarVigente('privacidade', agora);
    if (privacidade === null) throw new SemDocumentoLegalVigente('privacidade');
    return { termos, privacidade };
  }
}
