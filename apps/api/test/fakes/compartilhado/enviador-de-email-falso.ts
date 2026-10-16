// `EnviadorDeEmail` em memória, para testes de unidade e de caso de uso: guarda
// as mensagens em vez de enviar. Os testes de integração usam o SMTP real
// contra o Mailpit. Fica em `test/fakes/` (fora do build): código de produção
// não importa daqui (regra `producao-nao-importa-test` do dependency-cruiser).
import {
  EnviadorDeEmail,
  FalhaNoEnvioDeEmail,
  type MensagemDeEmail,
} from '../../../src/compartilhado/email/enviador-de-email.ts';

export class EnviadorDeEmailFalso extends EnviadorDeEmail {
  readonly #enviadas: MensagemDeEmail[] = [];
  #falhasPendentes = 0;

  /** Cópias das mensagens enviadas, na ordem. */
  get enviadas(): readonly MensagemDeEmail[] {
    return this.#enviadas.map((mensagem) => ({ ...mensagem }));
  }

  /** As próximas `vezes` chamadas rejeitam com `FalhaNoEnvioDeEmail` (`ECONNECTION`). */
  falharNasProximas(vezes = 1): void {
    this.#falhasPendentes = vezes;
  }

  limpar(): void {
    this.#enviadas.length = 0;
    this.#falhasPendentes = 0;
  }

  override enviar(mensagem: MensagemDeEmail): Promise<void> {
    if (this.#falhasPendentes > 0) {
      this.#falhasPendentes -= 1;
      return Promise.reject(new FalhaNoEnvioDeEmail('ECONNECTION'));
    }
    this.#enviadas.push({ ...mensagem });
    return Promise.resolve();
  }
}
