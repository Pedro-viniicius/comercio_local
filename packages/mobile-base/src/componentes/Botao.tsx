// Botão (design system, "Botões"): primário, secundário, terciário e destrutivo. Estados:
// pressionado, foco (anel `focus.ring`, D8), desabilitado e carregando (D2). Carregando e
// desabilitado não usam a propriedade `disabled` do `Pressable`: o botão continua na árvore de
// acessibilidade, com o foco, e o toque é ignorado aqui. O alvo tem no mínimo 44 de altura.
import { espaco, raio, tamanho, temaClaro } from '@bairrin/tokens';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { textos } from '../textos/pt-BR.ts';
import { useFoco } from './acessibilidade.ts';
import { anelDeFoco, estiloDeTexto } from './estilos.ts';

export type VarianteDoBotao = 'primario' | 'secundario' | 'terciario' | 'destrutivo';

export interface BotaoProps {
  /** Verbo + objeto ("Criar conta"). Quebra em duas linhas, nunca corta. */
  rotulo: string;
  aoPressionar: () => void;
  /** Padrão: `primario`. */
  variante?: VarianteDoBotao;
  /** A razão fica na tela, perto do botão ("Sem conexão: tente quando voltar"). */
  desabilitado?: boolean;
  /** Mostra o indicador e `rotuloCarregando`; ignora o toque (sem toque duplo). */
  carregando?: boolean;
  /** Padrão: "Enviando…". */
  rotuloCarregando?: string;
  /** Texto lido a mais depois do rótulo (por exemplo, a razão de estar desabilitado). */
  dica?: string;
  testID?: string;
}

interface Cores {
  fundo: string;
  fundoPressionado: string;
  texto: string;
  borda: string;
}

const porVariante: Record<VarianteDoBotao, Cores> = {
  primario: {
    fundo: temaClaro.action.primary,
    fundoPressionado: temaClaro.action.primaryPressed,
    texto: temaClaro.text.onAction,
    borda: 'transparent',
  },
  secundario: {
    fundo: temaClaro.bg.surface,
    fundoPressionado: temaClaro.bg.subtle,
    texto: temaClaro.text.link,
    borda: temaClaro.action.primary,
  },
  terciario: {
    fundo: 'transparent',
    fundoPressionado: temaClaro.bg.subtle,
    texto: temaClaro.text.link,
    borda: 'transparent',
  },
  destrutivo: {
    fundo: temaClaro.action.destructive,
    fundoPressionado: temaClaro.action.destructivePressed,
    texto: temaClaro.text.onAction,
    borda: 'transparent',
  },
};

export function Botao({
  rotulo,
  aoPressionar,
  variante = 'primario',
  desabilitado = false,
  carregando = false,
  rotuloCarregando = textos.componentes.enviando,
  dica,
  testID,
}: BotaoProps) {
  const { focado, aoFocar, aoDesfocar } = useFoco();
  const inativo = desabilitado || carregando;
  const cores = porVariante[variante];
  const ehTerciario = variante === 'terciario';

  const fundo = (pressionado: boolean): ViewStyle => {
    if (carregando || desabilitado) {
      // Terciário não tem fundo: só o texto muda de cor.
      return {
        backgroundColor: ehTerciario ? 'transparent' : temaClaro.bg.subtle,
        borderColor: 'transparent',
      };
    }
    return {
      backgroundColor: pressionado ? cores.fundoPressionado : cores.fundo,
      borderColor: cores.borda,
    };
  };
  // O ocupado usa o texto secundário (mais forte que o de desabilitado) sobre o fundo apagado.
  const corDoTexto = carregando
    ? temaClaro.text.secondary
    : desabilitado
      ? temaClaro.text.tertiary
      : cores.texto;

  return (
    <Pressable
      role="button"
      testID={testID}
      accessibilityLabel={carregando ? rotuloCarregando : rotulo}
      accessibilityHint={dica}
      aria-disabled={inativo}
      accessibilityState={{ disabled: inativo, busy: carregando }}
      onPress={inativo ? undefined : aoPressionar}
      onFocus={aoFocar}
      onBlur={aoDesfocar}
      style={({ pressed }) => [
        estilos.base,
        ehTerciario ? estilos.terciario : estilos.cheio,
        fundo(pressed && !inativo),
        focado && anelDeFoco,
      ]}
    >
      <View style={estilos.conteudo}>
        {carregando ? (
          <ActivityIndicator
            testID="botao-indicador"
            size="small"
            color={temaClaro.text.secondary}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : null}
        <Text style={[estilos.rotulo, { color: corDoTexto }]}>
          {carregando ? rotuloCarregando : rotulo}
        </Text>
      </View>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: espaco[4],
    paddingVertical: espaco[2],
    borderRadius: raio.md,
    borderWidth: 1,
  },
  // Altura 48 (`size.control.height`); cresce com o texto ampliado.
  cheio: { minHeight: tamanho.control.height.mobile },
  terciario: { minHeight: tamanho.touch.min },
  conteudo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: espaco[2],
  },
  rotulo: { ...estiloDeTexto('body', 'semibold'), textAlign: 'center', flexShrink: 1 },
});
