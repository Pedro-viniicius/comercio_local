// Captura do log da aplicação nos testes e varredura de dado sensível (plano 01b, etapa 19;
// CA-12, S10). Não é um teste.
//
// - `criarCapturaDeLog()`: destino do pino (`AppModule.registrar({ destinoDoLog })`) que
//   guarda as linhas em memória. O nestjs-pino cria o pino-http uma vez por processo: a
//   segunda aplicação do mesmo arquivo de teste escreve no destino da primeira, então use
//   uma captura por arquivo e `limpar()` a cada subida.
// - `formasDe(valor)`: o valor e as formas em que ele costuma vazar sem ser igual ao
//   digitado (maiúsculas e minúsculas, codificado em URL, escapado em JSON, só os dígitos).
// - `sensiveisEncontrados(fontes, sensiveis)`: em quais fontes (log, respostas, eventos...)
//   aparece algum valor sensível, em qualquer das formas. A mensagem diz o rótulo do valor e
//   a fonte, nunca o valor: a saída do teste também não pode virar vazamento.

/** As linhas do log capturadas, com o destino para o `AppModule`. */
export interface CapturaDeLog {
  readonly destino: { write(linha: string): void };
  /** As linhas desde a última limpeza, juntas. */
  texto(): string;
  /** As linhas como objetos (o log é JSON por linha). */
  registros(): Record<string, unknown>[];
  limpar(): void;
}

export function criarCapturaDeLog(): CapturaDeLog {
  const linhas: string[] = [];
  return {
    destino: { write: (linha: string) => void linhas.push(linha) },
    texto: () => linhas.join('\n'),
    registros: () =>
      linhas
        .flatMap((linha) => linha.split('\n'))
        .filter((linha) => linha.trim() !== '')
        .map((linha) => JSON.parse(linha) as Record<string, unknown>),
    limpar: () => {
      linhas.length = 0;
    },
  };
}

/** Um valor que não pode aparecer, com um rótulo para a mensagem de falha. */
export interface ValorSensivel {
  /** Ex.: `e-mail`, `senha`, `token de acesso`. Vai na mensagem; o valor, não. */
  readonly rotulo: string;
  readonly valor: string;
}

/** Valores curtos demais casam por acaso com qualquer texto (ids, datas, números). */
const MENOR_VALOR_CONFERIDO = 6;

/**
 * As formas do valor que a varredura procura: como é, em minúsculas e maiúsculas, codificado
 * em URL, escapado em JSON e, se tiver 8 dígitos ou mais (telefone, documento), só os dígitos.
 */
export function formasDe(valor: string): string[] {
  const formas = new Set<string>([
    valor,
    valor.toLowerCase(),
    valor.toUpperCase(),
    encodeURIComponent(valor),
    JSON.stringify(valor).slice(1, -1),
  ]);
  const digitos = valor.replace(/\D/g, '');
  if (digitos.length >= 8) {
    formas.add(digitos);
    // Telefone brasileiro: com e sem o 55 do país.
    if (digitos.startsWith('55')) formas.add(digitos.slice(2));
  }
  return [...formas].filter((forma) => forma.length >= MENOR_VALOR_CONFERIDO);
}

/**
 * Onde cada valor sensível apareceu: `["log: e-mail", "resposta 400 POST /x: senha"]`.
 * Lista vazia quando nada vazou. `fontes` mapeia o nome da fonte para o texto dela.
 */
export function sensiveisEncontrados(
  fontes: Readonly<Record<string, string>>,
  sensiveis: readonly ValorSensivel[],
): string[] {
  const achados: string[] = [];
  for (const [fonte, texto] of Object.entries(fontes)) {
    for (const { rotulo, valor } of sensiveis) {
      if (formasDe(valor).some((forma) => texto.includes(forma))) {
        achados.push(`${fonte}: ${rotulo}`);
      }
    }
  }
  return achados;
}
