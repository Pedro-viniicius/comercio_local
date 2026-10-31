// Item de lista (design system, "Lista e separadores"): mínimo de 56 px com uma linha e 72 com
// duas, toque na linha inteira, ícone à esquerda e seta à direita quando navega. O separador de
// 1 px `border.subtle` recua até o texto. `destrutivo` pinta o texto de `red.700` (ex.: "Excluir
// minha conta"): o ícone, enviado pela tela, acompanha.
import { espaco, raio, tamanho, temaClaro } from '@bairrin/tokens';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFoco } from './acessibilidade.ts';
import { anelDeFoco, estiloDeTexto } from './estilos.ts';

export interface ItemDeListaProps {
  titulo: string;
  /** Segunda linha, em texto secundário. */
  descricao?: string;
  /** Ícone ou símbolo à esquerda; é decorativo (escondido do leitor de tela). */
  icone?: ReactNode;
  /** Sem ele, o item é só informação (não é botão). */
  aoPressionar?: () => void;
  /** Mostra a seta à direita. Padrão: sim quando há `aoPressionar`. */
  navega?: boolean;
  destrutivo?: boolean;
  desabilitado?: boolean;
  /** Último item do grupo, por exemplo: sem a linha de baixo. */
  semSeparador?: boolean;
  testID?: string;
}

const ALTURA_DE_UMA_LINHA = 56;
const ALTURA_DE_DUAS_LINHAS = 72;

export function ItemDeLista({
  titulo,
  descricao,
  icone,
  aoPressionar,
  navega,
  destrutivo = false,
  desabilitado = false,
  semSeparador = false,
  testID,
}: ItemDeListaProps) {
  const foco = useFoco();
  const interativo = aoPressionar !== undefined;
  const mostrarSeta = navega ?? interativo;
  const corDoTitulo = desabilitado
    ? temaClaro.text.tertiary
    : destrutivo
      ? temaClaro.status.danger.fg
      : temaClaro.text.primary;

  const conteudo = (
    <>
      {icone ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={estilos.icone}
        >
          {icone}
        </View>
      ) : null}
      <View style={estilos.textos}>
        <Text style={[estilos.titulo, { color: corDoTitulo }]}>{titulo}</Text>
        {descricao ? <Text style={estilos.descricao}>{descricao}</Text> : null}
      </View>
      {mostrarSeta ? (
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={estilos.seta}
        >
          ›
        </Text>
      ) : null}
    </>
  );

  const alturaMinima = descricao ? ALTURA_DE_DUAS_LINHAS : ALTURA_DE_UMA_LINHA;

  return (
    <View testID={testID}>
      {interativo ? (
        <Pressable
          role="button"
          accessibilityLabel={descricao ? `${titulo}. ${descricao}` : titulo}
          accessibilityState={{ disabled: desabilitado }}
          onPress={desabilitado ? undefined : aoPressionar}
          onFocus={foco.aoFocar}
          onBlur={foco.aoDesfocar}
          style={({ pressed }) => [
            estilos.linha,
            { minHeight: alturaMinima },
            pressed && !desabilitado && estilos.linhaPressionada,
            foco.focado && anelDeFoco,
          ]}
        >
          {conteudo}
        </Pressable>
      ) : (
        <View style={[estilos.linha, { minHeight: alturaMinima }]}>{conteudo}</View>
      )}
      {semSeparador ? null : (
        <View
          testID={testID ? `${testID}-separador` : undefined}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[estilos.separador, icone ? estilos.separadorComIcone : null]}
        />
      )}
    </View>
  );
}

const LARGURA_DO_ICONE = tamanho.icon.lg;

const estilos = StyleSheet.create({
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco[3],
    paddingHorizontal: espaco[4],
    paddingVertical: espaco[2],
    borderRadius: raio.md,
  },
  linhaPressionada: { backgroundColor: temaClaro.bg.subtle },
  icone: { width: LARGURA_DO_ICONE, alignItems: 'center' },
  textos: { flex: 1 },
  titulo: estiloDeTexto('body'),
  descricao: { ...estiloDeTexto('bodySm'), color: temaClaro.text.secondary },
  seta: { ...estiloDeTexto('title'), color: temaClaro.text.secondary },
  // Recuo igual à margem do texto (`space.4`; com ícone, mais a largura dele e o respiro).
  separador: { height: 1, marginLeft: espaco[4], backgroundColor: temaClaro.border.subtle },
  separadorComIcone: { marginLeft: espaco[4] + LARGURA_DO_ICONE + espaco[3] },
});
