// Montagem dos e-mails da Identidade (S73): cada modelo descreve o conteúdo
// uma vez, em blocos de trechos, e daqui saem o texto puro e o HTML. Todo
// trecho entra no HTML por `escaparHtml`, inclusive os fixos: não há caminho
// para um valor interpolado chegar ao HTML sem escape. No texto puro, os
// trechos saem como estão. O assunto é fixo em cada modelo e não leva o nome.
import type { ConteudoDoEmail } from '../../../aplicacao/assinantes/modelos-de-email.ts';
import { escaparHtml } from './escapar-html.ts';

/** Texto comum, ou em destaque (`<strong>` no HTML), como o código. */
export type Trecho = string | { readonly destaque: string };

/** Um parágrafo. */
export type Bloco = readonly Trecho[];

export interface Documento {
  readonly assunto: string;
  readonly blocos: readonly Bloco[];
}

const ASSINATURA = 'Equipe Bairrin';

function textoDoTrecho(trecho: Trecho): string {
  return typeof trecho === 'string' ? trecho : trecho.destaque;
}

function htmlDoTrecho(trecho: Trecho): string {
  return typeof trecho === 'string'
    ? escaparHtml(trecho)
    : `<strong style="font-size:20px;letter-spacing:2px">${escaparHtml(trecho.destaque)}</strong>`;
}

/** O texto puro e o HTML do documento, com a assinatura no fim. */
export function montarEmail(documento: Documento): ConteudoDoEmail {
  const blocos = [...documento.blocos, [ASSINATURA]];
  const texto = blocos.map((bloco) => bloco.map(textoDoTrecho).join('')).join('\n\n');
  const paragrafos = blocos
    .map((bloco) => `<p style="margin:0 0 16px">${bloco.map(htmlDoTrecho).join('')}</p>`)
    .join('\n');
  const html = [
    '<!doctype html>',
    '<html lang="pt-BR">',
    '<head><meta charset="utf-8"><title>',
    escaparHtml(documento.assunto),
    '</title></head>',
    '<body style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1f2933">',
    paragrafos,
    '</body>',
    '</html>',
  ].join('\n');
  return { assunto: documento.assunto, texto: `${texto}\n`, html };
}
