// CA-12 e S10 pela API inteira (plano 01b, etapa 19): nenhum erro, linha de log, evento da
// outbox ou envelope do Sentry leva e-mail, telefone, nome, senha, token ou código.
//
// O teste percorre as recusas das rotas da Identidade (400, 401, 403, 404, 409, 429) e um
// erro inesperado (500) cuja mensagem traz os dados da conta, como faria o erro de uma
// biblioteca de banco com os parâmetros da consulta. O Sentry fica ligado com as opções de
// produção e um transport falso (`test/helpers/sentry-falso.ts`), e o interceptador entra
// na aplicação como no `main.ts`. No fim, a varredura (`test/helpers/captura-de-log.ts`)
// procura cada valor sensível, em várias formas, em:
// - toda resposta de erro (corpo e cabeçalhos);
// - todo o log da aplicação, inclusive o das respostas de sucesso (a cópia dos dados, a
//   sessão e a conta não podem ir para o log);
// - os eventos da outbox da conta (payload só com ids);
// - os envelopes que sairiam para o Sentry.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { InterceptadorDoSentry } from '../../../src/compartilhado/observabilidade/sentry.ts';
import { ConsultarPrivacidadeCasoDeUso } from '../../../src/modulos/identidade/aplicacao/privacidade/consultar-privacidade.ts';
import { RegistroDePendencias } from '../../../src/modulos/identidade/aplicacao/portas/verificador-de-pendencias.ts';
import { GerarExportacaoCasoDeUso } from '../../../src/modulos/identidade/aplicacao/privacidade/gerar-exportacao.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import { sensiveisEncontrados, type ValorSensivel } from '../../helpers/captura-de-log.ts';
import { ligarSentryFalso } from '../../helpers/sentry-falso.ts';
import { problemaDe, sessaoDe } from './api-http.ts';
import { SENHA_QUE_NAO_CONFERE, usarCenarioHttp, valoresPessoaisDe } from './cenario-http.ts';
import { eventosDaConta, inserirCodigo } from './pilha-de-casos-de-uso.ts';

const sentry = ligarSentryFalso();
const cenario = usarCenarioHttp({
  antesDeIniciar: (app) => app.useGlobalInterceptors(new InterceptadorDoSentry()),
});

afterAll(async () => {
  await sentry.desligar();
});

interface RespostaRegistrada {
  readonly fonte: string;
  readonly status: number;
  readonly texto: string;
}

describe('CA-12: nenhum dado pessoal, senha, token ou código em erro, log, evento ou Sentry', () => {
  it('percorre as recusas e um erro inesperado, e varre tudo o que saiu', async () => {
    const { http } = cenario.api;
    const respostas: RespostaRegistrada[] = [];
    const registrar = (
      fonte: string,
      resposta: { status: number; text: string; headers: Record<string, unknown> },
    ) => {
      respostas.push({
        fonte: `${fonte} → ${resposta.status}`,
        status: resposta.status,
        texto: `${resposta.text}\n${JSON.stringify(resposta.headers)}`,
      });
      return resposta;
    };
    const bearer = (token: string) => `Bearer ${token}`;

    // Cadastro pela rota, com o celular como a pessoa digita.
    const conta = await cenario.novaConta();
    await cenario.p.repos.contas
      .buscarPorEmail(Email.criar(conta.email))
      .then((lida) => expect(lida?.id).toBe(conta.id));
    const digitado = conta.telefone.replace(/^\+55(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
    registrar(
      'cadastro repetido',
      await http
        .post('/v1/contas')
        .set('X-Forwarded-For', cenario.ip())
        .send({
          nome: conta.nome,
          email: conta.email,
          telefone: digitado,
          senha: conta.senha,
          aceites: {
            termos: cenario.docs.termos.versao,
            privacidade: cenario.docs.privacidade.versao,
          },
        }),
    );
    registrar(
      'cadastro com versão errada',
      await http
        .post('/v1/contas')
        .set('X-Forwarded-For', cenario.ip())
        .send({
          nome: conta.nome,
          email: conta.email,
          telefone: digitado,
          senha: conta.senha,
          aceites: { termos: 'versao-velha', privacidade: 'versao-velha' },
        }),
    );

    // Login: senha errada (401), certa (200), painel sem admin (403).
    registrar(
      'login com senha errada',
      await http
        .post('/v1/sessoes')
        .set('X-Forwarded-For', cenario.ip())
        .send({ email: conta.email, senha: SENHA_QUE_NAO_CONFERE, cliente: 'app_consumidor' }),
    );
    registrar(
      'login no painel sem admin',
      await http
        .post('/v1/sessoes')
        .set('X-Forwarded-For', cenario.ip())
        .send({ email: conta.email, senha: conta.senha, cliente: 'painel' }),
    );
    const sessao = await cenario.entrarNoApp(conta);
    const autorizacao = bearer(sessao.tokenAcesso);

    // Verificação com código errado (400), reenvio até o limite (429), admin (403).
    const codigoDigitado = '904127';
    registrar(
      'verificação com código errado',
      await http
        .post('/v1/conta/verificacao-email')
        .set('Authorization', autorizacao)
        .send({ codigo: codigoDigitado }),
    );
    for (let vez = 0; vez < 4; vez += 1) {
      registrar(
        'reenvio',
        await http
          .post('/v1/conta/verificacao-email/reenvio')
          .set('Authorization', autorizacao)
          .set('X-Forwarded-For', cenario.ip()),
      );
    }
    registrar(
      'admin sem permissão',
      await http.get('/v1/admin/conta').set('Authorization', autorizacao),
    );
    registrar(
      'renovação com o token de acesso no lugar',
      await http
        .post('/v1/sessoes/renovacao')
        .send({ tokenRenovacao: sessao.tokenAcesso, cliente: 'app_consumidor' }),
    );

    // Conta, privacidade e a cópia dos dados (o arquivo leva tudo: não pode ir para o log).
    await http.get('/v1/conta').set('Authorization', autorizacao).expect(200);
    await http.post('/v1/privacidade/exportacao').set('Authorization', autorizacao).expect(202);
    registrar(
      'exportação repetida',
      await http.post('/v1/privacidade/exportacao').set('Authorization', autorizacao),
    );
    registrar(
      'download antes de a cópia ficar pronta',
      await http.get('/v1/privacidade/exportacao/arquivo').set('Authorization', autorizacao),
    );
    const pedido = (await eventosDaConta(cenario.dono, conta.id)).find(
      ({ tipo }) => tipo === 'identidade.ExportacaoSolicitada',
    );
    const { solicitacaoId } = pedido?.payload as { solicitacaoId: string };
    await cenario.api.app
      .get(GerarExportacaoCasoDeUso)
      .executar({ contaId: conta.id, solicitacaoId });
    const arquivo = await http
      .get('/v1/privacidade/exportacao/arquivo')
      .set('Authorization', autorizacao)
      .expect(200);
    expect(arquivo.text).toContain(conta.email);

    // Erro inesperado com os dados da conta na mensagem (como o de um driver de banco).
    const consultar = cenario.api.app.get(ConsultarPrivacidadeCasoDeUso);
    vi.spyOn(consultar, 'executar').mockRejectedValueOnce(
      new Error(
        `consulta falhou: params=[${conta.email}, ${conta.nome}, ${conta.telefone}, ${conta.senha}]`,
      ),
    );
    const falha = registrar(
      'erro inesperado',
      await http.get('/v1/privacidade').set('Authorization', autorizacao),
    );
    expect(falha.status).toBe(500);
    expect(problemaDe(JSON.parse(falha.text)).codigo).toBe('erro_interno');

    // Recuperação e redefinição com código errado.
    await http
      .post('/v1/senha/recuperacao')
      .set('X-Forwarded-For', cenario.ip())
      .send({ email: conta.email })
      .expect(202);
    await inserirCodigo(cenario.p, conta.id, 'recuperacao_senha', '615283');
    registrar(
      'redefinição com código errado',
      await http
        .post('/v1/senha/redefinicao')
        .set('X-Forwarded-For', cenario.ip())
        .send({ email: conta.email, codigo: codigoDigitado, novaSenha: 'lampada-roxa-trilho-63' }),
    );

    // Exclusão: senha errada (400), com pendência (409) e certa (202); depois, o token
    // não vale (401).
    registrar(
      'exclusão com senha errada',
      await http
        .post('/v1/privacidade/exclusao')
        .set('Authorization', autorizacao)
        .send({ senha: SENHA_QUE_NAO_CONFERE }),
    );
    // Com pendência de outro módulo, a senha certa recebe 409 e a conta segue (CA-11).
    const comPendencia = new Set([conta.id]);
    cenario.api.app.get(RegistroDePendencias).registrar({
      modulo: 'pedidos-de-teste',
      pendenciasDaConta: (contaId) =>
        Promise.resolve(
          comPendencia.has(contaId)
            ? [{ modulo: 'pedidos-de-teste', tipo: 'pedido_em_andamento' }]
            : [],
        ),
    });
    registrar(
      'exclusão com pendência',
      await http
        .post('/v1/privacidade/exclusao')
        .set('Authorization', autorizacao)
        .send({ senha: conta.senha }),
    );
    comPendencia.clear();
    await http
      .post('/v1/privacidade/exclusao')
      .set('Authorization', autorizacao)
      .send({ senha: conta.senha })
      .expect(202);
    registrar(
      'conta depois da exclusão',
      await http.get('/v1/conta').set('Authorization', autorizacao),
    );
    registrar(
      'login depois da exclusão',
      await http
        .post('/v1/sessoes')
        .set('X-Forwarded-For', cenario.ip())
        .send({ email: conta.email, senha: conta.senha, cliente: 'app_consumidor' }),
    );

    // Todas as recusas esperadas aconteceram.
    const status = new Set(respostas.map((resposta) => resposta.status));
    for (const esperado of [400, 401, 403, 404, 409, 429, 500]) expect(status).toContain(esperado);

    await sentry.esvaziar();
    expect(sentry.eventos().length).toBeGreaterThanOrEqual(1);

    const sensiveis: ValorSensivel[] = [
      ...valoresPessoaisDe(conta),
      { rotulo: 'celular digitado', valor: digitado },
      { rotulo: 'senha errada', valor: SENHA_QUE_NAO_CONFERE },
      { rotulo: 'token de acesso', valor: sessao.tokenAcesso },
      { rotulo: 'token de renovação', valor: sessao.tokenRenovacao },
    ];
    const eventos = await eventosDaConta(cenario.dono, conta.id);
    const fontes: Record<string, string> = {
      log: cenario.api.textoDoLog(),
      'eventos da outbox': JSON.stringify(eventos),
      'envelopes do Sentry': sentry.envelopes.join('\n'),
    };
    for (const resposta of respostas.filter(({ status: codigo }) => codigo >= 400)) {
      fontes[`resposta ${resposta.fonte}`] = resposta.texto;
    }
    expect(sensiveisEncontrados(fontes, sensiveis)).toEqual([]);

    // O código digitado (6 dígitos casam por acaso com números longos do log): só nas
    // respostas de erro, que são curtas.
    const soRespostas = Object.fromEntries(
      Object.entries(fontes).filter(([fonte]) => fonte.startsWith('resposta')),
    );
    expect(
      sensiveisEncontrados(soRespostas, [{ rotulo: 'código digitado', valor: codigoDigitado }]),
    ).toEqual([]);
  });
});

describe('a varredura acha o que procura (controle)', () => {
  it('um log com o e-mail em maiúsculas ou codificado em URL é apontado', () => {
    const email = 'fulana.teste@exemplo.com.br';
    const sensiveis = [{ rotulo: 'e-mail', valor: email }];
    expect(sensiveisEncontrados({ log: `x ${email.toUpperCase()} y` }, sensiveis)).toEqual([
      'log: e-mail',
    ]);
    expect(sensiveisEncontrados({ log: encodeURIComponent(email) }, sensiveis)).toEqual([
      'log: e-mail',
    ]);
    expect(
      sensiveisEncontrados({ log: 'tel 35999991234' }, [
        { rotulo: 'telefone', valor: '+5535999991234' },
      ]),
    ).toEqual(['log: telefone']);
    expect(sensiveisEncontrados({ log: 'nada aqui' }, sensiveis)).toEqual([]);
  });

  it('o Sentry falso recebe o envelope do erro inesperado da rota', () => {
    const tipos = sentry.eventos().map((evento) => evento.exception?.values?.[0]?.type);
    expect(tipos).toContain('Error');
  });

  it('a sessão do contrato tem token: o teste de cima varreu um valor real', async () => {
    const conta = await cenario.novaConta();
    const resposta = await cenario.api.http
      .post('/v1/sessoes')
      .set('X-Forwarded-For', cenario.ip())
      .send({ email: conta.email, senha: conta.senha, cliente: 'app_consumidor' })
      .expect(200);
    expect(sessaoDe(resposta.body).tokenAcesso.length).toBeGreaterThan(100);
  });
});
