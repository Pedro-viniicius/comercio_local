// Cria a conta admin (CA-07; plano 01b, etapa 13): o único caminho que concede
// o perfil `admin` (nenhuma rota concede). A conta nasce sem senha, com os
// perfis `consumidor` e `admin`, e o código para definir a senha vai para o
// e-mail dela (`RecuperacaoSolicitada`). Quem lê o e-mail define a senha e, no
// primeiro login no painel, configura o app autenticador (CA-09).
//
//   pnpm --filter api seed:admin                         # o primeiro admin
//   pnpm --filter api seed:admin --operador <id da sua conta admin>
//
// Os dados vêm da entrada padrão, uma linha cada, nunca de argumentos (S99,
// S108): o e-mail, o e-mail de novo (os dois precisam ser iguais, S106), o
// nome e o celular com DDD. No terminal, cada um é perguntado; por pipe:
//
//   printf '%s\n' 'admin@exemplo.com' 'admin@exemplo.com' 'Nome do admin' \
//     '(35) 99999-1234' | node --env-file-if-exists=.env dist/cli/seed-admin.js
//
// Depois do primeiro admin, `--operador` é obrigatório (S106): a conta admin
// ativa de quem roda, gravada na auditoria como ator. O telefone e a
// confirmação do e-mail são conferidos antes de qualquer conexão: erro encerra
// sem criar nada. Em produção, roda na máquina da API (`fly ssh console`), com
// o ambiente dela (papel da aplicação, DATABASE_URL), e monta o mesmo
// `AppModule` da API, sem HTTP, para pegar `CriarAdminCasoDeUso` da injeção de
// dependência (registrado pelo `IdentidadeModule`, etapa 16).
//
// O Nest só é carregado depois da conferência da entrada (import dinâmico): o
// erro de uso, de telefone ou de e-mail sai rápido e sem conexão.
//
// A saída cita só o id da conta, nunca o nome, o e-mail ou o telefone. Erro
// sai com o nome e o código, nunca com a mensagem (a do driver do banco traz
// parâmetros da consulta).
import type { ResultadoDeCriarAdmin } from '../modulos/identidade/aplicacao/cadastro/criar-admin.caso-de-uso.ts';
import {
  type DadosDoSeedAdmin,
  lerArgumentosDoSeedAdmin,
  lerDadosDoSeedAdmin,
} from './entrada-do-seed-admin.ts';

const USO =
  'Uso: node dist/cli/seed-admin.js [--operador <id da sua conta admin>]\n' +
  'Da entrada padrão, uma linha cada: o e-mail, o e-mail de novo, o nome e o celular com DDD.\n' +
  'Depois do primeiro admin, --operador é obrigatório.';

/** Texto para quem roda a CLI e o código de saída de cada resultado. */
function relatar(resultado: ResultadoDeCriarAdmin): { texto: string; ok: boolean } {
  switch (resultado.tipo) {
    case 'nome_invalido':
      return { texto: 'Nome inválido: nada foi criado.', ok: false };
    case 'email_invalido':
      return { texto: 'E-mail inválido: nada foi criado.', ok: false };
    case 'telefone_invalido':
      return { texto: 'Telefone inválido: nada foi criado.', ok: false };
    case 'email_ja_cadastrado':
      return { texto: 'Já existe conta com este e-mail: nada foi criado.', ok: false };
    case 'operador_obrigatorio':
      return {
        texto: 'Já existe admin: informe --operador com o id da sua conta admin. Nada foi criado.',
        ok: false,
      };
    case 'operador_invalido':
      return {
        texto: 'O operador não é uma conta admin ativa: nada foi criado.',
        ok: false,
      };
    case 'criado':
      return {
        texto:
          `Conta admin ${resultado.contaId} criada, sem senha. O código para definir a senha ` +
          'vai para o e-mail da conta; depois, no login no painel, ela configura o app ' +
          'autenticador.',
        ok: true,
      };
  }
}

/**
 * Nome (ou classe) e código do erro, sem a mensagem. O Nest lança
 * `UnknownElementException` com `name` `Error` quando o caso de uso não está
 * registrado: daí a classe.
 */
function descreverErro(erro: unknown): string {
  const nome =
    erro instanceof Error
      ? erro.name === 'Error'
        ? erro.constructor.name
        : erro.name
      : 'desconhecido';
  const codigo = (erro as { code?: unknown } | null)?.code;
  return typeof codigo === 'string' ? `${nome}, código ${codigo}` : nome;
}

/** Texto do erro de cada entrada recusada antes da conexão; `null` se a entrada serve. */
function erroDaEntrada(dados: DadosDoSeedAdmin): string | null {
  switch (dados.tipo) {
    case 'entrada_incompleta':
      return USO;
    case 'emails_diferentes':
      return 'Os dois e-mails não são iguais: nada foi criado.';
    case 'telefone_invalido':
      return 'Telefone inválido: nada foi criado.';
    case 'dados':
      return null;
  }
}

async function executar(
  dados: { readonly nome: string; readonly email: string; readonly telefone: string },
  operadorId: string | null,
): Promise<boolean> {
  await import('reflect-metadata');
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../app.module.ts');
  const { carregarAmbiente, ErroDeAmbiente, verificarAmbienteDeProducao } =
    await import('../compartilhado/config/ambiente.ts');
  const { CriarAdminCasoDeUso } =
    await import('../modulos/identidade/aplicacao/cadastro/criar-admin.caso-de-uso.ts');
  try {
    const ambiente = carregarAmbiente(process.env);
    verificarAmbienteDeProducao(ambiente, process.env);
    const app = await NestFactory.createApplicationContext(AppModule.registrar({ ambiente }), {
      logger: false,
      abortOnError: false,
    });
    try {
      const resultado = await app.get(CriarAdminCasoDeUso).executar({ ...dados, operadorId });
      const { texto, ok } = relatar(resultado);
      if (ok) console.log(texto);
      else console.error(texto);
      return ok;
    } finally {
      await app.close();
    }
  } catch (erro) {
    // A mensagem do `ErroDeAmbiente` cita só nomes de variáveis.
    const descricao = erro instanceof ErroDeAmbiente ? erro.message : descreverErro(erro);
    console.error(`Falha ao criar a conta admin (${descricao}).`);
    return false;
  }
}

const argumentos = lerArgumentosDoSeedAdmin(process.argv.slice(2));
if (argumentos.tipo === 'uso') {
  console.error(USO);
  process.exitCode = 1;
} else {
  const perguntar = process.stdin.isTTY
    ? (texto: string) => process.stderr.write(texto)
    : undefined;
  const dados = await lerDadosDoSeedAdmin(process.stdin, perguntar);
  const erro = erroDaEntrada(dados);
  if (erro !== null || dados.tipo !== 'dados') {
    console.error(erro ?? USO);
    process.exitCode = 1;
  } else if (!(await executar(dados, argumentos.operadorId))) {
    process.exitCode = 1;
  }
}
