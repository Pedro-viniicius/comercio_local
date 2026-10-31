// Bordas da leitura do texto legal (CA-01; spec 01, "Leitor de texto legal"): data de vigência
// impossível, virada de dia em Brasília e texto do documento com HTML, link e asteriscos soltos.
import { blocosDoTextoLegal, formatarDataLegal, trechosDaLinha } from './texto-legal.ts';

describe('formatarDataLegal, bordas', () => {
  // Q38 (baixa): reproduz o bug e falha de propósito até a correção; troque `it.failing` por `it`.
  it.failing(
    'data impossível (31/02, 31/04, 29/02 de ano comum) não vira "vigente desde": devolve null',
    () => {
      const impossiveis = ['2026-02-31', '2026-04-31', '2027-02-29', '2026-06-31', '2100-02-29'];
      expect(impossiveis.map((data) => formatarDataLegal(data))).toEqual(
        impossiveis.map(() => null),
      );
    },
  );

  it('ano bissexto: 29/02/2028 existe', () => {
    expect(formatarDataLegal('2028-02-29')).toBe('29/02/2028');
  });

  it.each(['2026-13-01', '2026-00-10', '2026-10-00', '2026-10-32', '26-10-31', '31/10/2026', ''])(
    'texto que não é data (%j) devolve null',
    (valor) => {
      expect(formatarDataLegal(valor)).toBeNull();
    },
  );

  it('no horário de Brasília (UTC−3): a virada do dia vem 3 horas depois do UTC', () => {
    expect(formatarDataLegal('2026-11-01T02:59:59Z')).toBe('31/10/2026');
    expect(formatarDataLegal('2026-11-01T03:00:00Z')).toBe('01/11/2026');
    expect(formatarDataLegal('2026-10-31T23:30:00-03:00')).toBe('31/10/2026');
    expect(formatarDataLegal('2026-10-31T23:30:00+00:00')).toBe('31/10/2026');
    expect(formatarDataLegal('2026-12-31T23:59:59-03:00')).toBe('31/12/2026');
    expect(formatarDataLegal('2027-01-01T02:59:59Z')).toBe('31/12/2026');
  });

  it('data com hora impossível ou texto com lixo devolve null', () => {
    expect(formatarDataLegal('2026-10-31T25:00:00Z')).toBeNull();
    expect(formatarDataLegal('2026-10-31Tabc')).toBeNull();
    expect(formatarDataLegal('2026-10-31 e mais texto')).toBeNull();
  });
});

describe('texto do documento, bordas', () => {
  it('HTML, link, imagem e script do documento chegam como texto, sem virar bloco nem formatação', () => {
    const conteudo = [
      '## Termos',
      '<script>alert(1)</script>',
      '[clique](javascript:alert(1)) ![x](https://exemplo.com/x.png)',
      '- <b>item</b>',
    ].join('\n');

    const blocos = blocosDoTextoLegal(conteudo);

    expect(blocos.map((b) => b.tipo)).toEqual(['titulo', 'paragrafo', 'item']);
    expect(blocos[1]?.trechos).toEqual([
      {
        texto:
          '<script>alert(1)</script> [clique](javascript:alert(1)) ![x](https://exemplo.com/x.png)',
        negrito: false,
      },
    ]);
    expect(blocos[2]?.trechos).toEqual([{ texto: '<b>item</b>', negrito: false }]);
  });

  it('nenhum caractere é perdido: reescrevendo o negrito, o texto volta igual (asteriscos soltos incluídos)', () => {
    let estado = 20_261_031;
    const sorteio = () => {
      estado = (estado * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return estado / 4_294_967_296;
    };
    const alfabeto = ['*', '*', 'a', 'b', ' ', '**'];
    for (let i = 0; i < 1000; i += 1) {
      let linha = '';
      const tamanho = Math.floor(sorteio() * 14);
      for (let j = 0; j < tamanho; j += 1) {
        linha += alfabeto[Math.floor(sorteio() * alfabeto.length)];
      }
      const trechos = trechosDaLinha(linha);
      const reescrito = trechos.map((t) => (t.negrito ? `**${t.texto}**` : t.texto)).join('');
      // Só pares vazios (`****`) somem; o resto volta idêntico.
      expect(reescrito.replaceAll('****', '')).toBe(linha.replaceAll('****', ''));
      expect(trechos.every((t) => t.texto !== '')).toBe(true);
    }
  });

  it('conteúdo enorme e linhas com CRLF não travam e viram os mesmos blocos', () => {
    const linhas = Array.from({ length: 5000 }, (_, i) => `Parágrafo ${i} com **negrito**.`);
    const comLf = blocosDoTextoLegal(linhas.join('\n\n'));
    const comCrlf = blocosDoTextoLegal(linhas.join('\r\n\r\n'));

    expect(comLf).toHaveLength(5000);
    expect(comCrlf).toEqual(comLf);
  });
});
