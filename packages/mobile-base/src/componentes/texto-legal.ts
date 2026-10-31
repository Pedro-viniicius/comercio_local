// Leitura do texto legal (Termos e Política) que a API devolve: um subconjunto pequeno de
// Markdown. Funções puras. Só texto vira texto: nada de HTML, link ou imagem do documento chega à
// tela (o conteúdo vem do banco, mas a tela nunca o interpreta além disto).

export interface TrechoDoTexto {
  texto: string;
  negrito: boolean;
}

export interface BlocoDoTextoLegal {
  /** `titulo` é o `##` ou `###`; `item`, a linha de lista (`- ` ou `* `). */
  tipo: 'titulo' | 'paragrafo' | 'item';
  trechos: TrechoDoTexto[];
}

/** `**negrito**` dentro de uma linha; asteriscos sem par ficam como texto. */
export function trechosDaLinha(linha: string): TrechoDoTexto[] {
  const trechos: TrechoDoTexto[] = [];
  const partes = linha.split('**');
  // Número par de partes = asteriscos sem par: tudo vira texto comum.
  const comPar = partes.length % 2 === 1;
  partes.forEach((parte, indice) => {
    if (comPar) {
      if (parte !== '') trechos.push({ texto: parte, negrito: indice % 2 === 1 });
    } else {
      const anterior = trechos.at(-1);
      const texto = indice === 0 ? parte : `**${parte}`;
      if (anterior) anterior.texto += texto;
      else trechos.push({ texto, negrito: false });
    }
  });
  return trechos.filter((trecho) => trecho.texto !== '');
}

/**
 * Divide o conteúdo em títulos, parágrafos e itens. O `#` (título do documento) é descartado: a
 * tela já mostra o título. Linhas seguidas de texto formam um parágrafo só.
 */
export function blocosDoTextoLegal(conteudo: string): BlocoDoTextoLegal[] {
  const blocos: BlocoDoTextoLegal[] = [];
  let paragrafo: string[] = [];

  const fecharParagrafo = () => {
    if (paragrafo.length > 0) {
      blocos.push({ tipo: 'paragrafo', trechos: trechosDaLinha(paragrafo.join(' ')) });
      paragrafo = [];
    }
  };

  for (const bruta of conteudo.replaceAll('\r\n', '\n').split('\n')) {
    const linha = bruta.trim();
    if (linha === '') {
      fecharParagrafo();
    } else if (/^#{2,6}\s/.test(linha)) {
      fecharParagrafo();
      blocos.push({ tipo: 'titulo', trechos: trechosDaLinha(linha.replace(/^#+\s+/, '')) });
    } else if (/^#\s/.test(linha)) {
      fecharParagrafo();
    } else if (/^[-*]\s+\S/.test(linha)) {
      fecharParagrafo();
      blocos.push({ tipo: 'item', trechos: trechosDaLinha(linha.replace(/^[-*]\s+/, '')) });
    } else {
      paragrafo.push(linha);
    }
  }
  fecharParagrafo();
  return blocos;
}

const DATA_SEM_HORA = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Brasília não tem horário de verão desde 2019: UTC−3 o ano todo. */
const DESLOCAMENTO_DE_BRASILIA_EM_MS = -3 * 60 * 60 * 1000;

const doisDigitos = (numero: number) => String(numero).padStart(2, '0');

/**
 * `AAAA-MM-DD` ou data e hora ISO 8601 → `dd/mm/aaaa` no horário de Brasília. Texto que não é
 * data devolve `null` (a tela omite o "vigente desde").
 */
export function formatarDataLegal(valor: string): string | null {
  const texto = valor.trim();
  const soData = DATA_SEM_HORA.exec(texto);
  if (soData) {
    const [, ano, mes, dia] = soData;
    return Number(mes) >= 1 && Number(mes) <= 12 && Number(dia) >= 1 && Number(dia) <= 31
      ? `${dia}/${mes}/${ano}`
      : null;
  }
  const instante = Date.parse(texto);
  if (Number.isNaN(instante) || !/^\d{4}-\d{2}-\d{2}T/.test(texto)) return null;
  const brasilia = new Date(instante + DESLOCAMENTO_DE_BRASILIA_EM_MS);
  return `${doisDigitos(brasilia.getUTCDate())}/${doisDigitos(brasilia.getUTCMonth() + 1)}/${brasilia.getUTCFullYear()}`;
}
