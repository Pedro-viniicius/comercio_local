// Configuração do app Bairrin Lojista. Os identificadores são permanentes nas lojas
// (plano 01a, "Esquema e contratos"): o prefixo `br.com.bairrin` segue o domínio `bairrin.com.br`.
// O endereço da API vem de EXPO_PUBLIC_API_URL, lido em tempo de build; nunca ponha segredo nele.
import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Bairrin Lojista',
  slug: 'bairrin-lojista',
  scheme: 'bairrin-lojista',
  version: '0.1.0',
  orientation: 'portrait',
  // Ícones de `assets/brand/png/`, gerados por `assets/brand/gerar-png.sh` a partir dos SVGs da
  // identidade (spec 00-nome-e-identidade.md). O lojista usa a variação com fundo azul-escuro.
  icon: '../../assets/brand/png/lojista-icone-ios-1024.png',
  // Sem `userInterfaceStyle`: o app fica no tema claro, o único do MVP
  // (docs/produto/specs/00-design-system.md, "Modo escuro"). Definir o campo exigiria o
  // expo-system-ui só para repetir esse padrão.
  ios: {
    bundleIdentifier: 'br.com.bairrin.lojista',
    supportsTablet: false,
  },
  android: {
    package: 'br.com.bairrin.lojista',
    adaptiveIcon: {
      foregroundImage: '../../assets/brand/png/lojista-icone-android-frente-1024.png',
      monochromeImage: '../../assets/brand/png/icone-android-mono-1024.png',
      // = `blue.900` de @bairrin/tokens (o app.config.ts não importa o pacote compilado).
      backgroundColor: '#18336B',
    },
    // O padrão do prebuild liga o Auto Backup do Google Drive: cache e fila offline iriam para fora
    // do aparelho (S119). No Android 12+ a transferência entre aparelhos ignora este campo: quem a
    // fecha são as `dataExtractionRules` do plugin `@bairrin/mobile-base`.
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
    // As regras de backup ficam com o plugin do Bairrin, abaixo, que também exclui o SecureStore
    // (S119). Sem biometria no MVP: sem `NSFaceIDUsageDescription` (o padrão do plugin é um texto em
    // inglês no Info.plist).
    ['expo-secure-store', { configureAndroidBackup: false, faceIDPermission: false }],
    // Regras de extração do Android 12+: nada sai do aparelho por backup ou transferência (S119).
    '@bairrin/mobile-base',
  ],
};

export default config;
