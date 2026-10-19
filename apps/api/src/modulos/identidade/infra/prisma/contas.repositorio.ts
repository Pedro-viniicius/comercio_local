// Adaptador Prisma de `RepositorioDeContas` (`identidade.contas` e
// `perfis_conta`; plano 01b, etapa 7). Toda consulta sai pelo client da unidade
// de trabalho (`UnidadeDeTrabalhoPrisma.cliente()`), na transação aberta quando
// houver.
//
// - `inserir` usa `ON CONFLICT (email_normalizado) DO NOTHING` e confere a
//   linha gravada: o e-mail repetido vira `EmailJaCadastrado` sem erro do
//   Postgres, então a transação do cadastro continua usável para responder
//   como o CA-02 e publicar o aviso. Um erro do banco dentro da transação a
//   deixaria abortada (25P02) para o resto do caso de uso.
// - `atualizar` converte o `P2002` (e-mail de outra conta) em
//   `EmailJaCadastrado` só pelo código; a mensagem do erro nunca segue adiante.
// - `gravarUltimoLogin`, `gravarEmailVerificado`, `gravarSenhaRedefinida`,
//   `gravarSenhaRemovida` e `gravarDesativacao` mudam só as suas colunas e só
//   em conta ativa (S95).
// - `buscarPorIdParaAtualizar` trava a linha com `FOR NO KEY UPDATE` (o nível
//   do UPDATE de colunas comuns), que não espera quem só insere filha pela FK.
// - `listarParaExpurgo` repete em SQL a regra de `Conta.deveSerExpurgada`, e a
//   trigger `contas_so_expurgo` (S78) recusa em `apagar` o que fugir dela.
import { Injectable } from '@nestjs/common';
import type {
  Conta as ContaPrisma,
  PerfilDaConta as PerfilDaContaPrisma,
} from '../../../../compartilhado/infra/gerado/prisma/client.ts';
import { UnidadeDeTrabalhoPrisma } from '../../../../compartilhado/infra/unidade-de-trabalho-prisma.ts';
import { Conta, EmailJaCadastrado } from '../../dominio/conta.ts';
import type { Email } from '../../dominio/email.ts';
import { RepositorioDeContas } from '../../dominio/repositorios.ts';
import { ehErroDoPrisma, ehUuid, exigirTransacao } from './comum.ts';

/** Perfis na ordem de concessão, como a conta os guarda. */
const PERFIS_EM_ORDEM = {
  perfis: { orderBy: [{ concedidoEm: 'asc' as const }, { perfil: 'asc' as const }] },
};

@Injectable()
export class RepositorioDeContasPrisma extends RepositorioDeContas {
  constructor(private readonly unidade: UnidadeDeTrabalhoPrisma) {
    super();
  }

  override async buscarPorId(id: string): Promise<Conta | null> {
    if (!ehUuid(id)) return null;
    const linha = await this.unidade.cliente().conta.findUnique({
      where: { id },
      include: PERFIS_EM_ORDEM,
    });
    return linha === null ? null : paraConta(linha);
  }

  override async buscarPorIdParaAtualizar(id: string): Promise<Conta | null> {
    const transacao = exigirTransacao(this.unidade, 'buscarPorIdParaAtualizar');
    if (!ehUuid(id)) return null;
    await transacao.$executeRaw`
      SELECT 1 FROM identidade.contas WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
    // Outro comando, depois da trava: lê a versão que a outra transação confirmou.
    const linha = await transacao.conta.findUnique({ where: { id }, include: PERFIS_EM_ORDEM });
    return linha === null ? null : paraConta(linha);
  }

  override async buscarPorEmail(email: Email): Promise<Conta | null> {
    const linha = await this.unidade.cliente().conta.findUnique({
      where: { emailNormalizado: email.valor },
      include: PERFIS_EM_ORDEM,
    });
    return linha === null ? null : paraConta(linha);
  }

  override async inserir(conta: Conta): Promise<void> {
    const { perfis, ...c } = conta.dados;
    await this.unidade.executar(async () => {
      const gravadas = await this.unidade.cliente().$executeRaw`
        INSERT INTO identidade.contas
          (id, nome, email_normalizado, telefone_e164, senha_hash, email_verificado_em,
           ultimo_login_em, status, criada_em, desativada_em, anonimizada_em)
        VALUES
          (${c.id}::uuid, ${c.nome}, ${c.emailNormalizado}, ${c.telefoneE164}, ${c.senhaHash},
           ${c.emailVerificadoEm}, ${c.ultimoLoginEm}, ${c.status}::identidade.status_da_conta,
           ${c.criadaEm}, ${c.desativadaEm}, ${c.anonimizadaEm})
        ON CONFLICT (email_normalizado) DO NOTHING`;
      if (gravadas !== 1) throw new EmailJaCadastrado();
      await this.unidade.cliente().perfilDaConta.createMany({
        data: perfis.map((perfil) => ({ contaId: c.id, ...perfil })),
      });
    });
  }

  override async atualizar(conta: Conta): Promise<void> {
    const { perfis, id, criadaEm: _criadaEm, ...colunas } = conta.dados;
    await this.unidade.executar(async () => {
      try {
        await this.unidade.cliente().conta.update({
          where: { id },
          data: colunas,
          select: { id: true },
        });
      } catch (erro) {
        if (ehErroDoPrisma(erro, 'P2002')) throw new EmailJaCadastrado();
        throw erro;
      }
      await this.unidade.cliente().perfilDaConta.createMany({
        data: perfis.map((perfil) => ({ contaId: id, ...perfil })),
        skipDuplicates: true,
      });
    });
  }

  override async gravarUltimoLogin(id: string, quando: Date): Promise<boolean> {
    if (!ehUuid(id)) return false;
    const alteradas = await this.unidade.cliente().$executeRaw`
      UPDATE identidade.contas SET ultimo_login_em = ${quando}
       WHERE id = ${id}::uuid AND status = 'ativa'`;
    return alteradas === 1;
  }

  override async gravarEmailVerificado(id: string, quando: Date): Promise<boolean> {
    if (!ehUuid(id)) return false;
    const alteradas = await this.unidade.cliente().$executeRaw`
      UPDATE identidade.contas SET email_verificado_em = coalesce(email_verificado_em, ${quando})
       WHERE id = ${id}::uuid AND status = 'ativa'`;
    return alteradas === 1;
  }

  override async gravarSenhaRedefinida(
    id: string,
    senhaHash: string,
    quando: Date,
  ): Promise<boolean> {
    if (!ehUuid(id)) return false;
    const alteradas = await this.unidade.cliente().$executeRaw`
      UPDATE identidade.contas
         SET senha_hash = ${senhaHash},
             email_verificado_em = coalesce(email_verificado_em, ${quando})
       WHERE id = ${id}::uuid AND status = 'ativa'`;
    return alteradas === 1;
  }

  override async gravarSenhaRemovida(id: string): Promise<boolean> {
    if (!ehUuid(id)) return false;
    const alteradas = await this.unidade.cliente().$executeRaw`
      UPDATE identidade.contas SET senha_hash = NULL
       WHERE id = ${id}::uuid AND status = 'ativa'`;
    return alteradas === 1;
  }

  override async gravarDesativacao(id: string, quando: Date): Promise<boolean> {
    if (!ehUuid(id)) return false;
    const alteradas = await this.unidade.cliente().$executeRaw`
      UPDATE identidade.contas SET status = 'desativada', desativada_em = ${quando}
       WHERE id = ${id}::uuid AND status = 'ativa'`;
    return alteradas === 1;
  }

  override async listarParaExpurgo(limite: Date, quantidade: number): Promise<string[]> {
    if (!Number.isInteger(quantidade) || quantidade <= 0) return [];
    const linhas = await this.unidade.cliente().$queryRaw<{ id: string }[]>`
      SELECT c.id::text AS id
        FROM identidade.contas c
       WHERE c.status = 'ativa'
         AND c.email_verificado_em IS NULL
         AND NOT EXISTS (SELECT 1 FROM identidade.perfis_conta p
                          WHERE p.conta_id = c.id AND p.perfil IN ('admin', 'lojista'))
         AND coalesce(c.ultimo_login_em, c.criada_em) < ${limite}
       ORDER BY coalesce(c.ultimo_login_em, c.criada_em), c.id
       LIMIT ${quantidade}::integer`;
    return linhas.map((linha) => linha.id);
  }

  override async apagar(id: string): Promise<void> {
    if (!ehUuid(id)) return;
    await this.unidade.cliente().conta.deleteMany({ where: { id } });
  }
}

function paraConta(linha: ContaPrisma & { perfis: PerfilDaContaPrisma[] }): Conta {
  return Conta.reconstituir({
    id: linha.id,
    nome: linha.nome,
    emailNormalizado: linha.emailNormalizado,
    telefoneE164: linha.telefoneE164,
    senhaHash: linha.senhaHash,
    emailVerificadoEm: linha.emailVerificadoEm,
    ultimoLoginEm: linha.ultimoLoginEm,
    status: linha.status,
    criadaEm: linha.criadaEm,
    desativadaEm: linha.desativadaEm,
    anonimizadaEm: linha.anonimizadaEm,
    perfis: linha.perfis.map((perfil) => ({
      perfil: perfil.perfil,
      concedidoEm: perfil.concedidoEm,
      concedidoPor: perfil.concedidoPor,
    })),
  });
}
