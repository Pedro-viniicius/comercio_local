// CA-12 e S10 nas rotas do segundo fator e nos dados que a varredura de `sem-dado-pessoal`
// não alcança (plano 01b, etapa 19; revisão do `seguranca`, S114): o admin pelo painel passa
// por login, código errado do autenticador e de recuperação, configuração e confirmação
// recusadas, código de recuperação reaproveitado, 403 de quem não é admin e um erro
// inesperado cuja mensagem leva o desafio, o segredo e os códigos. Depois a varredura procura,
// em respostas de erro, no log inteiro, na OUTBOX INTEIRA e nos envelopes do Sentry falso:
// - e-mail, nome, sobrenome sozinho, parte local do e-mail, telefone e senha;
// - token de desafio, segredo do autenticador, os 10 códigos de recuperação, tokens de sessão;
// - o código digitado do autenticador (só como número inteiro, sem casar com ids e datas).
//
// Também prova que o log da varredura não está vazio (controle positivo): sem as linhas do
// 403, do 500 e das rotas do segundo fator, o teste falha em vez de passar vazio.
import { describe, expect, it, vi, afterAll } from 'vitest';
import { InterceptadorDoSentry } from '../../../src/compartilhado/observabilidade/sentry.ts';
import { VerificarSegundoFatorCasoDeUso } from '../../../src/modulos/identidade/aplicacao/segundo-fator/verificar-segundo-fator.caso-de-uso.ts';
import { sensiveisEncontrados, type ValorSensivel } from '../../helpers/captura-de-log.ts';
import { ligarSentryFalso } from '../../helpers/sentry-falso.ts';
import { problemaDe } from './api-http.ts';
import { usarCenarioHttp, valoresPessoaisDe } from './cenario-http.ts';
import { T0, totpDe } from './pilha-de-casos-de-uso.ts';

const sentry = ligarSentryFalso();
const cenario = usarCenarioHttp({
  antesDeIniciar: (app) => app.useGlobalInterceptors(new InterceptadorDoSentry()),
});

afterAll(async () => {
  await sentry.desligar();
});

/** Código do autenticador errado, de 6 dígitos (não é o do passo atual nem o vizinho). */
const CODIGO_ERRADO = '904127';
/** Código de recuperação com a forma certa e valor que nenhuma conta tem. */
const RECUPERACAO_ERRADA = 'abcde-23456';

/** O número aparece como número inteiro no texto (sem casar com pedaço de outro número). */
function apareceComoNumero(texto: string, numero: string): boolean {
  return new RegExp(`(^|\\D)${numero}(\\D|$)`).test(texto);
}

describe('CA-12 no segundo fator do admin: respostas, log inteiro, outbox inteira e Sentry', () => {
  it('nenhum dado pessoal, desafio, segredo ou código de recuperação sai em erro, log, evento ou Sentry', async () => {
    const { http } = cenario.api;
    const admin = await cenario.adminNoPainel();
    const outra = await cenario.contaNoApp();
    const erros: { fonte: string; status: number; texto: string }[] = [];
    const guardar = (
      fonte: string,
      resposta: { status: number; text: string; headers: Record<string, unknown> },
    ) => {
      erros.push({
        fonte: `${fonte} → ${resposta.status}`,
        status: resposta.status,
        texto: `${resposta.text}\n${JSON.stringify(resposta.headers)}`,
      });
      return resposta;
    };
    const entrarNoPainel = async (): Promise<string> => {
      const login = await http
        .post('/v1/sessoes')
        .set('X-Forwarded-For', cenario.ip())
        .send({ email: admin.conta.email, senha: admin.conta.senha, cliente: 'painel' })
        .expect(200);
      return (login.body as { desafio: string }).desafio;
    };
    // O código de confirmação da configuração (T0) já está gasto: o passo seguinte.
    cenario.api.relogio.definir(new Date(T0.getTime() + 31_000));

    const desafio1 = await entrarNoPainel();
    guardar(
      'segundo fator com código errado do autenticador',
      await http
        .post('/v1/sessoes/segundo-fator')
        .set('X-Forwarded-For', cenario.ip())
        .send({ desafio: desafio1, codigo: CODIGO_ERRADO }),
    );
    guardar(
      'segundo fator com código de recuperação errado',
      await http
        .post('/v1/sessoes/segundo-fator')
        .set('X-Forwarded-For', cenario.ip())
        .send({ desafio: desafio1, codigoRecuperacao: RECUPERACAO_ERRADA }),
    );
    guardar(
      'configuração para conta que já tem segundo fator',
      await http
        .post('/v1/segundo-fator/configuracao')
        .set('X-Forwarded-For', cenario.ip())
        .send({ desafio: desafio1 }),
    );
    guardar(
      'confirmação com desafio de outra etapa',
      await http
        .post('/v1/segundo-fator/confirmacao')
        .set('X-Forwarded-For', cenario.ip())
        .send({ desafio: desafio1, codigo: CODIGO_ERRADO }),
    );
    guardar(
      'desafio inventado',
      await http
        .post('/v1/sessoes/segundo-fator')
        .set('X-Forwarded-For', cenario.ip())
        .send({ desafio: 'desafio.inventado', codigo: CODIGO_ERRADO }),
    );

    const codigoCerto = totpDe(admin.segredo, cenario.api.relogio.agora());
    const certo = await http
      .post('/v1/sessoes/segundo-fator')
      .set('X-Forwarded-For', cenario.ip())
      .send({ desafio: desafio1, codigo: codigoCerto })
      .expect(200);
    const sessaoDoPainel = certo.body as { tokenAcesso: string };

    // Um código de recuperação entra uma vez; o segundo uso é recusado sem repeti-lo.
    const reaproveitado = admin.recuperacao[0] ?? '';
    const desafio2 = await entrarNoPainel();
    await http
      .post('/v1/sessoes/segundo-fator')
      .set('X-Forwarded-For', cenario.ip())
      .send({ desafio: desafio2, codigoRecuperacao: reaproveitado })
      .expect(200);
    const desafio3 = await entrarNoPainel();
    guardar(
      'código de recuperação já usado',
      await http
        .post('/v1/sessoes/segundo-fator')
        .set('X-Forwarded-For', cenario.ip())
        .send({ desafio: desafio3, codigoRecuperacao: reaproveitado }),
    );

    // Quem não é admin em /v1/admin: 403 com log só do id.
    guardar(
      'conta comum em /v1/admin/conta',
      await http
        .get('/v1/admin/conta')
        .set('Authorization', `Bearer ${outra.tokenAcesso}`)
        .set('X-Forwarded-For', cenario.ip()),
    );

    // Erro inesperado na rota do segundo fator, com os segredos na mensagem (como o de um driver).
    const desafio4 = await entrarNoPainel();
    vi.spyOn(cenario.api.app.get(VerificarSegundoFatorCasoDeUso), 'executar').mockRejectedValueOnce(
      new Error(
        `falhou: desafio=${desafio4} segredo=${admin.segredo} recuperacao=${admin.recuperacao.join(',')} email=${admin.conta.email}`,
      ),
    );
    const falha = guardar(
      'erro inesperado no segundo fator',
      await http
        .post('/v1/sessoes/segundo-fator')
        .set('X-Forwarded-For', cenario.ip())
        .send({ desafio: desafio4, codigo: CODIGO_ERRADO }),
    );
    expect(falha.status).toBe(500);
    expect(problemaDe(JSON.parse(falha.text)).codigo).toBe('erro_interno');

    const status = new Set(erros.map(({ status: codigo }) => codigo));
    for (const esperado of [400, 401, 403, 500]) expect(status).toContain(esperado);

    // Controle positivo: o log tem o que a varredura precisa olhar.
    const registros = cenario.api.registrosDoLog();
    const recusas = registros.filter((registro) =>
      String(registro['msg']).startsWith('acesso negado'),
    );
    expect(recusas).toHaveLength(1);
    expect(recusas[0]?.['contaId']).toBe(outra.conta.id);
    const log = cenario.api.textoDoLog();
    expect(log).toContain('/v1/sessoes/segundo-fator');
    expect(registros.some((registro) => registro['level'] === 'error')).toBe(true);

    await sentry.esvaziar();
    expect(sentry.eventos().length).toBeGreaterThanOrEqual(1);

    const nomeInteiro = admin.conta.nome;
    const sobrenome = nomeInteiro.split(' ').at(-1) ?? nomeInteiro;
    const parteLocal = admin.conta.email.split('@')[0] ?? admin.conta.email;
    const sensiveis: ValorSensivel[] = [
      ...valoresPessoaisDe(admin.conta),
      { rotulo: 'sobrenome', valor: sobrenome },
      { rotulo: 'parte local do e-mail', valor: parteLocal },
      { rotulo: 'desafio 1', valor: desafio1 },
      { rotulo: 'desafio 2', valor: desafio2 },
      { rotulo: 'desafio 3', valor: desafio3 },
      { rotulo: 'desafio 4', valor: desafio4 },
      { rotulo: 'segredo do autenticador', valor: admin.segredo },
      ...admin.recuperacao.map((codigo, indice) => ({
        rotulo: `código de recuperação ${String(indice + 1)}`,
        valor: codigo,
      })),
      { rotulo: 'token de acesso do painel', valor: sessaoDoPainel.tokenAcesso },
      { rotulo: 'token de acesso da confirmação', valor: admin.tokenAcesso },
      { rotulo: 'token de renovação da confirmação', valor: admin.tokenRenovacao },
    ];
    const { rows: outbox } = await cenario.dono.query(
      'SELECT * FROM compartilhado.outbox ORDER BY ocorrido_em, id',
    );
    const fontes: Record<string, string> = {
      log,
      'outbox inteira': JSON.stringify(outbox),
      'envelopes do Sentry': sentry.envelopes.join('\n'),
    };
    for (const erro of erros) fontes[`resposta ${erro.fonte}`] = erro.texto;
    expect(sensiveisEncontrados(fontes, sensiveis)).toEqual([]);

    // Os códigos de 6 dígitos casam por acaso com pedaços de números do log: só como número.
    for (const [rotulo, numero] of [
      ['código errado digitado', CODIGO_ERRADO],
      ['código certo digitado', codigoCerto],
    ] as const) {
      for (const [fonte, texto] of Object.entries(fontes)) {
        expect(apareceComoNumero(texto, numero), `${fonte}: ${rotulo}`).toBe(false);
      }
    }
    // Controle da própria varredura de número inteiro.
    expect(apareceComoNumero(`x ${CODIGO_ERRADO} y`, CODIGO_ERRADO)).toBe(true);
    expect(apareceComoNumero(`17${CODIGO_ERRADO}3`, CODIGO_ERRADO)).toBe(false);
  });
});
