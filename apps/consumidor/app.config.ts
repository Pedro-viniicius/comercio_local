// Configuração do app Bairrin (consumidor). Os identificadores são permanentes nas lojas
// (plano 01a, "Esquema e contratos"): o prefixo `br.com.bairrin` segue o domínio `bairrin.com.br`.
// O endereço da API vem de EXPO_PUBLIC_API_URL, lido em tempo de build; nunca ponha segredo nele.
import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Bairrin',
  slug: 'bairrin',
  scheme: 'bairrin',
  version: '0.1.0',
  orientation: 'portrait',
  // Sem `userInterfaceStyle`: o app fica no tema claro, o único do MVP
  // (docs/produto/specs/00-design-system.md, "Modo escuro"). Definir o campo exigiria o
  // expo-system-ui só para repetir esse padrão.
  ios: {
    bundleIdentifier: 'br.com.bairrin.consumidor',
    supportsTablet: false,
  },
  android: {
    package: 'br.com.bairrin.consumidor',
    // O padrão do prebuild liga o Auto Backup do Google Drive: cache e fila offline iriam para fora
    // do aparelho (S119). No Android 12+ a transferência entre aparelhos ignora este campo; as
    // `dataExtractionRules` ficam para a etapa 12 do plano 01b.
    allowBackup: false,
    // Permissões do template e do expo-file-system que o app não usa (S120). Localização e câmera
    // entram quando a funcionalidade pedir.
    blockedPermissions: [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.VIBRATE',
    ],
  },
  plugins: [
    // Sem a rota `_sitemap` no build de produção (S122).
    ['expo-router', { sitemap: false }],
    // Tira as entradas do SecureStore do backup do Android (S119).
    ['expo-secure-store', { configureAndroidBackup: true }],
  ],
};

export default config;
