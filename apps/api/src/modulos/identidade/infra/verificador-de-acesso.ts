// Adaptador da porta `VerificadorDeAcesso` do núcleo (plano 01b, etapa 16; S7,
// S8): a guarda global pergunta aqui quem é o dono do token de acesso.
//
// 1. o JWT (HS256, `iss`/`aud` fixos, 15 min) pelo `EmissorDeJwt`;
// 2. a conta do `sub` em `ativa` (S8): desativada, anonimizada ou apagada perde
//    o acesso na hora, em qualquer rota;
// 3. com `conferirSessao` (rotas de `/v1/admin`, S8), a sessão do `sid`: da
//    mesma conta, não revogada (logout, redefinição, reuso) e não vencida.
// Os perfis devolvidos são os do token que a conta ainda tem: perfil retirado
// some já na próxima requisição, e `admin` continua só onde o token o trouxe
// (sessão do painel com segundo fator, S1).
//
// Leituras sem trava e fora de transação: só decidem se a requisição entra.
import { Injectable } from '@nestjs/common';
import {
  type ContaAutenticada,
  type OpcoesDaVerificacao,
  VerificadorDeAcesso,
} from '../../../compartilhado/autenticacao/verificador-de-acesso.ts';
import { Relogio } from '../../../compartilhado/tempo/relogio.ts';
import { EmissorDeJwt } from '../aplicacao/portas/emissor-de-jwt.ts';
import { RepositorioDeContas, RepositorioDeSessoes } from '../dominio/repositorios.ts';

@Injectable()
export class VerificadorDeAcessoDaIdentidade extends VerificadorDeAcesso {
  constructor(
    private readonly emissor: EmissorDeJwt,
    private readonly relogio: Relogio,
    private readonly contas: RepositorioDeContas,
    private readonly sessoes: RepositorioDeSessoes,
  ) {
    super();
  }

  override async verificar(
    token: string,
    { conferirSessao }: OpcoesDaVerificacao,
  ): Promise<ContaAutenticada | null> {
    const agora = this.relogio.agora();
    const reivindicacoes = await this.emissor.verificar(token, agora);
    if (reivindicacoes === null) return null;

    const conta = await this.contas.buscarPorId(reivindicacoes.contaId);
    if (conta?.status !== 'ativa') return null;

    if (conferirSessao) {
      const sessao = await this.sessoes.buscarPorId(reivindicacoes.sid);
      if (sessao === null || sessao.contaId !== conta.id || !sessao.estaAtiva(agora)) return null;
    }

    return {
      contaId: conta.id,
      sid: reivindicacoes.sid,
      perfis: reivindicacoes.perfis.filter((perfil) => conta.temPerfil(perfil)),
      mfa: reivindicacoes.mfa,
      emailVerificado: reivindicacoes.emailVerificado,
    };
  }
}
