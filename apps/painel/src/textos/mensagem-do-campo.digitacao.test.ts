// CA-13 de ponta a ponta no painel: o que uma pessoa pode digitar nos campos de texto das telas
// de autenticação passa pelos esquemas de `@bairrin/contratos` e por `mensagemDoCampo`. Toda
// mensagem sai em português, sem texto técnico, e a chave `erro.<campo>.<codigo>` vence o motivo.
import {
  camposDoErroZod,
  confirmarConfiguracaoSchema,
  entrarSchema,
  redefinirSenhaSchema,
  solicitarRecuperacaoSchema,
  verificarSegundoFatorSchema,
} from '@bairrin/contratos';
import { describe, expect, it } from 'vitest';
import { mensagemDoCampo } from './mensagem-do-campo.ts';
import { textos } from './pt-BR.ts';

interface Esquema {
  safeParse(valor: unknown): { success: boolean; error?: Parameters<typeof camposDoErroZod>[0] };
}

/** O que se digita em cada campo: vazio, só espaço, curto, longo e mal formado. */
const DIGITADO = ['', '   ', 'a', '12', '1234567', 'sem-arroba', 'ana@', 'x'.repeat(300)];

interface Tela {
  nome: string;
  esquema: Esquema;
  base: Record<string, unknown>;
  /** Campos que a pessoa digita (o resto vem pronto da tela). */
  campos: string[];
}

const TELAS: Tela[] = [
  {
    nome: 'entrar',
    esquema: entrarSchema,
    base: { email: 'ana@exemplo.com.br', senha: 'qualquer', cliente: 'painel' },
    campos: ['email', 'senha'],
  },
  {
    nome: 'recuperar senha',
    esquema: solicitarRecuperacaoSchema,
    base: { email: 'ana@exemplo.com.br' },
    campos: ['email'],
  },
  {
    nome: 'nova senha',
    esquema: redefinirSenhaSchema,
    base: { email: 'ana@exemplo.com.br', codigo: '123456', novaSenha: 'Uma-senha-boa-2026' },
    campos: ['email', 'codigo', 'novaSenha'],
  },
  {
    nome: 'segundo fator',
    esquema: verificarSegundoFatorSchema,
    base: { desafio: 'abc.def', codigo: '123456' },
    campos: ['codigo'],
  },
  {
    nome: 'confirmar configuração',
    esquema: confirmarConfiguracaoSchema,
    base: { desafio: 'abc.def', codigo: '123456' },
    campos: ['codigo'],
  },
];

const TECNICO = /\b(invalid|required|expected|string|undefined|null|NaN|zod)\b|Entrada inválida/i;

describe('mensagemDoCampo com o que as pessoas digitam', () => {
  it.each(TELAS)('$nome: nenhuma digitação gera texto técnico, vazio ou em inglês', (tela) => {
    let casos = 0;
    for (const campo of tela.campos) {
      for (const digitado of DIGITADO) {
        const resultado = tela.esquema.safeParse({ ...tela.base, [campo]: digitado });
        if (resultado.success || !resultado.error) continue;
        for (const erro of camposDoErroZod(resultado.error)) {
          casos += 1;
          const texto = mensagemDoCampo(erro.campo, erro.codigo, erro.motivo);
          expect(texto.trim(), `${tela.nome}/${erro.campo}/${erro.codigo}`).not.toBe('');
          expect(texto, `${tela.nome}/${erro.campo}/${erro.codigo}`).not.toMatch(TECNICO);
          // A chave da apresentação vence o motivo da API sempre que existe.
          const grupo = (textos.erro as Record<string, Record<string, string>>)[erro.campo];
          const daChave = grupo?.[erro.codigo];
          if (daChave !== undefined) expect(texto).toBe(daChave);
          else expect(texto).toBe(erro.motivo);
        }
      }
    }
    expect(casos).toBeGreaterThan(0);
  });

  it('campo vazio é sempre "obrigatorio" e usa o texto de cada campo', () => {
    const esperado: Record<string, string> = {
      email: textos.erro.email.obrigatorio,
      senha: textos.erro.senha.obrigatorio,
      novaSenha: textos.erro.novaSenha.obrigatorio,
      codigo: textos.erro.codigo.obrigatorio,
    };
    for (const tela of TELAS) {
      for (const campo of tela.campos) {
        const resultado = tela.esquema.safeParse({ ...tela.base, [campo]: '' });
        if (resultado.success || !resultado.error) throw new Error(`${tela.nome}/${campo}`);
        const [primeiro] = camposDoErroZod(resultado.error);
        expect(primeiro?.codigo, `${tela.nome}/${campo}`).toBe('obrigatorio');
        expect(
          mensagemDoCampo(primeiro?.campo ?? '', primeiro?.codigo ?? '', primeiro?.motivo ?? ''),
        ).toBe(esperado[campo]);
      }
    }
  });
});
