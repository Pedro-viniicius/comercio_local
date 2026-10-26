// Autorização nos testes (plano 01b, etapa 19; CA-08, S7). Não é um teste.
//
// - `rotasDaAplicacao(app)`: o inventário das rotas dos controllers, com `@Publico()`,
//   `@Perfis`, `@ExigeMfa` e `@ConfereSessao` de cada uma, para os testes que percorrem
//   todas as rotas (nenhuma fica de fora porque alguém esqueceu de pô-la numa lista).
// - `conferirIsolamento(caso, dona, outra)`: isolamento entre contas, por recurso.
//
// Cada recurso da API que pertence a uma conta ganha um `CasoDeIsolamento`: a conta dona
// prepara o recurso, a outra conta tenta lê-lo ou mudá-lo pela rota, e o caso diz o que a
// outra pode receber (recusa, ou só os próprios dados) e confere que o recurso da dona
// ficou como estava. `conferirIsolamento` roda o caso e também procura, na resposta da
// outra conta, os valores pessoais da dona. O plano 02 reusa este helper para o
// isolamento entre lojas.
import { type INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { expect } from 'vitest';
import { CONFERE_SESSAO } from '../../src/compartilhado/http/autenticacao/confere-sessao.decorator.ts';
import { EXIGE_MFA } from '../../src/compartilhado/http/autenticacao/exige-mfa.guard.ts';
import { PERFIS_DA_ROTA } from '../../src/compartilhado/http/autenticacao/perfis.guard.ts';
import { ROTA_PUBLICA } from '../../src/compartilhado/http/autenticacao/publico.decorator.ts';
import { sensiveisEncontrados, type ValorSensivel } from './captura-de-log.ts';

// ---------------------------------------------------------------------------
// Inventário das rotas dos controllers (S7)

/** Uma rota de controller do Nest, com os metadados de autorização dela. */
export interface RotaDaAplicacao {
  /** `GET`, `POST`... */
  readonly metodo: string;
  /** Caminho declarado, com `/` no início (ex.: `/v1/privacidade/exportacao`). */
  readonly caminho: string;
  /** `METODO /caminho`, para mensagens e listas escritas à mão. */
  readonly nome: string;
  readonly controller: string;
  readonly publica: boolean;
  /** `@ExigeMfa()` no método ou no controller. */
  readonly exigeMfa: boolean;
  /** `@Perfis(...)` do método ou do controller (vazio sem o decorador). */
  readonly perfis: readonly string[];
  /** `@ConfereSessao()` no método ou no controller. */
  readonly confereSessao: boolean;
}

function juntarCaminho(...partes: unknown[]): string {
  const textos = partes.flatMap((parte) => {
    if (typeof parte === 'string') return [parte];
    if (Array.isArray(parte))
      return parte.filter((item): item is string => typeof item === 'string');
    return [''];
  });
  const trechos = textos
    .join('/')
    .split('/')
    .filter((trecho) => trecho.length > 0);
  return `/${trechos.join('/')}`;
}

/**
 * Todas as rotas dos controllers registrados na aplicação, menos as das classes em
 * `ignorar` (sondas do próprio teste).
 */
export function rotasDaAplicacao(
  app: INestApplication,
  ignorar: readonly unknown[] = [],
): RotaDaAplicacao[] {
  const modulos = app.get(ModulesContainer, { strict: false });
  const reflector = new Reflector();
  const rotas: RotaDaAplicacao[] = [];
  for (const modulo of modulos.values()) {
    for (const wrapper of modulo.controllers.values()) {
      const classe = wrapper.metatype;
      if (typeof classe !== 'function' || ignorar.includes(classe)) continue;
      const base: unknown = Reflect.getMetadata(PATH_METADATA, classe);
      for (const nome of Object.getOwnPropertyNames(classe.prototype)) {
        const handler: unknown = (classe.prototype as Record<string, unknown>)[nome];
        if (typeof handler !== 'function') continue;
        const codigoDoMetodo: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
        if (typeof codigoDoMetodo !== 'number') continue;
        const alvos = [handler, classe];
        const metodo = RequestMethod[codigoDoMetodo] ?? String(codigoDoMetodo);
        const caminho = juntarCaminho(base, Reflect.getMetadata(PATH_METADATA, handler));
        rotas.push({
          metodo,
          caminho,
          nome: `${metodo} ${caminho}`,
          controller: classe.name,
          publica: reflector.getAllAndOverride<boolean | undefined>(ROTA_PUBLICA, alvos) === true,
          exigeMfa: reflector.getAllAndOverride<boolean | undefined>(EXIGE_MFA, alvos) === true,
          perfis:
            reflector.getAllAndOverride<readonly string[] | undefined>(PERFIS_DA_ROTA, alvos) ?? [],
          confereSessao:
            reflector.getAllAndOverride<boolean | undefined>(CONFERE_SESSAO, alvos) === true,
        });
      }
    }
  }
  return rotas.sort((a, b) => a.nome.localeCompare(b.nome));
}

/** A rota fica sob `/v1/admin` (S7), sem diferenciar maiúsculas. */
export function ehDeAdmin(rota: Pick<RotaDaAplicacao, 'caminho'>): boolean {
  return /^\/v1\/admin(\/|$)/i.test(rota.caminho);
}

// ---------------------------------------------------------------------------
// Isolamento entre contas (S7, CA-08)

/** Quem faz a requisição no caso: o token de acesso e os valores pessoais dele. */
export interface Ator {
  /** Rótulo para as mensagens (ex.: `dona`, `outra`). */
  readonly rotulo: string;
  readonly tokenAcesso: string;
  /** Nome, e-mail, telefone...: não podem aparecer na resposta dada a outra conta. */
  readonly valoresPessoais: readonly ValorSensivel[];
}

/** O que o caso lê da resposta HTTP (a do supertest serve). */
export interface RespostaDoCaso {
  readonly status: number;
  readonly body: unknown;
  readonly text?: string;
}

export interface CasoDeIsolamento<Recurso> {
  /** Ex.: `GET /v1/privacidade/exportacao/arquivo`. */
  readonly nome: string;
  /** Deixa pronto o recurso da dona e devolve o que o caso precisa para conferir depois. */
  preparar(dona: Ator): Promise<Recurso>;
  /** A outra conta tenta, com o próprio token, alcançar o recurso da dona. */
  tentarComoOutra(outra: Ator, recurso: Recurso): Promise<RespostaDoCaso>;
  /**
   * Status aceitos na tentativa: a recusa (403, 404, 400...) ou, nas rotas que devolvem
   * "o meu" recurso, o 2xx com os dados da própria outra conta.
   */
  readonly statusAceitos: readonly number[];
  /** Confere, depois da tentativa, que o recurso da dona continua como estava. */
  conferirIntacto(dona: Ator, recurso: Recurso): Promise<void>;
}

/**
 * Roda o caso: prepara o recurso da dona, a outra conta tenta, a resposta tem um dos status
 * aceitos e nenhum valor pessoal da dona, e o recurso da dona fica intacto.
 */
export async function conferirIsolamento<Recurso>(
  caso: CasoDeIsolamento<Recurso>,
  dona: Ator,
  outra: Ator,
): Promise<void> {
  const recurso = await caso.preparar(dona);
  const resposta = await caso.tentarComoOutra(outra, recurso);
  expect(caso.statusAceitos, `${caso.nome}: status da tentativa da outra conta`).toContain(
    resposta.status,
  );
  const texto = `${JSON.stringify(resposta.body ?? null)}\n${resposta.text ?? ''}`;
  expect(
    sensiveisEncontrados({ [`resposta de ${caso.nome}`]: texto }, dona.valoresPessoais),
    `${caso.nome}: dado da ${dona.rotulo} na resposta à ${outra.rotulo}`,
  ).toEqual([]);
  await caso.conferirIntacto(dona, recurso);
}
