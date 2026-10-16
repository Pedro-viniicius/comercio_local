// Porta pura do núcleo: pode ser importada por domínio e aplicação.
export abstract class UnidadeDeTrabalho {
  abstract executar<T>(trabalho: () => Promise<T>): Promise<T>;
}
