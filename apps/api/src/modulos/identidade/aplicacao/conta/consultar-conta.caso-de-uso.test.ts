// Dados da conta da sessão (spec A5; CA-07): nome, e-mail mascarado e perfis, sem `admin`
// fora da sessão do painel com segundo fator.
import { contaSchema } from '@bairrin/contratos';
import { describe, expect, it } from 'vitest';
import { criarIdentidadeEmMemoria } from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import { HasherFalso } from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { Conta } from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import { Telefone } from '../../dominio/telefone.ts';
import { ConsultarContaCasoDeUso } from './consultar-conta.caso-de-uso.ts';

const AGORA = new Date('2026-10-23T12:00:00.000Z');
const CONTA = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';
const EMAIL = 'ana.souza@exemplo.com.br';
const TELEFONE = '35999991234';

async function montar(opcoes: { admin?: boolean; lojista?: boolean; desativada?: boolean } = {}) {
  const identidade = criarIdentidadeEmMemoria();
  const conta = Conta.criar({
    id: CONTA,
    nome: 'Ana Souza',
    email: Email.criar(EMAIL),
    telefone: Telefone.criar(TELEFONE),
    senhaHash: HasherFalso.hashDe('cavalo-grampo-azul-72'),
    agora: AGORA,
  });
  if (opcoes.admin === true) conta.concederAdmin(AGORA);
  if (opcoes.lojista === true) conta.concederPerfil('lojista', AGORA);
  if (opcoes.desativada === true) conta.desativar(AGORA);
  await identidade.contas.inserir(conta);
  return { caso: new ConsultarContaCasoDeUso(identidade.contas), conta };
}

describe('ConsultarContaCasoDeUso', () => {
  it('devolve o nome, o e-mail mascarado e os perfis, na forma do contrato, sem e-mail nem telefone', async () => {
    const { caso, conta } = await montar({ lojista: true });

    const resultado = await caso.executar({ contaId: CONTA, sessaoComAdmin: false });

    expect(resultado).toEqual({
      tipo: 'conta',
      conta: {
        nome: 'Ana Souza',
        emailMascarado: conta.email.mascarado,
        perfis: ['consumidor', 'lojista'],
      },
    });
    if (resultado.tipo !== 'conta') throw new Error('esperava a conta');
    expect(contaSchema.parse(resultado.conta)).toEqual(resultado.conta);
    const texto = JSON.stringify(resultado);
    expect(texto).not.toContain(EMAIL);
    expect(texto).not.toContain(TELEFONE);
  });

  it('conta admin numa sessão sem admin (app) não aparece como admin (CA-07)', async () => {
    const { caso } = await montar({ admin: true });

    const resultado = await caso.executar({ contaId: CONTA, sessaoComAdmin: false });

    expect(resultado.tipo === 'conta' && resultado.conta.perfis).toEqual(['consumidor']);
  });

  it('na sessão do painel com admin, o perfil admin aparece', async () => {
    const { caso } = await montar({ admin: true });

    const resultado = await caso.executar({ contaId: CONTA, sessaoComAdmin: true });

    expect(resultado.tipo === 'conta' && [...resultado.conta.perfis].sort()).toEqual([
      'admin',
      'consumidor',
    ]);
  });

  it('a sessão dizer admin não inventa o perfil numa conta que não o tem', async () => {
    const { caso } = await montar();

    const resultado = await caso.executar({ contaId: CONTA, sessaoComAdmin: true });

    expect(resultado.tipo === 'conta' && resultado.conta.perfis).toEqual(['consumidor']);
  });

  it.each([
    ['desativada no meio', { desativada: true }, CONTA],
    ['apagada', {}, '7a2e4d3b-2c3d-4e4f-9a01-23456789abcd'],
  ] as const)('conta %s → `conta_indisponivel`', async (_nome, opcoes, contaId) => {
    const { caso } = await montar(opcoes);

    await expect(caso.executar({ contaId, sessaoComAdmin: false })).resolves.toEqual({
      tipo: 'conta_indisponivel',
    });
  });
});
