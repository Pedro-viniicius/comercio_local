// Porta pura ao lado do adaptador: pode ser importada por domínio e aplicação.
export abstract class EnviadorDeEmail {
  abstract enviar(para: string): Promise<void>;
}
