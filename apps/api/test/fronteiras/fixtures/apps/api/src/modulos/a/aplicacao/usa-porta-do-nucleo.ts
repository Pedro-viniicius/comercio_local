// Controle: aplicação importa as portas puras do núcleo, inclusive a que fica
// na mesma pasta de um adaptador.
import { EnviadorDeEmail } from '../../../compartilhado/email/enviador-de-email.ts';
import { UnidadeDeTrabalho } from '../../../compartilhado/transacao/unidade-de-trabalho.ts';

export const portas = { EnviadorDeEmail, UnidadeDeTrabalho };
