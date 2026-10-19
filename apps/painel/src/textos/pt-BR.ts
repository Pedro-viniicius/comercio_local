// Textos de interface do painel (pt-BR é o único idioma do MVP). Chaves por tela.
import { AVISO_ANTES_DO_FIM_MS } from '../sessao/inatividade.ts';

const MINUTOS_DE_AVISO = Math.round(AVISO_ANTES_DO_FIM_MS / 60_000);
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

  // Telas de autenticação do painel (spec 01, P1 a P1c) e a área protegida mínima (plano 01b,
  // etapa 15). Os textos dos banners de P1 são os mesmos para senha errada, conta inexistente e
  // bloqueio (CA-04): nada de contagem nem de "muitas tentativas".
  autenticacao: {
    tituloDaAba: (tela: string) => `${tela} · Bairrin Painel`,
    logo: 'Bairrin',
    abrindo: 'Carregando o painel…',
    saindo: 'Saindo…',
    sair: 'Sair',
    // D6: diz para onde vai.
    voltarParaEntrar: 'Voltar para entrar',
    tentarDeNovo: 'Tentar de novo',
    enviando: 'Enviando…',
    // Anúncio ao enviar com erros de campo (o foco vai para o primeiro).
    errosNoEnvio: (total: number) =>
      total === 1 ? 'Confira o campo destacado.' : `Confira os ${total} campos destacados.`,
    aviso: {
      credenciais:
        'Não foi possível entrar. Confira o e-mail e a senha ou tente de novo em alguns minutos.',
      servidor: 'Não conseguimos falar com o Bairrin agora. Tente de novo em instantes.',
      sessaoTerminou: 'Sua sessão terminou. Entre de novo para continuar.',
      // S23: a conta já passou pela senha; a mensagem não revela nada novo.
      semAcesso: 'Esta conta não tem acesso ao painel.',
      desafioVencido: 'O tempo para digitar o código acabou. Entre de novo.',
      senhaAlterada:
        'Senha alterada. Por segurança, saímos da sua conta em todos os aparelhos. Entre com a nova senha.',
      saiu: 'Você saiu da sua conta',
      // S80: a sessão local já foi limpa, mas a API não confirmou o logout.
      naoSaiu: 'Não foi possível sair. Verifique a conexão e tente de novo.',
    },
    entrar: {
      titulo: 'Entrar',
      email: 'E-mail',
      senha: 'Senha',
      botao: 'Entrar',
      esqueci: 'Esqueci minha senha',
    },
    segundoFator: {
      titulo: 'Código de verificação',
      instrucao: 'Abra o app autenticador e digite o código de 6 dígitos.',
      instrucaoRecuperacao:
        'Digite um dos códigos de recuperação que você guardou. Cada um funciona uma vez.',
      prazo: 'Você tem 5 minutos para digitar o código.',
      codigo: 'Código de 6 dígitos',
      codigoRecuperacao: 'Código de recuperação',
      botao: 'Verificar',
      usarRecuperacao: 'Usar um código de recuperação',
      usarApp: 'Usar o código do app autenticador',
    },
    configuracao: {
      titulo: 'Configurar verificação em duas etapas',
      // D4: o prazo vale até o primeiro código ser aceito (passo 2).
      prazo:
        'Você tem 5 minutos para escanear o QR code e digitar o primeiro código. Se o tempo acabar, entre de novo.',
      passo1: {
        titulo: 'Instale um app autenticador',
        texto:
          'Use Google Authenticator, Microsoft Authenticator, Authy ou outro de sua preferência.',
        botao: 'Já tenho, continuar',
      },
      passo2: {
        titulo: 'Escaneie o QR code',
        qr: 'QR code para configurar o app autenticador',
        prazo: 'O prazo de 5 minutos continua correndo. Se acabar, entre de novo.',
        semEscanear: 'Não consegue escanear? Digite esta chave:',
        copiarChave: 'Copiar chave',
        chaveCopiada: 'Chave copiada',
        codigo: 'Digite o código de 6 dígitos que aparece no app',
        botao: 'Confirmar',
      },
      passo3: {
        titulo: 'Guarde seus códigos de recuperação',
        // spec 01, chave `painel.2fa.passo3.aviso`.
        aviso:
          'Estes códigos aparecem só agora. Cada um funciona uma vez, se você perder o celular.',
        lista: 'Códigos de recuperação',
        copiarTodos: 'Copiar todos',
        copiados: 'Códigos copiados',
        baixar: 'Baixar (.txt)',
        baixado: 'Arquivo baixado',
        nomeDoArquivo: 'bairrin-codigos-recuperacao.txt',
        cabecalhoDoArquivo:
          'Códigos de recuperação do Bairrin Painel. Cada um funciona uma vez. Guarde em local seguro.',
        guardei: 'Guardei os códigos em local seguro',
        botao: 'Concluir e entrar',
        // D1 e S88: "Sair" no passo 3 sem a caixa marcada.
        confirmarSaida: {
          titulo: 'Sair sem guardar os códigos?',
          texto:
            'Eles não aparecem de novo. Sem eles, você só recupera o acesso com ajuda de quem cuida do sistema.',
          voltar: 'Voltar aos códigos',
          sair: 'Sair mesmo assim',
        },
      },
      naoCopiou: 'Não foi possível copiar. Selecione o texto e copie à mão.',
    },
    recuperacao: {
      titulo: 'Recuperar senha',
      texto: 'Informe o e-mail da sua conta. Enviaremos um código para criar uma nova senha.',
      email: 'E-mail',
      enviar: 'Enviar código',
      enviado: (email: string) =>
        `Se houver uma conta para ${email}, você vai receber um código em instantes. Ele vale por 30 minutos.`,
      codigo: 'Código de 6 dígitos',
      novaSenha: 'Nova senha',
      novaSenhaAjuda: 'Use 8 caracteres ou mais.',
      salvar: 'Salvar nova senha',
      reenviar: 'Reenviar código',
      reenviarEm: (tempo: string) => `Reenviar código (${tempo})`,
      reenvioLiberado: 'Você já pode reenviar o código.',
      reenviado: 'Se houver uma conta para este e-mail, enviamos um novo código.',
      limite: 'Não foi possível enviar o código agora. Tente de novo em alguns minutos.',
    },
    inicio: {
      titulo: 'Início',
      carregando: 'Carregando sua conta…',
      conta: (emailMascarado: string) => `Você entrou como ${emailMascarado}.`,
      // D5: o número vem da constante do relógio de inatividade.
      expirando: `Sua sessão vai expirar em ${MINUTOS_DE_AVISO} ${MINUTOS_DE_AVISO === 1 ? 'minuto' : 'minutos'} por falta de uso.`,
      continuar: 'Continuar conectado',
      // D2: a renovação de "Continuar conectado" falhou (rede, 5xx); o aviso continua na tela.
      naoContinuou: 'Não foi possível continuar conectado. Verifique a conexão e tente de novo.',
    },
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
    // P1c (spec 01, A4): o código chegou por e-mail; o texto geral fala do app autenticador.
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
