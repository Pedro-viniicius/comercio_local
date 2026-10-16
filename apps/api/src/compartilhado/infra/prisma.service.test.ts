// `PrismaService.verificarConexao`: o prazo da verificação de prontidão. O caso
// com banco de verdade (no ar, senha errada, fora do ar) está em
// test/integracao/saude-pronto.int.test.ts.
import type { PinoLogger } from 'nestjs-pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ambiente } from '../config/ambiente.ts';
import { BancoSemResposta, PrismaService } from './prisma.service.ts';

function criarServico(): PrismaService {
  const ambiente = {
    DATABASE_URL: 'postgresql://ficticio:ficticio@127.0.0.1:1/ficticio',
  } as Ambiente;
  const logger = { setContext: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  return new PrismaService(ambiente, logger);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PrismaService.verificarConexao', () => {
  it('resolve quando o SELECT 1 responde', async () => {
    const servico = criarServico();
    const consulta = vi.spyOn(servico, '$queryRaw').mockResolvedValue([{ '?column?': 1 }]);
    await expect(servico.verificarConexao()).resolves.toBeUndefined();
    expect(consulta).toHaveBeenCalledTimes(1);
  });

  it('rejeita com o erro do driver quando a consulta falha', async () => {
    const servico = criarServico();
    const falha = new Error('falha do driver');
    vi.spyOn(servico, '$queryRaw').mockRejectedValue(falha);
    await expect(servico.verificarConexao()).rejects.toBe(falha);
  });

  it('rejeita com BancoSemResposta quando o banco não responde no prazo', async () => {
    vi.useFakeTimers();
    const servico = criarServico();
    vi.spyOn(servico, '$queryRaw').mockReturnValue(new Promise(() => {}) as never);
    const verificacao = servico.verificarConexao(1_000);
    const resultado = expect(verificacao).rejects.toBeInstanceOf(BancoSemResposta);
    await vi.advanceTimersByTimeAsync(999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await resultado;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('limpa o temporizador quando o banco responde antes do prazo', async () => {
    vi.useFakeTimers();
    const servico = criarServico();
    vi.spyOn(servico, '$queryRaw').mockResolvedValue([]);
    await servico.verificarConexao(1_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
