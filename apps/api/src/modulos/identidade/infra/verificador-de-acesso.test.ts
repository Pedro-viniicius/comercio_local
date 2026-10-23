// `VerificadorDeAcessoDaIdentidade` (plano 01b, etapa 16; S7, S8): token, `contas.status` e,
// com `conferirSessao` (rotas de `/v1/admin`), a sessão do `sid`. Com os fakes em memória.
import { describe, expect, it } from 'vitest';
import { RelogioFixo } from '../../../compartilhado/tempo/relogio.ts';
import { criarIdentidadeEmMemoria } from '../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import {
  CifradorFalso,
  EmissorDeJwtFalso,
  HasherFalso,
} from '../../../../test/fakes/identidade/servicos-falsos.ts';
import { Conta } from '../dominio/conta.ts';
import { Email } from '../dominio/email.ts';
import { SEGUNDOS_DO_TOKEN_DE_ACESSO, Sessao } from '../dominio/sessao.ts';
import { Telefone } from '../dominio/telefone.ts';
import { VerificadorDeAcessoDaIdentidade } from './verificador-de-acesso.ts';

const AGORA = new Date('2026-10-19T12:00:00.000Z');
const CONTA = 'cccccccc-0000-4000-8000-000000000001';
const OUTRA_CONTA = 'cccccccc-0000-4000-8000-000000000002';
const SID = 'ffffffff-0000-4000-8000-000000000001';
const SID_DA_OUTRA = 'ffffffff-0000-4000-8000-000000000002';

const cifrador = new CifradorFalso();
const emissor = new EmissorDeJwtFalso();

async function montar() {
  const identidade = criarIdentidadeEmMemoria();
  const relogio = new RelogioFixo(AGORA);
  for (const [id, email] of [
    [CONTA, 'ana@exemplo.com'],
    [OUTRA_CONTA, 'bia@exemplo.com'],
  ] as const) {
    const conta = Conta.criar({
      id,
      nome: 'Ana Souza',
      email: Email.criar(email),
      telefone: Telefone.criar('35999991234'),
      senhaHash: HasherFalso.hashDe('senha-da-ana'),
      agora: AGORA,
    });
    if (id === CONTA) conta.concederAdmin(AGORA);
    await identidade.contas.inserir(conta);
  }
  for (const [id, contaId] of [
    [SID, CONTA],
    [SID_DA_OUTRA, OUTRA_CONTA],
  ] as const) {
    await identidade.sessoes.inserir(
      Sessao.criar({
        id,
        contaId,
        cliente: 'painel',
        tokenHash: cifrador.hmac('token_renovacao', [`token-${id}`]),
        mfa: true,
        agora: AGORA,
      }),
    );
  }
  const verificador = new VerificadorDeAcessoDaIdentidade(
    emissor,
    relogio,
    identidade.contas,
    identidade.sessoes,
  );
  return { identidade, relogio, verificador };
}

async function token(
  contaId = CONTA,
  sid = SID,
  perfis: ('consumidor' | 'admin')[] = ['consumidor', 'admin'],
  quando = AGORA,
) {
  const emitido = await emissor.emitir(
    { contaId, sid, perfis, mfa: true, emailVerificado: false },
    quando,
  );
  return emitido.token;
}

describe('VerificadorDeAcessoDaIdentidade', () => {
  it('token válido de conta ativa: a conta, sem conferir a sessão fora de /v1/admin', async () => {
    const { verificador, identidade, relogio } = await montar();
    const sessao = await identidade.sessoes.buscarPorId(SID);
    sessao?.revogar('logout', AGORA);
    if (sessao) await identidade.sessoes.atualizar(sessao);

    await expect(verificador.verificar(await token(), { conferirSessao: false })).resolves.toEqual({
      contaId: CONTA,
      sid: SID,
      perfis: ['consumidor', 'admin'],
      mfa: true,
      emailVerificado: false,
    });
    // Vencido: recusado.
    relogio.avancar(SEGUNDOS_DO_TOKEN_DE_ACESSO * 1000);
    await expect(
      verificador.verificar(await token(), { conferirSessao: false }),
    ).resolves.toBeNull();
  });

  it('token mal formado ou de outro emissor → null', async () => {
    const { verificador } = await montar();
    await expect(verificador.verificar('x.y.z', { conferirSessao: false })).resolves.toBeNull();
  });

  it('conta fora de `ativa` → null em qualquer rota (S8)', async () => {
    const { verificador, identidade } = await montar();
    await identidade.contas.gravarDesativacao(CONTA, AGORA);
    await expect(
      verificador.verificar(await token(), { conferirSessao: false }),
    ).resolves.toBeNull();
  });

  it('com `conferirSessao`: sessão revogada, vencida, inexistente ou de outra conta → null (S8)', async () => {
    const { verificador, identidade, relogio } = await montar();
    await expect(
      verificador.verificar(await token(), { conferirSessao: true }),
    ).resolves.not.toBeNull();

    // `sid` de outra conta no token desta conta.
    await expect(
      verificador.verificar(await token(CONTA, SID_DA_OUTRA), { conferirSessao: true }),
    ).resolves.toBeNull();
    // `sid` que não existe.
    await expect(
      verificador.verificar(await token(CONTA, 'ffffffff-0000-4000-8000-0000000000ff'), {
        conferirSessao: true,
      }),
    ).resolves.toBeNull();

    // Sessão revogada (logout): o token ainda tem minutos de vida, mas /v1/admin recusa.
    const sessao = await identidade.sessoes.buscarPorId(SID);
    sessao?.revogar('logout', AGORA);
    if (sessao) await identidade.sessoes.atualizar(sessao);
    await expect(
      verificador.verificar(await token(), { conferirSessao: true }),
    ).resolves.toBeNull();
    await expect(
      verificador.verificar(await token(), { conferirSessao: false }),
    ).resolves.not.toBeNull();
    expect(relogio.agora()).toEqual(AGORA);
  });

  it('com `conferirSessao`: sessão do painel vencida por inatividade (30 min) → null', async () => {
    const { verificador, relogio } = await montar();
    relogio.avancar(31 * 60 * 1000);
    const recente = await token(CONTA, SID, ['consumidor', 'admin'], relogio.agora());
    await expect(verificador.verificar(recente, { conferirSessao: true })).resolves.toBeNull();
    await expect(verificador.verificar(recente, { conferirSessao: false })).resolves.not.toBeNull();
  });

  it('perfil do token que a conta não tem mais sai da resposta', async () => {
    const { verificador } = await montar();
    const conta = await verificador.verificar(await token(OUTRA_CONTA, SID_DA_OUTRA), {
      conferirSessao: false,
    });
    expect(conta?.perfis).toEqual(['consumidor']);
  });
});
