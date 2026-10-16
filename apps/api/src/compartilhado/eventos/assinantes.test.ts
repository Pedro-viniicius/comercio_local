// Registro de assinantes e erro sanitizado do assinante. A entrega com
// deduplicação no banco está em test/integracao/outbox.int.test.ts.
import { describe, expect, it } from 'vitest';
import {
  type Assinante,
  chaveDaEntrega,
  FalhaNoAssinante,
  nomeDaFila,
  RegistroDeAssinantes,
} from './assinantes.ts';

function assinante(nome: string, eventos: string[]): Assinante {
  return { nome, eventos, tratar: () => Promise.resolve() };
}

describe('RegistroDeAssinantes', () => {
  it('devolve os assinantes de cada tipo de evento', () => {
    const registro = new RegistroDeAssinantes();
    const codigo = assinante('identidade.enviar-codigo', [
      'identidade.ContaCriada',
      'identidade.VerificacaoReenviada',
    ]);
    const boasVindas = assinante('notificacoes.boas-vindas', ['identidade.ContaCriada']);
    registro.registrar(codigo);
    registro.registrar(boasVindas);
    expect(registro.assinantesDe('identidade.ContaCriada')).toEqual([codigo, boasVindas]);
    expect(registro.assinantesDe('identidade.VerificacaoReenviada')).toEqual([codigo]);
    expect(registro.assinantesDe('pedidos.PedidoCriado')).toEqual([]);
    expect(registro.todos()).toEqual([codigo, boasVindas]);
  });

  it('recusa nome repetido, nome fora do formato e assinante sem eventos', () => {
    const registro = new RegistroDeAssinantes();
    registro.registrar(assinante('identidade.enviar-codigo', ['identidade.ContaCriada']));
    expect(() =>
      registro.registrar(assinante('identidade.enviar-codigo', ['identidade.ContaCriada'])),
    ).toThrow(/já registrado/);
    expect(() => registro.registrar(assinante('EnviarCodigo', ['identidade.ContaCriada']))).toThrow(
      /inválido/,
    );
    expect(() => registro.registrar(assinante('identidade.sem-eventos', []))).toThrow(/nenhum/);
  });

  it('monta nome de fila e chave única aceitos pelo pg-boss', () => {
    const evento = '6f1d3c2a-1b2c-4d3e-8f90-123456789abc';
    // pg-boss aceita só letras, dígitos, "_", "-", "." e "/".
    expect(nomeDaFila('identidade.enviar-codigo')).toMatch(/^[\w.\-/]+$/);
    expect(chaveDaEntrega(evento, 'identidade.enviar-codigo')).toBe(
      `${evento}.identidade.enviar-codigo`,
    );
    expect(chaveDaEntrega(evento, 'identidade.enviar-codigo')).toMatch(/^[\w.\-/]+$/);
  });
});

describe('FalhaNoAssinante', () => {
  it('guarda tipo e código da causa, nunca a mensagem', () => {
    const causa = Object.assign(new Error('Failed sending mail to maria@exemplo.com.br'), {
      code: 'EENVELOPE',
    });
    const falha = new FalhaNoAssinante('identidade.enviar-codigo', causa);
    expect(falha.message).toBe('O assinante identidade.enviar-codigo falhou (Error/EENVELOPE).');
    expect(falha).toMatchObject({ tipoDaCausa: 'Error', codigoDaCausa: 'EENVELOPE' });
    expect(JSON.stringify(falha)).not.toContain('maria');
    expect(falha.stack ?? '').not.toContain('maria');
  });
});
