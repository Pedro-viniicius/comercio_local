// Reconfiguração do segundo fator de um admin (plano 01b, etapa 10; S1, S97,
// S99): para quem perdeu o celular e os códigos de recuperação. Apaga o segundo
// fator, os códigos e a senha, invalida os desafios, revoga todas as sessões da
// conta e pede a recuperação de senha pelo e-mail. A conta define a senha nova
// pelo código do e-mail e, no próximo login no painel, configura o app
// autenticador de novo (CA-09).
//
//   node --env-file-if-exists=.env dist/cli/reconfigurar-segundo-fator.js \
//     --operador <id da sua conta admin> --conta <id da conta>
//   printf '%s\n' 'admin@exemplo.com' | node --env-file-if-exists=.env \
//     dist/cli/reconfigurar-segundo-fator.js --operador <id da sua conta admin>
//
// Sem `--conta`, o e-mail é lido da entrada padrão (digitado ou por pipe),
// nunca de um argumento, que ficaria no histórico do shell e na lista de
// processos. `--operador` é obrigatório: a conta admin de quem roda, gravada na
// auditoria como ator.
//
// Em produção, roda na máquina da API (`fly ssh console`), com o ambiente dela:
// usa o papel da aplicação (DATABASE_URL), como as rotas. Monta o mesmo
// `AppModule` da API, sem HTTP, e pega o caso de uso
// `ReconfigurarSegundoFatorCasoDeUso` da injeção de dependência (registrado
// pelo `IdentidadeModule`, etapa 16).
//
// A saída cita só o id da conta e contagens, nunca o e-mail. Erro sai com o
// nome e o código, nunca com a mensagem (a do driver do banco traz parâmetros
// da consulta).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.ts';
import {
  carregarAmbiente,
  ErroDeAmbiente,
  verificarAmbienteDeProducao,
} from '../compartilhado/config/ambiente.ts';
import {
  type ContaDaReconfiguracao,
  ReconfigurarSegundoFatorCasoDeUso,
  type ResultadoDeReconfigurarSegundoFator,
} from '../modulos/identidade/aplicacao/segundo-fator/reconfigurar-segundo-fator.caso-de-uso.ts';
import { lerArgumentos, lerEmailDaEntrada } from './entrada-da-reconfiguracao.ts';

const USO =
  'Uso: node dist/cli/reconfigurar-segundo-fator.js --operador <id da sua conta admin> ' +
  '[--conta <id da conta>]\n' +
  'Sem --conta, o e-mail da conta é lido da entrada padrão (nunca de um argumento).';

/** Texto para quem roda a CLI e o código de saída de cada resultado. */
function relatar(resultado: ResultadoDeReconfigurarSegundoFator): { texto: string; ok: boolean } {
  switch (resultado.tipo) {
    case 'email_invalido':
      return { texto: 'E-mail inválido: nada foi alterado.', ok: false };
    case 'operador_invalido':
      return {
        texto: 'O operador não é uma conta admin ativa: nada foi alterado.',
        ok: false,
      };
    case 'conta_nao_encontrada':
      return { texto: 'Conta não encontrada: nada foi alterado.', ok: false };
    case 'nao_e_admin':
      return { texto: 'A conta não tem o perfil admin: nada foi alterado.', ok: false };
    case 'conta_inativa':
      return { texto: 'A conta não está ativa: nada foi alterado.', ok: false };
    case 'reconfigurado':
      return {
        texto:
          `Segundo fator e senha da conta ${resultado.contaId} apagados; ` +
          `${resultado.sessoesRevogadas} sessões revogadas. O código para definir a senha nova ` +
          'vai para o e-mail da conta; depois, no login no painel, ela configura o app ' +
          'autenticador de novo.',
        ok: true,
      };
  }
}

/**
 * Nome (ou classe) e código do erro, sem a mensagem. A do `ErroDeAmbiente` cita
 * só nomes de variáveis. O Nest lança `UnknownElementException` com `name`
 * `Error` quando o caso de uso não está registrado: daí a classe.
 */
function descreverErro(erro: unknown): string {
  if (erro instanceof ErroDeAmbiente) return erro.message;
  const nome =
    erro instanceof Error
      ? erro.name === 'Error'
        ? erro.constructor.name
        : erro.name
      : 'desconhecido';
  const codigo = (erro as { code?: unknown } | null)?.code;
  return typeof codigo === 'string' ? `${nome}, código ${codigo}` : nome;
}

async function executar(alvo: ContaDaReconfiguracao, operadorId: string): Promise<boolean> {
  const ambiente = carregarAmbiente(process.env);
  verificarAmbienteDeProducao(ambiente, process.env);
  const app = await NestFactory.createApplicationContext(AppModule.registrar({ ambiente }), {
    logger: false,
    abortOnError: false,
  });
  try {
    const resultado = await app
      .get(ReconfigurarSegundoFatorCasoDeUso)
      .executar({ conta: alvo, operadorId });
    const { texto, ok } = relatar(resultado);
    if (ok) console.log(texto);
    else console.error(texto);
    return ok;
  } finally {
    await app.close();
  }
}

/** A conta pedida: pelo id, ou pelo e-mail da entrada padrão; `null` se não veio nada. */
async function lerConta(contaId: string | null): Promise<ContaDaReconfiguracao | null> {
  if (contaId !== null) return { contaId };
  if (process.stdin.isTTY) process.stderr.write('E-mail da conta admin: ');
  const email = await lerEmailDaEntrada(process.stdin);
  return email === null ? null : { email };
}

const argumentos = lerArgumentos(process.argv.slice(2));
const conta = argumentos === null ? null : await lerConta(argumentos.contaId);
if (argumentos === null || conta === null) {
  console.error(USO);
  process.exitCode = 1;
} else {
  try {
    if (!(await executar(conta, argumentos.operadorId))) process.exitCode = 1;
  } catch (erro) {
    console.error(`Falha na reconfiguração (${descreverErro(erro)}).`);
    process.exitCode = 1;
  }
}
