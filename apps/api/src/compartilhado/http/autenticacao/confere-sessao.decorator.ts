// `@ConfereSessao()`: a rota confere também a sessão do `sid` a cada
// requisição, como as de `/v1/admin` (S8; plano 01b, etapa 19, vindo do grupo
// D). Fora de `/v1/admin`, a guarda global `Autenticado` confere só
// `contas.status`, e o token de acesso (15 min) de uma sessão encerrada por
// logout, redefinição de senha ou reconfiguração do segundo fator continua
// valendo até vencer. As rotas que entregam ou movem dado pessoal sem pedir a
// senha (cópia dos dados, dados da conta) usam este decorador: com a sessão
// revogada ou vencida, 401 da própria guarda.
import { SetMetadata } from '@nestjs/common';

/** Chave dos metadados: a rota confere a sessão do `sid` (lida pela guarda e pelo teste das rotas). */
export const CONFERE_SESSAO = 'bairrin:confere-sessao';

export const ConfereSessao = (): MethodDecorator & ClassDecorator =>
  SetMetadata(CONFERE_SESSAO, true);
