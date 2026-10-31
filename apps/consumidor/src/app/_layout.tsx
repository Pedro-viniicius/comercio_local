// Layout raiz: pilha de telas com o cabeçalho nas cores do tema (@bairrin/tokens).
import { fonte, pesoDaFonte, temaClaro } from '@bairrin/tokens';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { textos } from '../textos/pt-BR.ts';

export default function LayoutRaiz() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          title: textos.titulo,
          headerStyle: { backgroundColor: temaClaro.bg.surface },
          headerTintColor: temaClaro.text.primary,
          headerTitleStyle: {
            fontSize: fonte.titleSm.tamanho,
            fontWeight: `${pesoDaFonte.semibold}`,
          },
          contentStyle: { backgroundColor: temaClaro.bg.canvas },
        }}
      />
    </>
  );
}
