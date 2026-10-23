// Modelos de e-mail da Identidade (plano 01b, etapa 13; S10, S73, S102): o
// nome e todo valor interpolado saem escapados no HTML e iguais no texto puro;
// sem nome (e-mail não verificado), a saudação é "Olá!" e o de verificação
// nunca leva nome; o assunto é fixo e não leva o nome; nenhum modelo traz
// anexo, link ou dado de terceiros.
import { describe, expect, it } from 'vitest';
import type { ConteudoDoEmail } from '../../../aplicacao/assinantes/modelos-de-email.ts';
import { montarEmail } from './documento.ts';
import { escaparHtml } from './escapar-html.ts';
import { ASSUNTOS, ModelosDeEmailDaIdentidadeEmHtml } from './modelos-de-email-da-identidade.ts';

const modelos = new ModelosDeEmailDaIdentidadeEmHtml();
const NOME_COM_TAG = '<img src=x onerror=alert(1)>';
const NOME_COM_E_COMERCIAL = 'Zé & Cia';
const NOME_COM_ASPAS = `Ana "Aninha" D'Ávila`;

/** Os modelos que levam o nome, montados para o nome dado (`null`: sem nome, S102). */
function comNome(nome: string | null): [string, ConteudoDoEmail][] {
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

/** Todos os modelos: os que levam o nome e o de verificação, que nunca leva. */
function todos(nome: string): [string, ConteudoDoEmail][] {
  return [
    ['codigoDeVerificacao', modelos.codigoDeVerificacao({ codigo: '482913' })],
    ...comNome(nome),
  ];
}

describe('escaparHtml (S73)', () => {
  it('troca & < > " e \' pelas entidades', () => {
    expect(escaparHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('não escapa duas vezes de forma diferente e mantém o resto (acentos, emoji)', () => {
    expect(escaparHtml('Zé & Cia 😀')).toBe('Zé &amp; Cia 😀');
    expect(escaparHtml('&amp;')).toBe('&amp;amp;');
    expect(escaparHtml('')).toBe('');
  });
});

describe('montarEmail', () => {
  it('escapa no HTML até os trechos fixos e o destaque; o texto puro sai como está', () => {
    const email = montarEmail({
      assunto: 'A & B',
      blocos: [['<b>', { destaque: '"x"' }]],
    });
    expect(email.html).toContain('<title>\nA &amp; B\n</title>');
    expect(email.html).toContain('&lt;b&gt;<strong');
    expect(email.html).toContain('&quot;x&quot;</strong>');
    expect(email.texto).toBe('<b>"x"\n\nEquipe Bairrin\n');
  });
});

describe('modelos da Identidade (S73)', () => {
  it.each([NOME_COM_TAG, NOME_COM_E_COMERCIAL, NOME_COM_ASPAS])(
    'o nome %s sai escapado no HTML e igual no texto puro, em todo modelo',
    (nome) => {
      for (const [modelo, email] of comNome(nome)) {
        expect(email.html, modelo).toContain(escaparHtml(nome));
        expect(email.html, modelo).not.toContain(nome);
        expect(email.texto, modelo).toContain(nome);
      }
    },
  );

  it('nenhuma tag vinda do nome sobrevive no HTML (o "onerror" fica só como texto)', () => {
    for (const [modelo, email] of comNome(NOME_COM_TAG)) {
      expect(email.html, modelo).not.toMatch(/<img/i);
      expect(email.html, modelo).toContain('&lt;img src=x onerror=alert(1)&gt;');
    }
  });

  it('o assunto é fixo por modelo e nunca leva o nome', () => {
    for (const [modelo, email] of todos(NOME_COM_E_COMERCIAL)) {
      expect(email.assunto, modelo).toBe(ASSUNTOS[modelo as keyof typeof ASSUNTOS]);
      expect(email.assunto, modelo).not.toContain('Zé');
      expect(email.assunto, modelo).not.toMatch(/[\r\n]/);
    }
  });

  it('o código aparece só no e-mail que o leva, em destaque', () => {
    const verificacao = modelos.codigoDeVerificacao({ codigo: '482913' });
    expect(verificacao.texto).toContain('482913');
    expect(verificacao.html).toMatch(/<strong[^>]*>482913<\/strong>/);
    const recuperacao = modelos.codigoDeRecuperacao({ nome: 'Ana', codigo: '730215' });
    expect(recuperacao.texto).toContain('730215');
    expect(recuperacao.texto).not.toContain('482913');
  });

  it('nenhum modelo leva link, endereço de e-mail ou anexo (S10)', () => {
    for (const [modelo, email] of todos('Ana')) {
      for (const parte of [email.texto, email.html]) {
        expect(parte, modelo).not.toMatch(/https?:|href=|src=|@/i);
      }
    }
  });

  it('a exportação pronta só avisa: data e hora no fuso de Brasília e o caminho no app, sem conteúdo (Q28)', () => {
    const email = modelos.exportacaoPronta({
      nome: 'Ana',
      // 02:05 UTC do dia 28 ainda é dia 27, 23:05, em Brasília.
      disponivelAte: new Date('2026-10-28T02:05:00.000Z'),
    });
    expect(email.texto).toContain('até 27/10/2026 às 23:05 (horário de Brasília).');
    expect(email.html).toContain('até 27/10/2026 às 23:05 (horário de Brasília).');
    expect(email.texto).toContain('Privacidade');
    // Hora com dois dígitos, em 24 h.
    const manha = modelos.exportacaoPronta({
      nome: 'Ana',
      disponivelAte: new Date('2026-10-28T11:00:00.000Z'),
    });
    expect(manha.texto).toContain('até 28/10/2026 às 08:00 (horário de Brasília).');
  });

  it('sem nome (e-mail não verificado, S102), todo modelo saúda com "Olá!" e nada mais', () => {
    for (const [modelo, email] of comNome(null)) {
      expect(email.texto.startsWith('Olá!\n\n'), modelo).toBe(true);
      expect(email.html, modelo).toContain('<p style="margin:0 0 16px">Olá!</p>');
      expect(email.texto, modelo).not.toContain('Olá, ');
    }
  });

  it('o e-mail de verificação nunca leva nome: saúda com "Olá!" (S102)', () => {
    const email = modelos.codigoDeVerificacao({ codigo: '482913' });
    expect(email.texto.startsWith('Olá!\n\n')).toBe(true);
    expect(email.texto).not.toContain('Olá, ');
  });

  it('o aviso do freio muda quando a senha foi apagada: manda recuperar a senha (P16)', () => {
    const espera = modelos.segundoFatorFreado({ nome: 'Ana', senhaRemovida: false });
    const removida = modelos.segundoFatorFreado({ nome: 'Ana', senhaRemovida: true });
    expect(espera.texto).toContain('bloqueadas por alguns minutos');
    expect(espera.texto).not.toContain('apagamos a sua senha');
    expect(removida.texto).toContain('apagamos a sua senha');
    expect(removida.texto).toContain('Esqueci minha senha');
  });

  it('o aviso de cadastro repetido traz as opções de entrar e de recuperar a senha (CA-02)', () => {
    const email = modelos.cadastroRepetido({ nome: 'Ana' });
    expect(email.texto).toContain('entre no app');
    expect(email.texto).toContain('Esqueci minha senha');
    expect(email.texto).toContain('Nada mudou na sua conta');
  });
});
