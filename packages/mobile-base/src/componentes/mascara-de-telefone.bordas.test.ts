// Bordas da máscara de telefone contra o validador do contrato (CA-01, CA-13): a máscara nunca
// pode trocar um celular válido por outro número, nem fazer um número que o contrato recusa
// virar um que ele aceita. Sementes fixas, sem aleatoriedade solta.
import { DDDS_VALIDOS, normalizarCelular } from '@bairrin/contratos';
import { digitosDoCelular, mascararTelefone } from './mascara-de-telefone.ts';

/** Gerador congruencial com semente fixa: a mesma sequência em toda execução. */
function sequencia(semente: number): () => number {
  let estado = semente;
  return () => {
    estado = (estado * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return estado / 4_294_967_296;
  };
}

const DDDS = [...DDDS_VALIDOS];

function celularAleatorio(sorteio: () => number): string {
  const ddd = DDDS[Math.floor(sorteio() * DDDS.length)] ?? '35';
  let numero = '9';
  for (let i = 0; i < 8; i += 1) numero += String(Math.floor(sorteio() * 10));
  return `${ddd}${numero}`;
}

/** O mesmo celular escrito de várias formas que as pessoas digitam ou colam. */
function formatos(celular: string): string[] {
  const ddd = celular.slice(0, 2);
  const numero = celular.slice(2);
  const meio = `${numero.slice(0, 5)}-${numero.slice(5)}`;
  return [
    celular,
    `(${ddd}) ${meio}`,
    `(${ddd})${meio}`,
    `${ddd} ${meio}`,
    `${ddd}.${numero.slice(0, 5)}.${numero.slice(5)}`,
    `+55 ${ddd} ${meio}`,
    `+55 (${ddd}) ${meio}`,
    `+55${celular}`,
    `55${celular}`,
    `0${celular}`,
    `0 ${ddd} ${meio}`,
    `  ${celular}  `,
  ];
}

describe('mascararTelefone contra o validador do contrato', () => {
  it('todo formato válido do mesmo celular continua o mesmo celular depois da máscara', () => {
    const sorteio = sequencia(20_261_031);
    const divergentes: string[] = [];
    let conferidos = 0;
    for (let i = 0; i < 400; i += 1) {
      const celular = celularAleatorio(sorteio);
      for (const formato of formatos(celular)) {
        const esperado = normalizarCelular(formato);
        if (esperado === null) continue;
        conferidos += 1;
        if (esperado !== `+55${celular}`) divergentes.push(`contrato: ${formato}`);
        const mascarado = mascararTelefone(formato);
        if (normalizarCelular(mascarado) !== esperado) {
          divergentes.push(`${formato} → ${mascarado}`);
        }
      }
    }
    expect(conferidos).toBeGreaterThan(3000);
    expect(divergentes).toEqual([]);
  });

  it('digitar um dígito por vez, realimentando o campo, chega ao mesmo texto da colagem', () => {
    const sorteio = sequencia(31_102_026);
    for (let i = 0; i < 200; i += 1) {
      const celular = celularAleatorio(sorteio);
      let campo = '';
      for (const digito of celular) campo = mascararTelefone(campo + digito);
      expect(campo).toBe(mascararTelefone(celular));
      expect(normalizarCelular(campo)).toBe(`+55${celular}`);
    }
  });

  it('é idempotente: mascarar o texto já mascarado não muda nada, em qualquer entrada', () => {
    const sorteio = sequencia(7);
    const alfabeto = '0123456789 ()-.+abc55';
    for (let i = 0; i < 2000; i += 1) {
      let texto = '';
      const tamanho = Math.floor(sorteio() * 30);
      for (let j = 0; j < tamanho; j += 1) {
        texto += alfabeto[Math.floor(sorteio() * alfabeto.length)];
      }
      const uma = mascararTelefone(texto);
      expect(mascararTelefone(uma)).toBe(uma);
      expect(digitosDoCelular(texto).length).toBeLessThanOrEqual(11);
    }
  });

  it('um número que o contrato recusa nunca vira um que ele aceita (outro país, fixo, DDD inexistente)', () => {
    const recusados = [
      '+1 415 555 2671',
      '+351 912 345 678',
      '(35) 3333-1234',
      '3533331234',
      '(10) 99999-1234',
      '(00) 99999-1234',
      '+55 (10) 99999-1234',
    ];
    for (const texto of recusados) {
      expect(normalizarCelular(texto)).toBeNull();
      expect(normalizarCelular(mascararTelefone(texto))).toBeNull();
    }
  });

  // Q37 (baixa): reproduz o bug e falha de propósito até a correção; troque `it.failing` por `it`.
  it.failing(
    'celular argentino colado com +54 não vira um celular brasileiro válido (o contrato recusa outro país)',
    () => {
      // `+54 9 11 1234 5678`: a máscara só corta o `+55`; o resto é truncado em 11 dígitos e, por
      // coincidência, vira o DDD 54 (RS) com 9 na frente: "(54) 91112-3456".
      for (const texto of ['+54 9 11 1234 5678', '+54 9 351 123 4567']) {
        expect(normalizarCelular(texto)).toBeNull();
        expect(normalizarCelular(mascararTelefone(texto))).toBeNull();
      }
    },
  );

  it('texto gigante ou com caracteres estranhos não trava nem passa de 15 caracteres', () => {
    const entradas = ['9'.repeat(100_000), '😀'.repeat(1000), '٣٥ ３５', '\u0000'];
    for (const entrada of entradas) {
      expect(mascararTelefone(entrada).length).toBeLessThanOrEqual('(35) 99999-1234'.length);
    }
  });
});
