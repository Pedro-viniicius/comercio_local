// Barra superior (design system, "Barra superior"): altura 56, fundo `bg.surface`, título em uma
// linha com reticências (o texto completo é o nome acessível), "Voltar" à esquerda (44×44) e até
// duas ações à direita. Ao rolar o conteúdo, ganha `elevation.1` (`elevada`). O ícone das ações é
// um nó da tela (não há conjunto de ícones aprovado), sempre com rótulo acessível.
import { espaco, raio, tamanho, temaClaro } from '@bairrin/tokens';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { textos } from '../textos/pt-BR.ts';
import { useFoco } from './acessibilidade.ts';
import { anelDeFoco, estiloDeTexto, sombraDeElevacao } from './estilos.ts';

export interface AcaoDaBarra {
  /** Nome acessível do botão (ex.: "Notificações"). */
  rotulo: string;
  /** O que aparece no botão: um ícone, um símbolo ou um texto curto. Escondido do leitor de tela. */
  conteudo: ReactNode;
  aoPressionar: () => void;
  /** Contagem do selo (ex.: notificações). Sem ela, sem selo; acima de 99 vira "99+". */
  selo?: number;
}

export interface BarraSuperiorProps {
  titulo: string;
  /** Com ele, aparece o "Voltar". */
  aoVoltar?: () => void;
  /** Até duas; o resto é ignorado. */
  acoes?: readonly AcaoDaBarra[];
  /** Sombra de `elevation.1`: a tela liga quando o conteúdo rolou. */
  elevada?: boolean;
  testID?: string;
}

const MAXIMO_DE_ACOES = 2;

export function textoDoSelo(contagem: number): string {
  return contagem > 99 ? '99+' : String(contagem);
}

function BotaoDaBarra({
  rotulo,
  aoPressionar,
  selo,
  children,
}: {
  rotulo: string;
  aoPressionar: () => void;
  selo?: number;
  children: ReactNode;
}) {
  const foco = useFoco();
  const comSelo = selo !== undefined && selo > 0;
  return (
    <Pressable
      role="button"
      accessibilityLabel={comSelo ? `${rotulo}, ${textoDoSelo(selo)}` : rotulo}
      onPress={aoPressionar}
      onFocus={foco.aoFocar}
      onBlur={foco.aoDesfocar}
      style={({ pressed }) => [
        estilos.botao,
        pressed && estilos.botaoPressionado,
        foco.focado && anelDeFoco,
      ]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={estilos.conteudoDoBotao}
      >
        {children}
      </View>
      {comSelo ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={estilos.selo}
        >
          <Text style={estilos.seloTexto}>{textoDoSelo(selo)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function BarraSuperior({
  titulo,
  aoVoltar,
  acoes = [],
  elevada = false,
  testID,
}: BarraSuperiorProps) {
  return (
    <View testID={testID} style={[estilos.barra, elevada && sombraDeElevacao(1)]}>
      {aoVoltar ? (
        <BotaoDaBarra rotulo={textos.componentes.voltar} aoPressionar={aoVoltar}>
          <Text style={estilos.simbolo}>‹</Text>
        </BotaoDaBarra>
      ) : null}
      <Text
        role="heading"
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[estilos.titulo, !aoVoltar && estilos.tituloSemVoltar]}
      >
        {titulo}
      </Text>
      {acoes.slice(0, MAXIMO_DE_ACOES).map((acao) => (
        <BotaoDaBarra
          key={acao.rotulo}
          rotulo={acao.rotulo}
          aoPressionar={acao.aoPressionar}
          selo={acao.selo}
        >
          {acao.conteudo}
        </BotaoDaBarra>
      ))}
    </View>
  );
}

const estilos = StyleSheet.create({
  barra: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: espaco[2],
    backgroundColor: temaClaro.bg.surface,
  },
  titulo: {
    ...estiloDeTexto('titleSm', 'semibold'),
    flex: 1,
    paddingHorizontal: espaco[2],
    color: temaClaro.text.primary,
  },
  // Sem o "Voltar", o título alinha com a margem da tela (`space.4`).
  tituloSemVoltar: { paddingLeft: espaco[2] },
  botao: {
    width: tamanho.touch.min,
    height: tamanho.touch.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: raio.md,
  },
  botaoPressionado: { backgroundColor: temaClaro.bg.subtle },
  conteudoDoBotao: { alignItems: 'center', justifyContent: 'center' },
  simbolo: { ...estiloDeTexto('title'), color: temaClaro.text.primary },
  selo: {
    position: 'absolute',
    top: espaco[1],
    right: espaco[1],
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: espaco[1],
    borderRadius: raio.full,
    backgroundColor: temaClaro.status.danger.solid,
  },
  seloTexto: { ...estiloDeTexto('caption', 'semibold'), color: temaClaro.text.onAction },
});
