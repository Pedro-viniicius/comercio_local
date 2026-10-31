// Marca de instalação do app (plano 01b, etapa 12; S18). No iOS, o Keychain sobrevive à
// desinstalação: sem esta marca, um app reinstalado leria a sessão da instalação anterior. A marca
// é um arquivo vazio na pasta de documentos, que o sistema apaga junto com o app (no Android, o
// backup e a transferência entre aparelhos ficam desligados pelas regras do `app.plugin.js`).
//
// Fica fora de `src/sessao` porque usa o `expo-file-system`, que a regra de lint da sessão proíbe
// (CA-03): a sessão importa só este arquivo, e ele não recebe nem grava dado algum, só a presença
// do arquivo.
import { File, Paths } from 'expo-file-system';

/** Nome do arquivo vazio que marca a instalação atual. */
export const ARQUIVO_DA_MARCA_DE_INSTALACAO = 'bairrin-instalacao';

/** Se esta instalação do app já abriu antes. Não guarda dado nenhum. */
export interface MarcaDeInstalacao {
  existe(): Promise<boolean>;
  marcar(): Promise<void>;
}

function arquivoDaMarca(): File {
  return new File(Paths.document, ARQUIVO_DA_MARCA_DE_INSTALACAO);
}

/** A marca num arquivo vazio da pasta de documentos do app. */
export const marcaDeInstalacaoNoAparelho: MarcaDeInstalacao = {
  existe() {
    return Promise.resolve().then(() => arquivoDaMarca().exists);
  },
  marcar() {
    return Promise.resolve().then(() => {
      const arquivo = arquivoDaMarca();
      if (!arquivo.exists) arquivo.create();
    });
  },
};
