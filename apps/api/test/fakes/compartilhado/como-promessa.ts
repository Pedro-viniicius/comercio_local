// Ajuda dos fakes: método de porta que devolve promessa sem `async` (o lint
// recusa `async` sem `await`, regra `require-await`).

/** Executa `fn` e devolve o resultado (ou o erro) como promessa. */
export function comoPromessa<T>(fn: () => T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (erro) {
    return Promise.reject(
      erro instanceof Error ? erro : new Error('Falha no falso.', { cause: erro }),
    );
  }
}
