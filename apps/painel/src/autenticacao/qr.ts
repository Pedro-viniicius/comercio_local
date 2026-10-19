// QR code do TOTP gerado no navegador, sem serviço externo nem imagem remota (plano 01b, etapa 15).
// O `qrcode` só calcula a matriz; o desenho é um `<path>` de SVG no próprio DOM. Assim não há
// `data:` (a CSP do painel tem `img-src 'self'`) nem `<canvas>` para ler de volta.
import { create } from 'qrcode';

/** Margem de 4 módulos em volta, como pede a norma do QR para a leitura funcionar. */
export const MARGEM_DO_QR = 4;

export interface DesenhoDoQr {
  /** Lado do quadro, com a margem, em módulos (unidade do `viewBox`). */
  lado: number;
  /** Atributo `d` do `<path>` com os módulos escuros. */
  caminho: string;
}

/** Só a URI do app autenticador vira QR: qualquer outra coisa é resposta fora do contrato. */
export function ehUriDoAutenticador(texto: string): boolean {
  return texto.startsWith('otpauth://totp/');
}

/**
 * Desenha o QR de `texto`: uma linha do `<path>` por sequência de módulos escuros na mesma fileira.
 * Lança se o texto não couber num QR (o `qrcode` recusa).
 */
export function desenharQr(texto: string): DesenhoDoQr {
  const { modules } = create(texto, { errorCorrectionLevel: 'M' });
  const { size, data } = modules;
  const partes: string[] = [];
  for (let linha = 0; linha < size; linha += 1) {
    let coluna = 0;
    while (coluna < size) {
      if (!data[linha * size + coluna]) {
        coluna += 1;
        continue;
      }
      const inicio = coluna;
      while (coluna < size && data[linha * size + coluna]) coluna += 1;
      const largura = coluna - inicio;
      partes.push(`M${inicio + MARGEM_DO_QR} ${linha + MARGEM_DO_QR}h${largura}v1h-${largura}z`);
    }
  }
  return { lado: size + 2 * MARGEM_DO_QR, caminho: partes.join('') };
}

/** Chave em grupos de 4 caracteres, como a pessoa vai digitar no app (spec 01, P1b passo 2). */
export function agruparDeQuatro(texto: string): string[] {
  return texto.replaceAll(/\s/g, '').match(/.{1,4}/g) ?? [];
}

/** Código de recuperação em duas metades de 5 (`ABCDE-FGHIJ`), que o campo de P1a aceita. */
export function formatarCodigoDeRecuperacao(codigo: string): string {
  const limpo = codigo.replaceAll(/[\s-]/g, '');
  return limpo.length === 10 ? `${limpo.slice(0, 5)}-${limpo.slice(5)}` : limpo;
}

/**
 * Texto para o leitor de tela ler caractere a caractere (spec 01, P1b): letras separadas por
 * espaço e grupos por vírgula, para nunca ser lido como palavra.
 */
export function soletrar(grupos: readonly string[]): string {
  return grupos.map((grupo) => [...grupo].join(' ')).join(', ');
}
