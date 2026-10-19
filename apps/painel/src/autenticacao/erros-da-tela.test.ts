import {
  ErroCancelado,
  ErroDeApi,
  ErroRespostaInvalida,
  ErroSemConexao,
} from '@bairrin/cliente-api';
import { entrarSchema, redefinirSenhaSchema } from '@bairrin/contratos';
import { describe, expect, it } from 'vitest';
import { textos } from '../textos/pt-BR.ts';
import { classificarFalha, errosParaATela, validarLocal } from './erros-da-tela.ts';

function erroDaApi(
  status: number,
  codigo: string,
  campos?: { campo: string; codigo: string; motivo: string }[],
) {
  return new ErroDeApi({
    status,
    problema: {
      type: 'urn:x',
      title: 't',
      status,
      codigo,
      idRequisicao: 'r',
      ...(campos ? { campos } : {}),
    },
  });
}

describe('classificarFalha', () => {
  it.each([
    [erroDaApi(401, 'nao_autenticado'), 'nao_autenticado'],
    [erroDaApi(403, 'sem_acesso_painel'), 'sem_acesso_painel'],
    [erroDaApi(403, 'sem_permissao'), 'sem_permissao'],
    [erroDaApi(429, 'limite_excedido'), 'limite'],
    [erroDaApi(400, 'validacao'), 'servidor'],
    [erroDaApi(500, 'erro_interno'), 'servidor'],
    [erroDaApi(404, 'nao_encontrado'), 'servidor'],
    [new ErroDeApi({ status: 502 }), 'servidor'],
    [new ErroSemConexao('rede'), 'servidor'],
    [new ErroSemConexao('tempo_esgotado'), 'servidor'],
    [new ErroRespostaInvalida(200), 'servidor'],
    [new ErroCancelado(), 'servidor'],
    [new Error('qualquer'), 'servidor'],
  ])('%s → %s', (erro, tipo) => {
    expect(classificarFalha(erro).tipo).toBe(tipo);
  });

  it('400 com campos devolve os campos como vieram', () => {
    const campos = [{ campo: 'codigo', codigo: 'invalido', motivo: 'm' }];
    expect(classificarFalha(erroDaApi(400, 'validacao', campos))).toEqual({
      tipo: 'campos',
      campos,
    });
  });
});

describe('errosParaATela', () => {
  it('usa `mensagemDoCampo`, o primeiro erro de cada campo e a ordem da tela', () => {
    const { erros, ordem, foraDaTela } = errosParaATela(
      [
        { campo: 'senha', codigo: 'obrigatorio', motivo: 'm' },
        { campo: 'email', codigo: 'invalido', motivo: 'm' },
        { campo: 'email', codigo: 'obrigatorio', motivo: 'm' },
      ],
      ['email', 'senha'],
    );
    expect(erros).toEqual({
      email: textos.erro.email.invalido,
      senha: textos.erro.senha.obrigatorio,
    });
    expect(ordem).toEqual(['email', 'senha']);
    expect(foraDaTela).toBe(false);
  });

  it('marca o campo que a tela não mostra', () => {
    const resultado = errosParaATela(
      [{ campo: 'desafio', codigo: 'invalido', motivo: 'm' }],
      ['codigo'],
    );
    expect(resultado).toEqual({ erros: {}, ordem: [], foraDaTela: true });
  });

  it('com `tela`, escolhe o texto próprio (P1b e P1c)', () => {
    const campos = [{ campo: 'codigo', codigo: 'invalido', motivo: 'm' }];
    expect(errosParaATela(campos, ['codigo'], 'configuracaoDoSegundoFator').erros.codigo).toBe(
      textos.erroPorTela.configuracaoDoSegundoFator.codigo.invalido,
    );
    expect(errosParaATela(campos, ['codigo'], 'recuperacaoDeSenha').erros.codigo).toBe(
      'Código inválido ou expirado. Peça um novo.',
    );
    expect(errosParaATela(campos, ['codigo']).erros.codigo).toBe(textos.erro.codigo.invalido);
  });
});

describe('validarLocal', () => {
  it('devolve os dados normalizados pelo esquema da API', () => {
    expect(
      validarLocal(entrarSchema, { email: ' A@B.com ', senha: 'x', cliente: 'painel' }),
    ).toEqual({
      ok: true,
      dados: { email: 'a@b.com', senha: 'x', cliente: 'painel' },
    });
  });

  it('devolve `campos` com código e motivo, sem o valor digitado', () => {
    const resultado = validarLocal(redefinirSenhaSchema, {
      email: 'a@b.com',
      codigo: '12',
      novaSenha: 'segredo1',
    });
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.campos.map((c) => [c.campo, c.codigo])).toContainEqual(['codigo', 'invalido']);
    expect(JSON.stringify(resultado.campos)).not.toContain('segredo1');
  });
});
