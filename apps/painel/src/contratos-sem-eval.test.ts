// S87: o painel roda com a CSP do Caddyfile, sem `unsafe-eval`. O zod 4 sonda `new Function` ao
// construir o primeiro objeto, e no navegador a sonda vira uma violação de CSP a cada abertura.
// `@bairrin/contratos` liga o `jitless` do zod no navegador antes de qualquer esquema: carregar o
// pacote e validar não pode chamar `Function`. Este arquivo não importa nada do zod no topo, para o
// pacote nascer aqui, com o espião no lugar.
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('carregar @bairrin/contratos e validar no navegador não chama `Function` (sem eval)', async () => {
  const original = globalThis.Function;
  let chamadas = 0;
  const espiao = new Proxy(original, {
    apply(alvo, este: unknown, argumentos: unknown[]) {
      chamadas += 1;
      return Reflect.apply(alvo, este, argumentos) as unknown;
    },
    construct(alvo, argumentos: string[], novoAlvo: FunctionConstructor) {
      chamadas += 1;
      return Reflect.construct(alvo, argumentos, novoAlvo);
    },
  });
  vi.stubGlobal('Function', espiao);

  const { entrarSchema, sessaoSchema } = await import('@bairrin/contratos');
  const entrada = entrarSchema.safeParse({
    email: 'pedro@exemplo.com.br',
    senha: 'senha-boa-123',
    cliente: 'painel',
  });
  const sessao = sessaoSchema.safeParse({
    tokenAcesso: 'x',
    expiraEm: '2026-10-19T12:15:00Z',
    emailVerificado: true,
  });

  expect(entrada.success).toBe(true);
  expect(sessao.success).toBe(true);
  expect(chamadas).toBe(0);
});
