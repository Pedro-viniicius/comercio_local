import { blocosDoTextoLegal, formatarDataLegal, trechosDaLinha } from './texto-legal.ts';

describe('trechosDaLinha', () => {
  it('texto simples é um trecho só', () => {
    expect(trechosDaLinha('Texto simples')).toEqual([{ texto: 'Texto simples', negrito: false }]);
  });

  it('separa o **negrito** do resto', () => {
    expect(trechosDaLinha('**Rascunho.** Texto provisório')).toEqual([
      { texto: 'Rascunho.', negrito: true },
      { texto: ' Texto provisório', negrito: false },
    ]);
    expect(trechosDaLinha('antes **meio** depois')).toEqual([
      { texto: 'antes ', negrito: false },
      { texto: 'meio', negrito: true },
      { texto: ' depois', negrito: false },
    ]);
  });

  it('asteriscos sem par ficam como texto, sem negrito', () => {
    expect(trechosDaLinha('a **b')).toEqual([{ texto: 'a **b', negrito: false }]);
    expect(trechosDaLinha('a **b** c **d')).toEqual([{ texto: 'a **b** c **d', negrito: false }]);
  });

  it('linha vazia ou só de marcadores não gera trecho vazio', () => {
    expect(trechosDaLinha('')).toEqual([]);
    expect(trechosDaLinha('****')).toEqual([]);
  });
});

describe('blocosDoTextoLegal', () => {
  it('lê o documento semeado: descarta o `#`, mantém `##` como título e parágrafos', () => {
    const conteudo = [
      '# Termos de Uso do Bairrin',
      '',
      '**Rascunho.** Texto provisório.',
      '',
      '## O que é o Bairrin',
      '',
      'Marketplace do comércio do bairro.',
      '',
    ].join('\n');

    expect(blocosDoTextoLegal(conteudo)).toEqual([
      {
        tipo: 'paragrafo',
        trechos: [
          { texto: 'Rascunho.', negrito: true },
          { texto: ' Texto provisório.', negrito: false },
        ],
      },
      { tipo: 'titulo', trechos: [{ texto: 'O que é o Bairrin', negrito: false }] },
      {
        tipo: 'paragrafo',
        trechos: [{ texto: 'Marketplace do comércio do bairro.', negrito: false }],
      },
    ]);
  });

  it('linhas seguidas viram um parágrafo; linha em branco separa parágrafos', () => {
    const blocos = blocosDoTextoLegal('primeira linha\nsegunda linha\n\nterceira');

    expect(blocos.map((bloco) => bloco.trechos[0]?.texto)).toEqual([
      'primeira linha segunda linha',
      'terceira',
    ]);
  });

  it('`###` também é título; `-` e `*` viram itens', () => {
    const blocos = blocosDoTextoLegal('### Sub\n- um\n* dois\ntexto');

    expect(blocos.map((bloco) => [bloco.tipo, bloco.trechos[0]?.texto])).toEqual([
      ['titulo', 'Sub'],
      ['item', 'um'],
      ['item', 'dois'],
      ['paragrafo', 'texto'],
    ]);
  });

  it('aceita fim de linha do Windows e espaços nas pontas', () => {
    const blocos = blocosDoTextoLegal('## Título  \r\n\r\n  Parágrafo  \r\n');

    expect(blocos.map((bloco) => bloco.trechos[0]?.texto)).toEqual(['Título', 'Parágrafo']);
  });

  it('conteúdo vazio ou só de `#` não gera bloco', () => {
    expect(blocosDoTextoLegal('')).toEqual([]);
    expect(blocosDoTextoLegal('# Só o título\n\n')).toEqual([]);
  });

  it('HTML, links e imagens do documento ficam como texto, nunca interpretados', () => {
    const blocos = blocosDoTextoLegal('<script>x</script> [link](http://x) ![img](y)');

    expect(blocos).toEqual([
      {
        tipo: 'paragrafo',
        trechos: [{ texto: '<script>x</script> [link](http://x) ![img](y)', negrito: false }],
      },
    ]);
  });

  it('traço no meio da frase ou "-" sem texto não vira item', () => {
    expect(blocosDoTextoLegal('a - b')[0]?.tipo).toBe('paragrafo');
    expect(blocosDoTextoLegal('-')[0]?.tipo).toBe('paragrafo');
    expect(blocosDoTextoLegal('#semespaco')[0]?.tipo).toBe('paragrafo');
  });
});

describe('formatarDataLegal', () => {
  it.each([
    ['2026-10-16', '16/10/2026'],
    ['2026-01-05', '05/01/2026'],
    ['2026-10-16T14:32:00Z', '16/10/2026'],
    ['2026-10-16T14:32:00.000+00:00', '16/10/2026'],
    // 02:00 UTC ainda é o dia anterior em Brasília (UTC−3).
    ['2026-10-17T02:00:00Z', '16/10/2026'],
    ['2026-10-17T03:00:00Z', '17/10/2026'],
    ['2026-01-01T01:00:00Z', '31/12/2025'],
    ['2026-10-16T23:30:00-03:00', '16/10/2026'],
    ['  2026-10-16  ', '16/10/2026'],
  ])('%j → %j', (entrada, esperado) => {
    expect(formatarDataLegal(entrada)).toBe(esperado);
  });

  it.each([
    '',
    'ontem',
    '16/10/2026',
    '2026-13-01',
    '2026-00-10',
    '2026-10-32',
    '2026-10-16 14:32',
    '2026-02',
  ])('%j não é data: devolve null', (entrada) => {
    expect(formatarDataLegal(entrada)).toBeNull();
  });
});
