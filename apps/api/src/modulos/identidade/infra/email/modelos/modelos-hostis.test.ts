// Modelos de e-mail da Identidade com nomes hostis (plano 01b, etapa 13; S73, CA-06): um
// valor interpolado nunca abre tag, atributo ou entidade no HTML (o nome hostil não muda a
// contagem de `<`, `>`, `"` e `'` em relação ao mesmo e-mail com um nome comum, e todo `&`
// do nome vira entidade), e o prazo dito no e-mail é o prazo que o código tem de verdade.
import { describe, expect, it } from 'vitest';
import type { ConteudoDoEmail } from '../../../aplicacao/assinantes/modelos-de-email.ts';
import { VALIDADE_DO_CODIGO_EM_MS } from '../../../dominio/codigo-de-verificacao.ts';
import { ModelosDeEmailDaIdentidadeEmHtml } from './modelos-de-email-da-identidade.ts';

const modelos = new ModelosDeEmailDaIdentidadeEmHtml();

/** Os modelos que levam o nome (o de verificação nunca leva, S102). */
function todos(nome: string): [string, ConteudoDoEmail][] {
  return [
    ['cadastroRepetido', modelos.cadastroRepetido({ nome })],
    ['codigoDeRecuperacao', modelos.codigoDeRecuperacao({ nome, codigo: '730215' })],
    [
      'exportacaoPronta',
      modelos.exportacaoPronta({ nome, disponivelAte: new Date('2026-10-28T14:00:00.000Z') }),
    ],
    ['segundoFatorFreado', modelos.segundoFatorFreado({ nome, senhaRemovida: false })],
    ['senhaRemovida', modelos.segundoFatorFreado({ nome, senhaRemovida: true })],
  ];
}

const contar = (texto: string, caractere: string) => texto.split(caractere).length - 1;

const NOMES_HOSTIS = [
  '"><script>alert(1)</script>',
  "' onmouseover='alert(1)",
  '<img src=x onerror=alert(1)>',
  '&lt;b&gt;Ana&lt;/b&gt;',
  '&#60;script&#62;',
  'javascript:alert(1)//',
  '<style>body{display:none}</style>',
  'A&'.repeat(40),
];

describe('modelos da Identidade com nome hostil (S73)', () => {
  it.each(NOMES_HOSTIS)('o nome %s não cria tag, aspa nem entidade nova no HTML', (hostil) => {
    const comuns = new Map(todos('Ana Souza'));
    for (const [modelo, email] of todos(hostil)) {
      const base = comuns.get(modelo)?.html ?? '';
      for (const caractere of ['<', '>', '"', "'"]) {
        expect(contar(email.html, caractere), `${modelo}: ${caractere}`).toBe(
          contar(base, caractere),
        );
      }
      // Todo `&` do HTML abre uma das cinco entidades.
      expect(email.html.match(/&(?!amp;|lt;|gt;|quot;|#39;)/g), modelo).toBeNull();
      // O texto puro leva o nome como foi dado.
      expect(email.texto, modelo).toContain(hostil);
    }
  });

  it('o código e o texto fixo também passam pelo escape: nada do HTML sai sem entidade', () => {
    const { html } = modelos.codigoDeVerificacao({ codigo: '<b>1' });

    expect(html).toContain('&lt;b&gt;1</strong>');
  });
});

describe('prazo do código dito no e-mail (CA-06)', () => {
  it('os e-mails com código dizem os mesmos minutos que o código vale', () => {
    const minutos = VALIDADE_DO_CODIGO_EM_MS / 60_000;
    const verificacao = modelos.codigoDeVerificacao({ codigo: '482913' });
    const recuperacao = modelos.codigoDeRecuperacao({ nome: 'Ana', codigo: '730215' });

    for (const email of [verificacao, recuperacao]) {
      expect(email.texto).toContain(`vale por ${minutos} minutos`);
      expect(email.html).toContain(`vale por ${minutos} minutos`);
    }
  });
});
