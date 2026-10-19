// Textos de interface do painel (pt-BR é o único idioma do MVP). Chaves por tela.
export const textos = {
  estadoDaApi: {
    titulo: 'Bairrin Painel',
    secao: 'Estado da API',
    verificando: 'Verificando a API…',
    disponivel: 'API disponível',
    semConexao: 'Sem conexão',
    semConexaoDica: 'Verifique sua internet e tente de novo.',
    erroDaApi: 'A API respondeu com erro',
    erroDaApiDica: 'Tente de novo em instantes.',
    semConfiguracao: 'Endereço da API não configurado',
    semConfiguracaoDica: 'O painel não está configurado. Avise quem cuida do sistema.',
    tentarDeNovo: 'Tentar de novo',
    verificandoBotao: 'Verificando…',
  },

  // Rótulos que os componentes de `src/componentes` usam quando a tela não diz outro.
  componentes: {
    fechar: 'Fechar',
    mostrarSenha: 'Mostrar senha',
    ocultarSenha: 'Ocultar senha',
    senhaVisivel: 'Senha visível',
    senhaOculta: 'Senha oculta',
    enviando: 'Enviando…',
    // Nome acessível do "Fechar" do Banner; começa com o texto visível (WCAG 2.5.3).
    fecharAviso: 'Fechar aviso',
    fecharAvisoCom: (titulo: string) => `Fechar aviso: ${titulo}`,
    passo: (numero: number, total: number) => `Passo ${numero} de ${total}`,
  },

  // Erro de campo, por `erro.<campo>.<codigo>` (`campos[]` do Problema, CA-13). O campo é o nome
  // que a API usa; o código é um de `CODIGOS_DE_CAMPO` de `@bairrin/contratos`. Quem escolhe o
  // texto é `mensagemDoCampo` (`mensagem-do-campo.ts`), que cai no `motivo` da API sem a chave.
  //
  // Falta de chave é de propósito onde o `motivo` já é o texto final e varia: `senha.invalido`
  // e `novaSenha.invalido` (curta, longa, caractere que não pode) e `novaSenha.comum` e
  // `senha.comum` (a API varia o motivo, como "Use letras também: …"). O código `desconhecido` não tem texto por campo: é erro do cliente, não da pessoa.
  erro: {
    email: {
      obrigatorio: 'Informe seu e-mail',
      invalido: 'Confira o e-mail: falta o @ ou o domínio',
    },
    senha: {
      obrigatorio: 'Informe sua senha',
    },
    novaSenha: {
      obrigatorio: 'Crie uma nova senha',
    },
    codigo: {
      obrigatorio: 'Informe o código de 6 dígitos',
      // P1a (entrada com o app autenticador). O passo 2 da configuração usa `erroPorTela`.
      invalido: 'Código inválido ou expirado. Confira o horário do celular e tente de novo.',
    },
    codigoRecuperacao: {
      obrigatorio: 'Informe o código de recuperação',
      invalido: 'Código de recuperação inválido. Confira e tente de novo.',
    },
  },

  // Texto próprio de uma tela quando o mesmo `campo.codigo` pede outra frase (spec 01, P1b passo 2).
  // A tela passa o nome dela como 4º argumento de `mensagemDoCampo`; sem a chave, vale `erro`.
  erroPorTela: {
    configuracaoDoSegundoFator: {
      codigo: {
        invalido: 'Código não confere. Confira o horário do celular e digite o código atual.',
      },
    },
  },

  // Último recurso de `mensagemDoCampo`: nem a chave nem o `motivo` da API trouxeram texto.
  erroDeCampo: {
    semMotivo: 'Confira este campo',
  },
} as const;
