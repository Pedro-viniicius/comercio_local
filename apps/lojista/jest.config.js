// Testes do app com o preset do Expo (Babel do Expo e mocks do React Native). Os pacotes do
// workspace (`@bairrin/*`) chegam como TypeScript de `packages/*/src` (condição `react-native` do
// `exports`); o Jest segue o link simbólico do pnpm até fora de `node_modules`, então o Babel
// os transforma sem configuração extra.
/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // Só os testes do app; `.expo/` e `android/` (gerados) ficam de fora.
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/', '/.expo/'],
};
