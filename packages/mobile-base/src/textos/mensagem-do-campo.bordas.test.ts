// Bordas de `mensagemDoCampo` com os esquemas reais de `@bairrin/contratos` (CA-13): entradas
// hostis em todo campo dos contratos de identidade que os apps usam. O texto mostrado nunca é
// vazio, nunca vem em inglês e nunca repete o que a pessoa digitou.
import {
  camposDoErroZod,
  codigoDoAutenticadorSchema,
  criarContaSchema,
  entrarSchema,
  redefinirSenhaSchema,
  solicitarExclusaoSchema,
  solicitarRecuperacaoSchema,
  verificarEmailSchema,
  z,
} from '@bairrin/contratos';
import { mensagemDoCampo } from './mensagem-do-campo.ts';
import { textos } from './pt-BR.ts';

interface Esquema {
  safeParse(valor: unknown): { success: boolean; error?: Parameters<typeof camposDoErroZod>[0] };
}

const SEGREDO = 'Segredo-Digitado-Pela-Pessoa-91827';

const ESQUEMAS: ReadonlyArray<readonly [string, Esquema, string | undefined]> = [
  ['criarConta', criarContaSchema, 'cadastro'],
  ['entrar', entrarSchema, undefined],
  ['verificarEmail', verificarEmailSchema, undefined],
  ['solicitarRecuperacao', solicitarRecuperacaoSchema, 'recuperacaoDeSenha'],
  ['redefinirSenha', redefinirSenhaSchema, 'recuperacaoDeSenha'],
  ['solicitarExclusao', solicitarExclusaoSchema, undefined],
  ['codigoDoAutenticador', codigoDoAutenticadorSchema.pipe(z.string()), undefined],
];

/** Valores ruins para um campo de texto. */
const VALORES_RUINS: readonly unknown[] = [
  '',
  '   ',
  '\t\n',
  null,
  undefined,
  0,
  1e21,
  true,
  [],
  {},
  [SEGREDO],
  { a: SEGREDO },
  `${SEGREDO}@`,
  `${SEGREDO} ${SEGREDO}`,
  'x'.repeat(10_000),
  '\u0000‮​',
  '😀'.repeat(300),
  'á'.repeat(200),
  '123',
  '(00) 00000-0000',
  '12345678901234567890',
];

function corposRuins(): unknown[] {
  const campos = [
    'nome',
    'email',
    'telefone',
    'senha',
    'novaSenha',
    'senhaAtual',
    'codigo',
    'cliente',
    'aceites',
  ];
  const corpos: unknown[] = [undefined, null, 'texto', 7, [], {}, { [SEGREDO]: SEGREDO }];
  for (const campo of campos) {
    for (const valor of VALORES_RUINS) corpos.push({ [campo]: valor });
  }
  corpos.push({ aceites: { termos: SEGREDO, privacidade: '' } });
  corpos.push({ aceites: { termos: null } });
  return corpos;
}

describe('mensagemDoCampo contra entradas hostis dos esquemas reais (CA-13)', () => {
  const erradas: string[] = [];
  let total = 0;

  beforeAll(() => {
    for (const [nome, esquema, tela] of ESQUEMAS) {
      for (const corpo of corposRuins()) {
        const resultado = esquema.safeParse(corpo);
        if (resultado.success || resultado.error === undefined) continue;
        for (const { campo, codigo, motivo } of camposDoErroZod(resultado.error)) {
          total += 1;
          const texto = mensagemDoCampo(campo, codigo, motivo, tela);
          if (texto.trim() === '') erradas.push(`${nome}.${campo}.${codigo}: texto vazio`);
          if (/\b(invalid|required|expected|received|string|undefined|object)\b/i.test(texto)) {
            erradas.push(`${nome}.${campo}.${codigo}: inglês ou técnico: ${texto.slice(0, 80)}`);
          }
          if (texto.includes(SEGREDO)) {
            erradas.push(`${nome}.${campo}.${codigo}: repete o que foi digitado`);
          }
          if (texto.length > 160) {
            erradas.push(`${nome}.${campo}.${codigo}: texto de ${texto.length} caracteres`);
          }
        }
      }
    }
  });

  it('exerceu um número grande de erros reais', () => {
    expect(total).toBeGreaterThan(300);
  });

  it('todo erro vira texto em português, curto e sem repetir o que a pessoa digitou', () => {
    expect([...new Set(erradas)]).toEqual([]);
  });

  it('quando existe a chave de `erro.<campo>.<codigo>`, ela vence o motivo da API', () => {
    for (const [campo, codigos] of Object.entries(textos.erro)) {
      for (const [codigo, texto] of Object.entries(codigos)) {
        expect(mensagemDoCampo(campo, codigo, 'motivo da API que não pode aparecer')).toBe(texto);
      }
    }
  });
});
