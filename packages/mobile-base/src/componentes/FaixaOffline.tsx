// Faixa offline (design system, "Faixa offline"): faixa fixa logo abaixo da barra superior, fundo
// `banner.offline`, texto `text.onAction`. Empurra o conteúdo (não o cobre) e não some sozinha
// enquanto a tela a mostrar; quem a monta decide quando (a detecção de conexão é da tela ou do
// provedor da etapa seguinte). "Tentar de novo" tem alvo de 44. Ao voltar a conexão, a tela tira a
// faixa e dispara um toast com `textos.componentes.faixaOffline.reconectado`.
import { espaco, raio, tamanho, temaClaro } from '@bairrin/tokens';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { textos } from '../textos/pt-BR.ts';
import { anunciar, useFoco } from './acessibilidade.ts';
import { anelDeFocoSobreEscuro, estiloDeTexto } from './estilos.ts';

export interface FaixaOfflineProps {
  /** Padrão: "Você está offline. Mostrando o que foi carregado por último." */
  mensagem?: string;
  /** Sem ele, sem o botão. */
  aoTentarDeNovo?: () => void;
  testID?: string;
}

export function FaixaOffline({
  mensagem = textos.componentes.faixaOffline.mensagem,
  aoTentarDeNovo,
  testID,
}: FaixaOfflineProps) {
  const foco = useFoco();

  // O Android anuncia pela região viva; o iOS não, então a faixa nova é dita à mão.
  useEffect(() => {
    anunciar(mensagem);
  }, [mensagem]);

  return (
    <View testID={testID} style={estilos.faixa}>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={estilos.simbolo}
      >
        !
      </Text>
      <View accessible role="status" accessibilityLiveRegion="polite" style={estilos.textos}>
        <Text style={estilos.mensagem}>{mensagem}</Text>
      </View>
      {aoTentarDeNovo ? (
        <Pressable
          role="button"
          accessibilityLabel={textos.componentes.faixaOffline.tentarDeNovo}
          onPress={aoTentarDeNovo}
          onFocus={foco.aoFocar}
          onBlur={foco.aoDesfocar}
          style={({ pressed }) => [
            estilos.botao,
            pressed && estilos.botaoPressionado,
            foco.focado && anelDeFocoSobreEscuro,
          ]}
        >
          <Text style={estilos.botaoTexto}>{textos.componentes.faixaOffline.tentarDeNovo}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  faixa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco[3],
    paddingVertical: espaco[2],
    paddingHorizontal: espaco[4],
    backgroundColor: temaClaro.banner.offline,
  },
  simbolo: { ...estiloDeTexto('body', 'semibold'), color: temaClaro.text.onAction },
  textos: { flex: 1 },
  mensagem: { ...estiloDeTexto('bodySm'), color: temaClaro.text.onAction },
  botao: {
    minHeight: tamanho.touch.min,
    justifyContent: 'center',
    paddingHorizontal: espaco[3],
    borderRadius: raio.md,
  },
  botaoPressionado: { backgroundColor: temaClaro.toast.bg },
  botaoTexto: {
    ...estiloDeTexto('bodySm', 'semibold'),
    color: temaClaro.text.onAction,
    textDecorationLine: 'underline',
  },
});
