// Adaptador Prisma de `RepositorioDeBloqueios` (`identidade.bloqueios_login`;
// CA-04, S1, S14; plano 01b, etapa 7). A chave é sempre o HMAC (do e-mail, da
// origem ou da conta), nunca o valor.
//
// `buscarParaAtualizar` (R1, A-R1/S96): um comando só, `INSERT ... ON
// CONFLICT (chave_hmac, tipo) DO UPDATE SET chave_hmac = EXCLUDED.chave_hmac
// RETURNING`, com o freio zerado no VALUES. O `DO UPDATE` (que não muda valor
// nenhum) trava a linha existente; sem linha, o INSERT cria e trava a nova. Duas
// falhas simultâneas na mesma chave viram duas: a segunda espera a primeira e
// lê o que ela gravou. E sempre volta uma linha: se a primeira apagou o freio
// zerado (`salvar`) enquanto a segunda esperava, o Postgres refaz a checagem do
// conflito e insere. O par antigo (`INSERT ... DO NOTHING` e depois `SELECT ...
// FOR UPDATE`) achava zero linhas nesse caso, e o caso de uso caía em 500.
import { Injectable } from '@nestjs/common';
import type { BloqueioDeLogin as BloqueioDeLoginPrisma } from '../../../../compartilhado/infra/gerado/prisma/client.ts';
import { UnidadeDeTrabalhoPrisma } from '../../../../compartilhado/infra/unidade-de-trabalho-prisma.ts';
import { BloqueioDeLogin, type TipoDeBloqueio } from '../../dominio/bloqueio-de-login.ts';
import { RepositorioDeBloqueios } from '../../dominio/repositorios.ts';
import { exigirTransacao } from './comum.ts';

@Injectable()
export class RepositorioDeBloqueiosPrisma extends RepositorioDeBloqueios {
  constructor(private readonly unidade: UnidadeDeTrabalhoPrisma) {
    super();
  }

  override async buscar(chaveHmac: string, tipo: TipoDeBloqueio): Promise<BloqueioDeLogin | null> {
    const linha = await this.unidade.cliente().bloqueioDeLogin.findUnique({
      where: { chaveHmac_tipo: { chaveHmac, tipo } },
    });
    return linha === null ? null : paraBloqueio(linha);
  }

  override async buscarParaAtualizar(
    chaveHmac: string,
    tipo: TipoDeBloqueio,
    agora: Date,
  ): Promise<BloqueioDeLogin> {
    const transacao = exigirTransacao(this.unidade, 'buscarParaAtualizar');
    const zerado = BloqueioDeLogin.novo(chaveHmac, tipo, agora).dados;
    const linhas = await transacao.$queryRaw<LinhaDoFreio[]>`
      INSERT INTO identidade.bloqueios_login AS b
        (chave_hmac, tipo, falhas, nivel, janela_inicio, bloqueado_ate)
      VALUES
        (${zerado.chaveHmac}, ${zerado.tipo}::identidade.tipo_de_bloqueio, ${zerado.falhas},
         ${zerado.nivel}, ${zerado.janelaInicio}, NULL)
      ON CONFLICT (chave_hmac, tipo) DO UPDATE SET chave_hmac = EXCLUDED.chave_hmac
      RETURNING b.chave_hmac, b.tipo::text AS tipo, b.falhas, b.nivel, b.janela_inicio,
                b.bloqueado_ate`;
    const [linha] = linhas;
    // O comando sempre devolve a linha; sem ela, é defeito, nunca "sem freio".
    if (linha === undefined || linhas.length !== 1) {
      throw new Error('O freio travado não voltou do banco.');
    }
    return BloqueioDeLogin.reconstituir({
      chaveHmac: linha.chave_hmac,
      tipo: linha.tipo,
      falhas: linha.falhas,
      nivel: linha.nivel,
      janelaInicio: linha.janela_inicio,
      bloqueadoAte: linha.bloqueado_ate,
    });
  }

  override async salvar(bloqueio: BloqueioDeLogin): Promise<void> {
    const dados = bloqueio.dados;
    const chave = { chaveHmac: dados.chaveHmac, tipo: dados.tipo };
    if (bloqueio.estaZerado) {
      await this.unidade.cliente().bloqueioDeLogin.deleteMany({ where: chave });
      return;
    }
    await this.unidade.cliente().bloqueioDeLogin.upsert({
      where: { chaveHmac_tipo: chave },
      create: dados,
      update: {
        falhas: dados.falhas,
        nivel: dados.nivel,
        janelaInicio: dados.janelaInicio,
        bloqueadoAte: dados.bloqueadoAte,
      },
      select: { chaveHmac: true },
    });
  }

  override apagarParadosAntes(limite: Date): Promise<number> {
    // `greatest` ignora o `bloqueado_ate` nulo (S81, revisão do grupo B).
    return this.unidade.cliente().$executeRaw`
      DELETE FROM identidade.bloqueios_login
       WHERE greatest(bloqueado_ate, janela_inicio) < ${limite}`;
  }
}

/** Linha devolvida pelo `RETURNING` de `buscarParaAtualizar`, com os nomes das colunas. */
interface LinhaDoFreio {
  chave_hmac: string;
  tipo: TipoDeBloqueio;
  falhas: number;
  nivel: number;
  janela_inicio: Date;
  bloqueado_ate: Date | null;
}

function paraBloqueio(linha: BloqueioDeLoginPrisma): BloqueioDeLogin {
  return BloqueioDeLogin.reconstituir({
    chaveHmac: linha.chaveHmac,
    tipo: linha.tipo,
    falhas: linha.falhas,
    nivel: linha.nivel,
    janelaInicio: linha.janelaInicio,
    bloqueadoAte: linha.bloqueadoAte,
  });
}
