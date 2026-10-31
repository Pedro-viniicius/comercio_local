// Textos da spec 01 ("Textos da interface"): as frases estão escritas por extenso aqui para o
// teste não repetir o `pt-BR.ts` que confere.
import { textos } from './pt-BR.ts';

describe('textos compartilhados dos apps', () => {
  it('conta: títulos, erros e avisos da spec 01', () => {
    expect(textos.conta.entrar.titulo).toBe('Entrar');
    expect(textos.conta.entrar.tituloContinuar).toBe('Entre para continuar');
    expect(textos.conta.entrar.tituloFecharPedido).toBe('Entre para fechar seu pedido');
    expect(textos.conta.erro.credenciais).toBe(
      'Não foi possível entrar. Confira o e-mail e a senha ou tente de novo em alguns minutos.',
    );
    expect(textos.conta.erro.servidor).toBe(
      'Não conseguimos falar com o Bairrin agora. Tente de novo em instantes.',
    );
    expect(textos.conta.erro.offline).toBe('Sem conexão: tente quando voltar');
    expect(textos.conta.cadastro.titulo).toBe('Criar conta');
    expect(textos.conta.cadastro.telefoneAjuda).toBe(
      'Usamos para a loja falar com você sobre o pedido.',
    );
    expect(textos.conta.cadastro.botao).toBe('Criar conta');
    expect(textos.conta.verificacao.reenviado).toBe(
      'Se houver uma conta para este e-mail, enviamos um novo código.',
    );
    expect(textos.conta.verificacao.sucesso).toBe('Conta confirmada. Boas-vindas ao Bairrin!');
    expect(textos.conta.codigo.invalido).toBe(
      'Código inválido ou expirado. Confira ou peça um novo.',
    );
    expect(textos.conta.sessao.terminou).toBe('Sua sessão terminou. Entre de novo para continuar.');
    expect(textos.conta.sair.toast).toBe('Você saiu da sua conta');
  });

  it('privacidade: pedido recebido, cópia pronta e exclusão', () => {
    expect(textos.privacidade.copia.recebida).toBe(
      'Pedido recebido. Avisamos por e-mail quando a cópia estiver pronta, em até 48 horas. O download é nesta tela, por 7 dias.',
    );
    expect(textos.privacidade.copia.pronta('30/10/2026 às 14:32')).toBe(
      'Sua cópia está pronta · vale até 30/10/2026 às 14:32 (horário de Brasília)',
    );
    expect(textos.privacidade.copia.baixar).toBe('Baixar cópia');
    expect(textos.privacidade.exclusao.botao).toBe('Excluir minha conta');
  });

  it('componentes: faixa offline, marca e leitor de texto legal', () => {
    expect(textos.componentes.faixaOffline.mensagem).toBe(
      'Você está offline. Mostrando o que foi carregado por último.',
    );
    expect(textos.componentes.faixaOffline.reconectado).toBe('Conectado de novo');
    expect(textos.componentes.marca.sloganConsumidor).toBe('lojas do seu bairro');
    expect(textos.componentes.marca.sloganLojista).toBe('venda para o seu bairro');
    expect(textos.componentes.textoLegal.versao('1.0', '16/10/2026')).toBe(
      'Versão 1.0 · vigente desde 16/10/2026',
    );
    expect(textos.componentes.errosNoEnvio(1)).toBe('1 campo precisa de atenção');
    expect(textos.componentes.errosNoEnvio(2)).toBe('2 campos precisam de atenção');
  });

  it('o texto do erro do código e da conta é o mesmo da spec, por uma chave só de cada lado', () => {
    expect(textos.erro.codigo.invalido).toBe(textos.conta.codigo.invalido);
  });
});
