// Adaptador Argon2id do `Hasher` (OWASP: 19 MiB, t=2, p=1), com o
// `@node-rs/argon2` (binário nativo pronto, sem script de instalação).
//
// A senha passa por NFKC aqui dentro, igual em `gerarHash`, `verificar` e
// `simularVerificacao` (P2, S75). A NFKC faz parte do formato do hash: mudar a
// normalização depois de existirem contas tranca quem tem senha com acento ou
// largura cheia (ver "Riscos e como reverter" do plano 01b).
import { Injectable } from '@nestjs/common';
import { type Algorithm, hash, type Options, verify } from '@node-rs/argon2';
import { Hasher } from '../../aplicacao/portas/hasher.ts';

/**
 * Valor do `Algorithm.Argon2id`. O enum do pacote é `const enum` ambiente, que
 * não pode ser lido com `isolatedModules` e não existe em tempo de execução.
 */
const ARGON2ID = 2 satisfies Algorithm.Argon2id;

/** Parâmetros do hash: Argon2id, 19 MiB (em KiB), 2 passadas, 1 linha. */
export const OPCOES_DO_ARGON2: Readonly<Options> = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * Hash fictício com os mesmos parâmetros, de uma senha aleatória descartada.
 * Ninguém conhece a senha; ele só serve para gastar o tempo de uma verificação
 * de verdade. O teste confere que os parâmetros dele são os de
 * `OPCOES_DO_ARGON2`: se mudarem, gere outro.
 */
export const HASH_FICTICIO =
  '$argon2id$v=19$m=19456,t=2,p=1$ibq0AmumqXE2IrFHglmHcA$tfGof8TXuP6jSu/GGcxumhJENlZUFGK3rSWImz+kpv4';

/** A forma da senha que entra no hash (P2, S75). */
function normalizar(senha: string): string {
  return senha.normalize('NFKC');
}

@Injectable()
export class Argon2Hasher extends Hasher {
  override gerarHash(senha: string): Promise<string> {
    return hash(normalizar(senha), OPCOES_DO_ARGON2);
  }

  override async verificar(senha: string, hashGuardado: string): Promise<boolean> {
    try {
      return await verify(hashGuardado, normalizar(senha));
    } catch {
      // Hash mal formado (o pacote lança `InvalidArg`): a senha não confere.
      // A mensagem do erro não sai daqui.
      return false;
    }
  }

  override async simularVerificacao(senha: string): Promise<void> {
    await this.verificar(senha, HASH_FICTICIO);
  }
}
