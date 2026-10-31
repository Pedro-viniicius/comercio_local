// Textos de interface compartilhados pelos dois apps (pt-BR é o único idioma do MVP). Nenhum texto
// fica solto no componente. Chaves da spec 01 (`docs/produto/specs/01-fundacao-identidade.md`,
// "Textos da interface") e do design system; o título de cada app fica em `apps/*/src/textos`.
export const textos = {
  estadoDaApi: {
    secao: 'Estado da API',
    verificando: 'Verificando a API…',
    disponivel: 'API disponível',
    semConexao: 'Sem conexão',
    semConexaoDica: 'Verifique sua internet e tente de novo.',
    erroDaApi: 'A API respondeu com erro',
    erroDaApiDica: 'Tente de novo em instantes.',
    semConfiguracao: 'Endereço da API não configurado',
    semConfiguracaoDica: 'O app não está configurado. Avise quem cuida do sistema.',
    tentarDeNovo: 'Tentar de novo',
    verificandoBotao: 'Verificando…',
  },

  // Rótulos que os componentes de `src/componentes` usam quando a tela não diz outro.
  componentes: {
    voltar: 'Voltar',
    fechar: 'Fechar',
    // Nome acessível do "Fechar" do Banner; começa com o texto visível (WCAG 2.5.3).
    fecharAviso: 'Fechar aviso',
    // Texto visível do botão da senha; o nome acessível é "Mostrar senha" ou "Ocultar senha".
    mostrar: 'Mostrar',
    ocultar: 'Ocultar',
    mostrarSenha: 'Mostrar senha',
    ocultarSenha: 'Ocultar senha',
    senhaVisivel: 'Senha visível',
    senhaOculta: 'Senha oculta',
    abrirLink: (texto: string) => `Abrir ${texto}`,
    enviando: 'Enviando…',
    // Prefixo lido antes da mensagem de erro do campo (o símbolo "!" não é lido).
    erroDoCampo: 'Erro',
    // Anúncio ao enviar com erros de campo (o foco vai para o primeiro).
    errosNoEnvio: (total: number) =>
      total === 1 ? '1 campo precisa de atenção' : `${total} campos precisam de atenção`,
    codigo: {
      rotulo: 'Código de 6 dígitos',
      // Lido a cada dígito: "2 de 6 dígitos" não cabe no valor, então vai como dica.
      dica: 'Digite os 6 dígitos. O envio é automático ao completar.',
    },
    faixaOffline: {
      mensagem: 'Você está offline. Mostrando o que foi carregado por último.',
      tentarDeNovo: 'Tentar de novo',
      // Toast de sucesso quando a conexão volta (design system, "Faixa offline").
      reconectado: 'Conectado de novo',
    },
    marca: {
      nome: 'Bairrin',
      sloganConsumidor: 'lojas do seu bairro',
      sloganLojista: 'venda para o seu bairro',
    },
    textoLegal: {
      versao: (versao: string, vigenteDesde: string) =>
        `Versão ${versao} · vigente desde ${vigenteDesde}`,
      versaoSemData: (versao: string) => `Versão ${versao}`,
      voltarAoTopo: 'Voltar ao topo',
    },
  },

  // Chaves sugeridas pela spec 01 (conta e privacidade). As telas da etapa 14 as usam.
  conta: {
    entrar: {
      titulo: 'Entrar',
      tituloContinuar: 'Entre para continuar',
      tituloFecharPedido: 'Entre para fechar seu pedido',
    },
    erro: {
      credenciais:
        'Não foi possível entrar. Confira o e-mail e a senha ou tente de novo em alguns minutos.',
      servidor: 'Não conseguimos falar com o Bairrin agora. Tente de novo em instantes.',
      offline: 'Sem conexão: tente quando voltar',
    },
    cadastro: {
      titulo: 'Criar conta',
      telefoneAjuda: 'Usamos para a loja falar com você sobre o pedido.',
      botao: 'Criar conta',
    },
    verificacao: {
      reenviado: 'Se houver uma conta para este e-mail, enviamos um novo código.',
      sucesso: 'Conta confirmada. Boas-vindas ao Bairrin!',
    },
    codigo: {
      invalido: 'Código inválido ou expirado. Confira ou peça um novo.',
    },
    sessao: {
      terminou: 'Sua sessão terminou. Entre de novo para continuar.',
    },
    sair: {
      toast: 'Você saiu da sua conta',
    },
  },

  privacidade: {
    copia: {
      recebida:
        'Pedido recebido. Avisamos por e-mail quando a cópia estiver pronta, em até 48 horas. O download é nesta tela, por 7 dias.',
      pronta: (validade: string) =>
        `Sua cópia está pronta · vale até ${validade} (horário de Brasília)`,
      baixar: 'Baixar cópia',
    },
    exclusao: {
      botao: 'Excluir minha conta',
    },
  },

  // Erro de campo, por `erro.<campo>.<codigo>` (`campos[]` do Problema, CA-13). O campo é o nome
  // que a API usa; o código é um de `CODIGOS_DE_CAMPO` de `@bairrin/contratos`. Quem escolhe o
  // texto é `mensagemDoCampo` (`mensagem-do-campo.ts`), que cai no `motivo` da API sem a chave.
  //
  // Falta de chave é de propósito onde o `motivo` já é o texto final e varia: `nome.invalido`
  // (longo demais ou caractere que não pode), `senha.invalido` e `novaSenha.invalido` (curta,
  // longa, caractere que não pode, ou "Senha incorreta" na exclusão) e `senha.comum` e
  // `novaSenha.comum` (a API varia o motivo). O código `desconhecido` não tem texto por campo: é
  // erro do cliente, não da pessoa.
  erro: {
    nome: {
      obrigatorio: 'Informe seu nome',
    },
    email: {
      obrigatorio: 'Informe seu e-mail',
      invalido: 'Confira o e-mail: falta o @ ou o domínio',
    },
    telefone: {
      obrigatorio: 'Informe o celular com DDD',
      invalido: 'Confira o número: use DDD + 9 dígitos, como (35) 99999-1234',
    },
    senha: {
      obrigatorio: 'Informe sua senha',
    },
    novaSenha: {
      obrigatorio: 'Crie uma nova senha',
    },
    // Campo local do cadastro: a caixa de aceite dos Termos e da Política (A2).
    aceite: {
      obrigatorio: 'Para criar a conta, aceite os Termos e a Política',
    },
    codigo: {
      obrigatorio: 'Informe o código de 6 dígitos',
      // A3 (código de e-mail); a recuperação de senha usa `erroPorTela.recuperacaoDeSenha`.
      invalido: 'Código inválido ou expirado. Confira ou peça um novo.',
    },
  },

  // Texto próprio de uma tela quando o mesmo `campo.codigo` pede outra frase. A tela passa o nome
  // dela como 4º argumento de `mensagemDoCampo`; sem a chave, vale `erro`.
  erroPorTela: {
    // A2: o cadastro pede "Crie uma senha"; o login (A1) diz "Informe sua senha".
    cadastro: {
      senha: {
        obrigatorio: 'Crie uma senha',
      },
    },
    // A4: o botão se chama "Reenviar código", então a frase pede um novo.
    recuperacaoDeSenha: {
      codigo: {
        invalido: 'Código inválido ou expirado. Peça um novo.',
      },
    },
  },

  // Último recurso de `mensagemDoCampo`: nem a chave nem o `motivo` da API trouxeram texto.
  erroDeCampo: {
    semMotivo: 'Confira este campo',
  },
} as const;
