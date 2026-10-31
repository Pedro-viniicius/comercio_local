// Armazenamentos da sessão dos apps no SecureStore (plano 01b, etapa 12; ADR-012, CA-03, S18,
// S80). Keychain no iOS e Keystore no Android: o par de tokens nunca passa por armazenamento em
// texto puro (a regra de lint de `src/sessao` só deixa importar a lista permitida).
//
// - Sessão e revogação pendente ficam em chaves separadas: limpar a sessão no logout não apaga o
//   par que ainda precisa ser revogado no servidor (S80).
// - Toda entrada é gravada com `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: só se lê com o aparelho
//   desbloqueado, e o item não vai para backup nem para outro aparelho.
// - Primeira abertura depois de instalar (S18): o Keychain do iOS sobrevive à desinstalação, então,
//   sem a marca de instalação, as duas chaves são apagadas antes de qualquer leitura ou escrita.
// - Os erros do SecureStore trazem a mensagem nativa; aqui viram erros sem detalhe.
import type {
  ArmazenamentoDeRevogacao,
  ArmazenamentoDeSessao,
  RevogacaoPendente,
} from '@bairrin/cliente-api';
import { sessaoSchema, type Sessao } from '@bairrin/contratos';
import {
  deleteItemAsync,
  getItemAsync,
  setItemAsync,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  type SecureStoreOptions,
} from 'expo-secure-store';
import {
  marcaDeInstalacaoNoAparelho,
  type MarcaDeInstalacao,
} from '../instalacao/marca-de-instalacao.ts';

/** Chave do par de tokens da sessão em uso. */
export const CHAVE_DA_SESSAO = 'bairrin.sessao';
/** Chave das revogações pendentes (S80): separada do par em uso. */
export const CHAVE_DA_REVOGACAO_PENDENTE = 'bairrin.revogacao-pendente';

/** Opções de toda chamada ao SecureStore. */
export const OPCOES_DO_SECURE_STORE: Readonly<SecureStoreOptions> = Object.freeze({
  keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY,
});

/** O que falhou no cofre sem impedir o uso: só a marca de instalação. */
export type OrigemDaFalhaNoCofre = 'marca_de_instalacao';

export interface OpcoesDoCofreDaSessao {
  /** Padrão: o arquivo vazio na pasta de documentos (`src/instalacao`). */
  marca?: MarcaDeInstalacao;
  /** Avisa só a origem; o erro nunca sai daqui. */
  aoFalhar?: (origem: OrigemDaFalhaNoCofre) => void;
}

export interface CofreDaSessao {
  sessao: ArmazenamentoDeSessao;
  revogacaoPendente: ArmazenamentoDeRevogacao;
}

function semDetalhe(acao: string): () => never {
  return () => {
    throw new Error(`Não foi possível ${acao} no armazenamento seguro.`);
  };
}

async function ler(chave: string): Promise<unknown> {
  const valor = await getItemAsync(chave, OPCOES_DO_SECURE_STORE).catch(semDetalhe('ler'));
  if (valor === null) return null;
  try {
    return JSON.parse(valor) as unknown;
  } catch {
    // Valor fora do formato conta como ausente; a próxima escrita o substitui.
    return null;
  }
}

async function gravar(chave: string, valor: unknown): Promise<void> {
  await setItemAsync(chave, JSON.stringify(valor), OPCOES_DO_SECURE_STORE).catch(
    semDetalhe('gravar'),
  );
}

async function apagar(chave: string): Promise<void> {
  await deleteItemAsync(chave, OPCOES_DO_SECURE_STORE).catch(semDetalhe('apagar'));
}

/**
 * Os dois armazenamentos que o `criarClienteAutenticado` recebe nos apps. Toda operação espera a
 * limpeza da primeira abertura; se ela falhar, a operação rejeita e a próxima tenta de novo, para
 * nunca ler a sessão de uma instalação anterior.
 */
export function criarCofreDaSessao(opcoes: OpcoesDoCofreDaSessao = {}): CofreDaSessao {
  const marca = opcoes.marca ?? marcaDeInstalacaoNoAparelho;
  let preparado = false;
  let preparo: Promise<void> | undefined;

  function avisar(origem: OrigemDaFalhaNoCofre): void {
    try {
      opcoes.aoFalhar?.(origem);
    } catch {
      // Quem só observa não muda o resultado.
    }
  }

  async function preparar(): Promise<void> {
    let instalacaoConhecida: boolean;
    try {
      instalacaoConhecida = await marca.existe();
    } catch {
      // Sem como saber, a instalação conta como nova: perder a sessão só pede outro login.
      avisar('marca_de_instalacao');
      instalacaoConhecida = false;
    }
    if (instalacaoConhecida) return;
    await Promise.all([apagar(CHAVE_DA_SESSAO), apagar(CHAVE_DA_REVOGACAO_PENDENTE)]);
    try {
      await marca.marcar();
    } catch {
      // A próxima abertura apaga de novo e pede login; o uso agora segue.
      avisar('marca_de_instalacao');
    }
  }

  async function pronto(): Promise<void> {
    if (preparado) return;
    const atual = (preparo ??= preparar());
    try {
      await atual;
      preparado = true;
    } finally {
      // Uma limpeza que falhou não fica guardada: a próxima operação tenta de novo.
      if (preparo === atual) preparo = undefined;
    }
  }

  const sessao: ArmazenamentoDeSessao = {
    async ler(): Promise<Sessao | null> {
      await pronto();
      const lida = sessaoSchema.safeParse(await ler(CHAVE_DA_SESSAO));
      return lida.success ? lida.data : null;
    },
    async gravar(valor) {
      await pronto();
      await gravar(CHAVE_DA_SESSAO, valor);
    },
    async limpar() {
      await pronto();
      await apagar(CHAVE_DA_SESSAO);
    },
  };

  const revogacaoPendente: ArmazenamentoDeRevogacao = {
    async ler(): Promise<RevogacaoPendente | null> {
      await pronto();
      const lida = await ler(CHAVE_DA_REVOGACAO_PENDENTE);
      // O cliente confere cada campo (`cliente-api`, "Revogação pendente"); aqui basta ser objeto.
      return typeof lida === 'object' && lida !== null && !Array.isArray(lida) ? lida : null;
    },
    async gravar(valor) {
      await pronto();
      await gravar(CHAVE_DA_REVOGACAO_PENDENTE, valor);
    },
    async limpar() {
      await pronto();
      await apagar(CHAVE_DA_REVOGACAO_PENDENTE);
    },
  };

  return { sessao, revogacaoPendente };
}
