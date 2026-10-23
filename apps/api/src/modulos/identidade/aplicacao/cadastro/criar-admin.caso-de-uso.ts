// Criação da conta admin pela CLI `seed:admin` (CA-07; plano 01b, etapa 13).
// Nenhuma rota chama este caso de uso: é o único caminho que cria conta com o
// perfil `admin`.
//
// A conta nasce sem senha (`Conta.criarAdmin`): `podeEntrar` é falso até a
// primeira redefinição, e sai `RecuperacaoSolicitada`, para o assinante mandar
// o código de redefinição ao e-mail da conta. Só quem lê esse e-mail define a
// senha (o que também verifica o e-mail) e, no primeiro login no painel,
// configura o app autenticador (CA-09). Nada de senha aleatória descartada.
//
// Numa transação: grava a conta com os perfis `consumidor` e `admin`, publica
// o evento e registra na auditoria (`admin_criado`, origem `cli`, só com ids).
// E-mail que já tem conta não muda nada: `email_ja_cadastrado` (conceder admin
// a uma conta existente não é papel desta CLI).
//
// Operador (S106): o primeiro admin nasce com ator `sistema` (não há admin
// para responder por ele). Depois dele, quem roda a CLI informa a própria
// conta (`--operador <id>`), que precisa ser admin ativa, e ela é o ator
// (`admin`) da auditoria, como na CLI de reconfiguração do 2FA. Sem operador
// válido, nada é gravado. A unidade começa por uma trava única
// (`travarCriacaoDeAdmin`): duas execuções simultâneas sem admin ativo não
// criam dois admins com ator `sistema`; a segunda espera e lê o primeiro.
//
// Entrada como o operador digitou: o nome, o e-mail e o telefone são
// validados aqui (`Conta.criarAdmin`, `Email`, `Telefone`) e qualquer um
// inválido encerra sem gravar nada. Nenhum resultado traz o valor recusado.
import { Injectable } from '@nestjs/common';
import { RepositorioDeAuditoria } from '../../../../compartilhado/auditoria/repositorio-de-auditoria.ts';
import { PublicadorDeEventos } from '../../../../compartilhado/eventos/publicador.ts';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import { Conta, EmailJaCadastrado, NomeInvalido } from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import { RepositorioDeContas } from '../../dominio/repositorios.ts';
import { Telefone } from '../../dominio/telefone.ts';
import { eventoDeIdentidade } from '../eventos.ts';
import { GeradorDeSegredos } from '../portas/gerador-de-segredos.ts';

export interface EntradaDeCriarAdmin {
  readonly nome: string;
  /** Nunca vai para log, saída nem auditoria. */
  readonly email: string;
  /** Celular com DDD, em qualquer forma que `normalizarCelular` aceite. */
  readonly telefone: string;
  /**
   * Id da conta admin de quem roda a CLI (`--operador`): obrigatório quando já
   * existe admin ativo, e então o ator da auditoria. `null` só para o primeiro.
   */
  readonly operadorId: string | null;
}

export type ResultadoDeCriarAdmin =
  | { readonly tipo: 'criado'; readonly contaId: string }
  | { readonly tipo: 'nome_invalido' }
  | { readonly tipo: 'email_invalido' }
  | { readonly tipo: 'telefone_invalido' }
  | { readonly tipo: 'email_ja_cadastrado' }
  /** Já existe admin ativo e não veio `--operador`. */
  | { readonly tipo: 'operador_obrigatorio' }
  /** O operador não é uma conta admin ativa (ou ainda não há admin nenhum). */
  | { readonly tipo: 'operador_invalido' };

/** Quem responde pela criação na auditoria. */
type AtorDaCriacao =
  | { readonly atorTipo: 'sistema'; readonly atorId: null }
  | { readonly atorTipo: 'admin'; readonly atorId: string };

@Injectable()
export class CriarAdminCasoDeUso {
  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly relogio: Relogio,
    private readonly contas: RepositorioDeContas,
    private readonly auditoria: RepositorioDeAuditoria,
    private readonly publicador: PublicadorDeEventos,
    private readonly gerador: GeradorDeSegredos,
  ) {}

  async executar(entrada: EntradaDeCriarAdmin): Promise<ResultadoDeCriarAdmin> {
    const email = Email.tentarCriar(entrada.email);
    if (email === null) return { tipo: 'email_invalido' };
    const telefone = Telefone.tentarCriar(entrada.telefone);
    if (telefone === null) return { tipo: 'telefone_invalido' };
    let conta: Conta;
    try {
      conta = Conta.criarAdmin({
        id: this.gerador.novoId(),
        nome: entrada.nome,
        email,
        telefone,
        agora: this.relogio.agora(),
      });
    } catch (erro) {
      if (erro instanceof NomeInvalido) return { tipo: 'nome_invalido' };
      throw erro;
    }

    try {
      return await this.unidade.executar(async (): Promise<ResultadoDeCriarAdmin> => {
        await this.contas.travarCriacaoDeAdmin();
        const ator = await this.#ator(entrada.operadorId);
        if ('tipo' in ator) return ator;
        if ((await this.contas.buscarPorEmail(email)) !== null) throw new EmailJaCadastrado();
        await this.contas.inserir(conta);
        await this.publicador.publicar(
          eventoDeIdentidade('RecuperacaoSolicitada', { contaId: conta.id }),
        );
        await this.auditoria.registrar({
          ...ator,
          acao: 'admin_criado',
          recurso: 'conta',
          recursoId: conta.id,
          depois: { perfis: [...conta.perfis], senhaDefinida: false },
          origem: 'cli',
        });
        return { tipo: 'criado', contaId: conta.id };
      });
    } catch (erro) {
      // `inserir` também lança quando perde a corrida para outro cadastro do e-mail.
      if (erro instanceof EmailJaCadastrado) return { tipo: 'email_ja_cadastrado' };
      throw erro;
    }
  }

  /**
   * O ator da auditoria (S106): `sistema` para o primeiro admin, sem operador;
   * depois dele, o operador, que precisa ser uma conta admin ativa.
   */
  async #ator(
    operadorId: string | null,
  ): Promise<AtorDaCriacao | { readonly tipo: 'operador_obrigatorio' | 'operador_invalido' }> {
    const haAdmin = await this.contas.existeAdminAtivo();
    if (operadorId === null) {
      return haAdmin ? { tipo: 'operador_obrigatorio' } : { atorTipo: 'sistema', atorId: null };
    }
    const operador = haAdmin ? await this.contas.buscarPorId(operadorId) : null;
    const valido = operador !== null && operador.status === 'ativa' && operador.temPerfil('admin');
    return valido ? { atorTipo: 'admin', atorId: operador.id } : { tipo: 'operador_invalido' };
  }
}
