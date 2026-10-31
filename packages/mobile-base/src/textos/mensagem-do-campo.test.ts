import {
  CODIGOS_DE_CAMPO,
  camposDoErroZod,
  criarContaSchema,
  entrarSchema,
  redefinirSenhaSchema,
  solicitarExclusaoSchema,
  verificarEmailSchema,
} from '@bairrin/contratos';
import { mensagemDoCampo } from './mensagem-do-campo.ts';
import { textos } from './pt-BR.ts';

describe('mensagemDoCampo', () => {
  it('usa o texto de `erro.<campo>.<codigo>`, não o motivo da API (CA-13)', () => {
    expect(mensagemDoCampo('nome', 'obrigatorio', 'Campo obrigatório.')).toBe('Informe seu nome');
    expect(mensagemDoCampo('email', 'obrigatorio', 'Campo obrigatório.')).toBe(
      'Informe seu e-mail',
    );
    expect(mensagemDoCampo('email', 'invalido', 'Texto técnico qualquer')).toBe(
      'Confira o e-mail: falta o @ ou o domínio',
    );
    expect(mensagemDoCampo('telefone', 'obrigatorio', 'Campo obrigatório.')).toBe(
      'Informe o celular com DDD',
    );
    expect(mensagemDoCampo('telefone', 'invalido', 'qualquer')).toBe(
      'Confira o número: use DDD + 9 dígitos, como (35) 99999-1234',
    );
    expect(mensagemDoCampo('senha', 'obrigatorio', 'Campo obrigatório.')).toBe('Informe sua senha');
    expect(mensagemDoCampo('aceite', 'obrigatorio', 'qualquer')).toBe(
      'Para criar a conta, aceite os Termos e a Política',
    );
    expect(mensagemDoCampo('codigo', 'obrigatorio', 'Campo obrigatório.')).toBe(
      'Informe o código de 6 dígitos',
    );
    expect(mensagemDoCampo('codigo', 'invalido', 'qualquer')).toBe(
      'Código inválido ou expirado. Confira ou peça um novo.',
    );
  });

  it('onde o motivo da API já é o texto final, cai nele (senha, nome longo, senha comum)', () => {
    expect(mensagemDoCampo('senha', 'invalido', 'Use até 128 caracteres')).toBe(
      'Use até 128 caracteres',
    );
    expect(mensagemDoCampo('novaSenha', 'invalido', 'Use 8 caracteres ou mais')).toBe(
      'Use 8 caracteres ou mais',
    );
    expect(mensagemDoCampo('novaSenha', 'comum', 'Use letras também: …')).toBe(
      'Use letras também: …',
    );
    expect(mensagemDoCampo('nome', 'invalido', 'Use até 80 caracteres')).toBe(
      'Use até 80 caracteres',
    );
    expect(mensagemDoCampo('senha', 'invalido', 'Senha incorreta')).toBe('Senha incorreta');
  });

  it('campo ou código que o app não conhece (API mais nova) mostra o motivo', () => {
    expect(mensagemDoCampo('apelido', 'invalido', 'Use até 20 caracteres')).toBe(
      'Use até 20 caracteres',
    );
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

describe('mensagemDoCampo com tela', () => {
  it('o cadastro diz "Crie uma senha" e o login, "Informe sua senha"', () => {
    expect(mensagemDoCampo('senha', 'obrigatorio', 'm', 'cadastro')).toBe('Crie uma senha');
    expect(mensagemDoCampo('senha', 'obrigatorio', 'm')).toBe('Informe sua senha');
  });

  it('a recuperação de senha pede um código novo; a verificação, "confira ou peça um novo"', () => {
    expect(mensagemDoCampo('codigo', 'invalido', 'm', 'recuperacaoDeSenha')).toBe(
      'Código inválido ou expirado. Peça um novo.',
    );
    expect(mensagemDoCampo('codigo', 'invalido', 'm')).toBe(
      'Código inválido ou expirado. Confira ou peça um novo.',
    );
  });

  it('o que a tela não tem continua com o texto geral', () => {
    expect(mensagemDoCampo('codigo', 'obrigatorio', 'm', 'recuperacaoDeSenha')).toBe(
      textos.erro.codigo.obrigatorio,
    );
    expect(mensagemDoCampo('email', 'invalido', 'm', 'cadastro')).toBe(textos.erro.email.invalido);
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', '', 'entrar'])(
    'tela "%s" que não existe cai no texto geral, sem achar propriedade herdada',
    (tela) => {
      expect(mensagemDoCampo('codigo', 'invalido', 'm', tela)).toBe(textos.erro.codigo.invalido);
    },
  );

  it.each(['constructor', '__proto__', 'toString'])(
    'campo ou código "%s" dentro de uma tela real cai no motivo da API',
    (hostil) => {
      expect(mensagemDoCampo(hostil, 'invalido', 'motivo da API', 'cadastro')).toBe(
        'motivo da API',
      );
      expect(mensagemDoCampo('senha', hostil, 'motivo da API', 'cadastro')).toBe('motivo da API');
    },
  );
});

describe('textos.erro', () => {
  // Chave completa (`erro.email.invalido`, `erroPorTela.cadastro.senha.obrigatorio`), campo, código e texto.
  const grupos: Record<string, Record<string, Record<string, string>>> = {
    erro: textos.erro,
    ...Object.fromEntries(
      Object.entries(textos.erroPorTela).map(([tela, campos]) => [`erroPorTela.${tela}`, campos]),
    ),
  };
  const entradas = Object.entries(grupos).flatMap(([grupo, campos]) =>
    Object.entries(campos).flatMap(([campo, codigos]) =>
      Object.entries(codigos).map(
        ([codigo, texto]) => [`${grupo}.${campo}.${codigo}`, codigo, texto] as const,
      ),
    ),
  );

  it('tem as chaves da spec', () => {
    expect(entradas.length).toBeGreaterThanOrEqual(10);
  });

  it.each(entradas)('%s usa um código que a API produz', (_chave, codigo) => {
    const permitidos: readonly string[] = CODIGOS_DE_CAMPO;
    expect(permitidos).toContain(codigo);
  });

  it.each(entradas)('%s está preenchido, sem espaço nas pontas', (_chave, _codigo, texto) => {
    expect(texto.trim()).toBe(texto);
    expect(texto).not.toBe('');
  });
});

// O que a API e a validação local realmente produzem, passado pela função (CA-13).
describe('mensagemDoCampo com os contratos de identidade', () => {
  type ErroDoZod = Parameters<typeof camposDoErroZod>[0];
  const textosDe = (resultado: { error?: ErroDoZod }, tela?: string) => {
    if (!resultado.error) throw new Error('o esquema deveria recusar o corpo');
    return camposDoErroZod(resultado.error).map(({ campo, codigo, motivo }) => ({
      campo,
      codigo,
      texto: mensagemDoCampo(campo, codigo, motivo, tela),
    }));
  };

  const contaValida = {
    nome: 'Ana Souza',
    email: 'ana@exemplo.com.br',
    telefone: '(35) 99999-1234',
    senha: 'uma senha boa 2026',
    aceites: { termos: '1.0', privacidade: '1.0' },
  };

  it('cadastro com tudo vazio: o texto de cada campo, nunca "Campo obrigatório."', () => {
    const resultado = criarContaSchema.safeParse({
      ...contaValida,
      nome: '',
      email: '',
      telefone: '',
      senha: '',
    });
    expect(textosDe(resultado, 'cadastro')).toEqual([
      { campo: 'nome', codigo: 'obrigatorio', texto: 'Informe seu nome' },
      { campo: 'email', codigo: 'obrigatorio', texto: 'Informe seu e-mail' },
      { campo: 'telefone', codigo: 'obrigatorio', texto: 'Informe o celular com DDD' },
      { campo: 'senha', codigo: 'obrigatorio', texto: 'Crie uma senha' },
    ]);
  });

  it('cadastro com e-mail e celular mal digitados vira o texto dos campos', () => {
    const resultado = criarContaSchema.safeParse({
      ...contaValida,
      email: 'sem-arroba',
      telefone: '123',
    });
    expect(textosDe(resultado, 'cadastro')).toEqual([
      { campo: 'email', codigo: 'invalido', texto: 'Confira o e-mail: falta o @ ou o domínio' },
      {
        campo: 'telefone',
        codigo: 'invalido',
        texto: 'Confira o número: use DDD + 9 dígitos, como (35) 99999-1234',
      },
    ]);
  });

  it('senha curta e nome longo mostram o motivo específico da API', () => {
    const resultado = criarContaSchema.safeParse({
      ...contaValida,
      senha: 'curta',
      nome: 'A'.repeat(81),
    });
    expect(textosDe(resultado, 'cadastro')).toEqual([
      { campo: 'nome', codigo: 'invalido', texto: 'Use até 80 caracteres' },
      { campo: 'senha', codigo: 'invalido', texto: 'Use 8 caracteres ou mais' },
    ]);
  });

  it('login com e-mail e senha vazios: "Informe sua senha" (sem tela)', () => {
    const resultado = entrarSchema.safeParse({ email: '', senha: '', cliente: 'app_consumidor' });
    expect(textosDe(resultado)).toEqual([
      { campo: 'email', codigo: 'obrigatorio', texto: 'Informe seu e-mail' },
      { campo: 'senha', codigo: 'obrigatorio', texto: 'Informe sua senha' },
    ]);
  });

  it('código de e-mail ausente ou mal digitado', () => {
    expect(textosDe(verificarEmailSchema.safeParse({ codigo: '' }))).toEqual([
      { campo: 'codigo', codigo: 'obrigatorio', texto: 'Informe o código de 6 dígitos' },
    ]);
    expect(textosDe(verificarEmailSchema.safeParse({ codigo: '12' }))).toEqual([
      {
        campo: 'codigo',
        codigo: 'invalido',
        texto: 'Código inválido ou expirado. Confira ou peça um novo.',
      },
    ]);
  });

  it('redefinição de senha: código com o texto da tela e senha nova com o motivo', () => {
    const resultado = redefinirSenhaSchema.safeParse({
      email: 'ana@exemplo.com.br',
      codigo: '12',
      novaSenha: 'curta',
    });
    expect(textosDe(resultado, 'recuperacaoDeSenha')).toEqual([
      { campo: 'codigo', codigo: 'invalido', texto: 'Código inválido ou expirado. Peça um novo.' },
      { campo: 'novaSenha', codigo: 'invalido', texto: 'Use 8 caracteres ou mais' },
    ]);
  });

  it('exclusão sem senha pede a senha', () => {
    expect(textosDe(solicitarExclusaoSchema.safeParse({ senha: '' }))).toEqual([
      { campo: 'senha', codigo: 'obrigatorio', texto: 'Informe sua senha' },
    ]);
  });

  it('campo desconhecido no corpo mostra o motivo em português da API', () => {
    const resultado = entrarSchema.safeParse({
      email: 'ana@exemplo.com.br',
      senha: 'qualquer',
      cliente: 'app_consumidor',
      admin: true,
    });
    expect(textosDe(resultado)).toEqual([
      { campo: 'admin', codigo: 'desconhecido', texto: 'Campo desconhecido.' },
    ]);
  });
});
