// R2 (rodada 2 da 5b): a senha nova recusada por ser comum chega ao painel com o código `comum` e
// o `motivo` da API, e a tela mostra esse motivo, que varia (senha comum ou só de números). Sem
// chave `erro.novaSenha.comum` de propósito: uma chave fixa apagaria o "Use letras também".
import {
  camposDoErroZod,
  criarContaSchema,
  MOTIVO_SENHA_COMUM,
  MOTIVO_SENHA_SO_DE_DIGITOS_E_SIMBOLOS,
  redefinirSenhaSchema,
} from '@bairrin/contratos';
import { describe, expect, it } from 'vitest';
import { mensagemDoCampo } from './mensagem-do-campo.ts';
import { textos } from './pt-BR.ts';

type ErroDoZod = Parameters<typeof camposDoErroZod>[0];

function textosDaRedefinicao(novaSenha: string) {
  const resultado = redefinirSenhaSchema.safeParse({
    email: 'ana@exemplo.com.br',
    codigo: '123456',
    novaSenha,
  });
  if (resultado.success) throw new Error(`a senha ${novaSenha} deveria ser recusada`);
  return camposDoErroZod(resultado.error as ErroDoZod).map((erro) => ({
    campo: erro.campo,
    codigo: erro.codigo,
    texto: mensagemDoCampo(erro.campo, erro.codigo, erro.motivo),
  }));
}

describe('senha nova comum na redefinição (R2)', () => {
  it('senha da lista à mão mostra o motivo da API, em português e sem texto técnico', () => {
    expect(textosDaRedefinicao('joaopedro123')).toEqual([
      { campo: 'novaSenha', codigo: 'comum', texto: MOTIVO_SENHA_COMUM },
    ]);
  });

  it('senha só de números e símbolos mostra o motivo próprio ("Use letras também")', () => {
    expect(textosDaRedefinicao('10203040')).toEqual([
      { campo: 'novaSenha', codigo: 'comum', texto: MOTIVO_SENHA_SO_DE_DIGITOS_E_SIMBOLOS },
    ]);
    expect(MOTIVO_SENHA_SO_DE_DIGITOS_E_SIMBOLOS).toMatch(/^Use letras também/u);
  });

  it('os dois motivos são diferentes: uma chave fixa para `comum` apagaria um deles', () => {
    expect(MOTIVO_SENHA_COMUM).not.toBe(MOTIVO_SENHA_SO_DE_DIGITOS_E_SIMBOLOS);
    const chaves: Record<string, unknown> = textos.erro.novaSenha;
    expect(Object.keys(chaves)).not.toContain('comum');
  });

  it('o mesmo vale para a senha do cadastro (`senha.comum`)', () => {
    const resultado = criarContaSchema.safeParse({
      nome: 'Ana Souza',
      email: 'ana@exemplo.com.br',
      telefone: '(35) 99999-1234',
      senha: '10203040',
      aceites: { termos: '1', privacidade: '1' },
    });
    if (resultado.success) throw new Error('a senha deveria ser recusada');
    const [erro, ...resto] = camposDoErroZod(resultado.error);
    expect(resto).toEqual([]);
    expect(erro?.campo).toBe('senha');
    expect(mensagemDoCampo('senha', erro?.codigo ?? '', erro?.motivo ?? '')).toBe(
      MOTIVO_SENHA_SO_DE_DIGITOS_E_SIMBOLOS,
    );
  });

  it('o motivo que a API manda para senha que só a lista pública recusa chega inteiro', () => {
    // A resposta 400 da API para `sorvete123`: campos[{ campo, codigo: 'comum', motivo }].
    expect(mensagemDoCampo('novaSenha', 'comum', MOTIVO_SENHA_COMUM)).toBe(MOTIVO_SENHA_COMUM);
    expect(mensagemDoCampo('senha', 'comum', MOTIVO_SENHA_COMUM)).toBe(MOTIVO_SENHA_COMUM);
  });

  it('motivo vazio da API cai no texto de último recurso, não em tela sem mensagem', () => {
    expect(mensagemDoCampo('novaSenha', 'comum', '')).toBe(textos.erroDeCampo.semMotivo);
  });
});
