import {
  CODIGOS_DE_CAMPO,
  camposDoErroZod,
  entrarSchema,
  redefinirSenhaSchema,
  verificarSegundoFatorSchema,
} from '@bairrin/contratos';
import { describe, expect, it } from 'vitest';
import { mensagemDoCampo, type TelaComTextoProprio } from './mensagem-do-campo.ts';
import { textos } from './pt-BR.ts';

describe('mensagemDoCampo', () => {
  it('usa o texto de `erro.<campo>.<codigo>`, não o motivo da API', () => {
    expect(mensagemDoCampo('email', 'obrigatorio', 'Campo obrigatório.')).toBe(
      'Informe seu e-mail',
    );
    expect(mensagemDoCampo('email', 'invalido', 'Texto técnico qualquer')).toBe(
      'Confira o e-mail: falta o @ ou o domínio',
    );
    expect(mensagemDoCampo('senha', 'obrigatorio', 'Campo obrigatório.')).toBe('Informe sua senha');
    expect(mensagemDoCampo('codigo', 'obrigatorio', 'Campo obrigatório.')).toBe(
      'Informe o código de 6 dígitos',
    );
    expect(mensagemDoCampo('codigoRecuperacao', 'invalido', 'qualquer')).toBe(
      'Código de recuperação inválido. Confira e tente de novo.',
    );
  });

  it('a senha comum da redefinição cai no `motivo` da API (sem chave, de propósito)', () => {
    expect(mensagemDoCampo('novaSenha', 'comum', 'Use letras também: …')).toBe(
      'Use letras também: …',
    );
  });

  it('sem a chave do campo, cai no motivo da API', () => {
    expect(mensagemDoCampo('apelido', 'invalido', 'Use até 20 caracteres')).toBe(
      'Use até 20 caracteres',
    );
  });

  it('sem a chave do código, cai no motivo da API (a senha tem vários motivos)', () => {
    expect(mensagemDoCampo('novaSenha', 'invalido', 'Use 8 caracteres ou mais')).toBe(
      'Use 8 caracteres ou mais',
    );
    expect(mensagemDoCampo('senha', 'invalido', 'Use até 128 caracteres')).toBe(
      'Use até 128 caracteres',
    );
  });

  it('código que o painel não conhece (API mais nova) mostra o motivo', () => {
    expect(mensagemDoCampo('email', 'codigo_novo', 'Motivo da API nova')).toBe(
      'Motivo da API nova',
    );
  });

  it('campo desconhecido (CA-13) mostra o motivo em português da API', () => {
    expect(mensagemDoCampo('admin', 'desconhecido', 'Campo desconhecido.')).toBe(
      'Campo desconhecido.',
    );
  });

  it('campo e código da rede não acham propriedade herdada do Object', () => {
    for (const nome of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(mensagemDoCampo(nome, 'invalido', 'Motivo A')).toBe('Motivo A');
      expect(mensagemDoCampo('email', nome, 'Motivo B')).toBe('Motivo B');
    }
  });

  it('campo com ponto (aninhado) ou vazio não quebra', () => {
    expect(mensagemDoCampo('aceites.termos', 'invalido', 'Versão do documento inválida')).toBe(
      'Versão do documento inválida',
    );
    expect(mensagemDoCampo('', '', 'Motivo')).toBe('Motivo');
  });

  it('sem texto da chave e sem motivo, mostra o texto de último recurso', () => {
    expect(mensagemDoCampo('apelido', 'invalido', '')).toBe(textos.erroDeCampo.semMotivo);
    expect(mensagemDoCampo('apelido', 'invalido', '   ')).toBe(textos.erroDeCampo.semMotivo);
  });

  it('o texto da chave vale mesmo com motivo vazio', () => {
    expect(mensagemDoCampo('email', 'invalido', '')).toBe(textos.erro.email.invalido);
  });
});

describe('textos.erro', () => {
  it('só usa códigos que a API produz', () => {
    const permitidos: readonly string[] = CODIGOS_DE_CAMPO;
    for (const [campo, codigos] of Object.entries(textos.erro)) {
      for (const codigo of Object.keys(codigos)) {
        expect(permitidos, `erro.${campo}.${codigo}`).toContain(codigo);
      }
    }
  });

  it('todo texto está preenchido, sem espaço nas pontas', () => {
    for (const [campo, codigos] of Object.entries(textos.erro)) {
      for (const [codigo, texto] of Object.entries(codigos)) {
        expect(texto.trim(), `erro.${campo}.${codigo}`).toBe(texto);
        expect(texto, `erro.${campo}.${codigo}`).not.toBe('');
      }
    }
  });
});

// O que a API e a validação local realmente produzem, passado pela função (CA-13).
describe('mensagemDoCampo com os contratos de identidade', () => {
  type ErroDoZod = Parameters<typeof camposDoErroZod>[0];
  const textosDe = (resultado: { error?: ErroDoZod }) => {
    if (!resultado.error) throw new Error('o esquema deveria recusar o corpo');
    return camposDoErroZod(resultado.error).map(({ campo, codigo, motivo }) => ({
      campo,
      codigo,
      texto: mensagemDoCampo(campo, codigo, motivo),
    }));
  };

  it('login com e-mail e senha vazios: texto por chave, nunca "Campo obrigatório."', () => {
    const resultado = entrarSchema.safeParse({ email: '', senha: '', cliente: 'painel' });
    expect(textosDe(resultado)).toEqual([
      { campo: 'email', codigo: 'obrigatorio', texto: 'Informe seu e-mail' },
      { campo: 'senha', codigo: 'obrigatorio', texto: 'Informe sua senha' },
    ]);
  });

  it('e-mail sem @ vira o texto do campo', () => {
    const resultado = entrarSchema.safeParse({
      email: 'sem-arroba',
      senha: 'qualquer',
      cliente: 'painel',
    });
    expect(textosDe(resultado)).toEqual([
      { campo: 'email', codigo: 'invalido', texto: 'Confira o e-mail: falta o @ ou o domínio' },
    ]);
  });

  it('campo ausente no 2FA vira "Informe o código de 6 dígitos" ou o do código de recuperação', () => {
    const semNenhum = verificarSegundoFatorSchema.safeParse({ desafio: 'abc.def' });
    expect(textosDe(semNenhum)).toEqual([
      { campo: 'codigo', codigo: 'obrigatorio', texto: 'Informe o código de 6 dígitos' },
    ]);
  });

  it('o passo 2 da configuração do 2FA tem texto próprio para `codigo.invalido`', () => {
    const tela = 'configuracaoDoSegundoFator';
    expect(mensagemDoCampo('codigo', 'invalido', 'motivo', tela)).toBe(
      'Código não confere. Confira o horário do celular e digite o código atual.',
    );
    expect(mensagemDoCampo('codigo', 'invalido', 'motivo')).toBe(
      'Código inválido ou expirado. Confira o horário do celular e tente de novo.',
    );
    // Sem chave na tela, vale o texto geral; tela desconhecida (ou `constructor`) não quebra.
    expect(mensagemDoCampo('codigo', 'obrigatorio', 'm', tela)).toBe(
      textos.erro.codigo.obrigatorio,
    );
    expect(mensagemDoCampo('codigo', 'invalido', 'm', 'constructor' as TelaComTextoProprio)).toBe(
      textos.erro.codigo.invalido,
    );
  });

  it('código do autenticador mal digitado cai na chave `codigo.invalido`', () => {
    const resultado = verificarSegundoFatorSchema.safeParse({ desafio: 'abc.def', codigo: '12' });
    expect(textosDe(resultado)).toEqual([
      { campo: 'codigo', codigo: 'invalido', texto: textos.erro.codigo.invalido },
    ]);
  });

  it('campo desconhecido no corpo mostra o motivo em português da API', () => {
    const resultado = entrarSchema.safeParse({
      email: 'ana@exemplo.com.br',
      senha: 'qualquer',
      cliente: 'painel',
      admin: true,
    });
    expect(textosDe(resultado)).toEqual([
      { campo: 'admin', codigo: 'desconhecido', texto: 'Campo desconhecido.' },
    ]);
  });

  it('senha nova curta na redefinição mostra o motivo específico da API', () => {
    const resultado = redefinirSenhaSchema.safeParse({
      email: 'ana@exemplo.com.br',
      codigo: '123456',
      novaSenha: 'curta',
    });
    expect(textosDe(resultado)).toEqual([
      { campo: 'novaSenha', codigo: 'invalido', texto: 'Use 8 caracteres ou mais' },
    ]);
  });
});
