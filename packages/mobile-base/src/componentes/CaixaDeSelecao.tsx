// Caixa de seleção (checkbox) com texto e links (spec 01, "Componentes"): 24 px visuais, alvo de
// 44, borda `border.control`, marcada com fundo `blue.600` (`action.primary`) e check branco, erro
// com borda `red.600` e mensagem. O rótulo é uma lista de trechos: texto puro e links (os Termos e
// a Política abrem o Leitor de texto legal). Os links não são alcançáveis dentro de um controle
// único para o leitor de tela, então saem também como ações de acessibilidade do controle.
import { espaco, raio, tamanho, temaClaro } from '@bairrin/tokens';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, type AccessibilityActionEvent } from 'react-native';
import { textos } from '../textos/pt-BR.ts';
import { anunciar, useFoco } from './acessibilidade.ts';
import { anelDeFoco, estiloDeTexto } from './estilos.ts';

export interface LinkDoRotulo {
  texto: string;
  aoPressionar: () => void;
}

export interface CaixaDeSelecaoProps {
  /** Trechos do rótulo, na ordem: texto puro ou link. */
  rotulo: readonly (string | LinkDoRotulo)[];
  marcada: boolean;
  aoAlternar: (marcada: boolean) => void;
  /** Mensagem de erro (borda de perigo e texto abaixo, anunciada). */
  erro?: string;
  desabilitada?: boolean;
  testID?: string;
}

const NOME_DA_ACAO = 'abrir-link-';

export function CaixaDeSelecao({
  rotulo,
  marcada,
  aoAlternar,
  erro,
  desabilitada = false,
  testID,
}: CaixaDeSelecaoProps) {
  const foco = useFoco();
  const links = rotulo.filter((trecho): trecho is LinkDoRotulo => typeof trecho !== 'string');
  const textoCompleto = rotulo
    .map((trecho) => (typeof trecho === 'string' ? trecho : trecho.texto))
    .join('');

  // O Android anuncia pela região viva do erro; o iOS não, então o erro novo é dito à mão.
  useEffect(() => {
    if (erro) anunciar(erro);
  }, [erro]);

  const aoAcionar = (evento: AccessibilityActionEvent) => {
    const nome = evento.nativeEvent.actionName;
    if (!nome.startsWith(NOME_DA_ACAO)) return;
    links[Number(nome.slice(NOME_DA_ACAO.length))]?.aoPressionar();
  };

  return (
    <View style={estilos.bloco}>
      <Pressable
        role="checkbox"
        testID={testID}
        accessibilityLabel={textoCompleto}
        accessibilityHint={erro}
        accessibilityState={{ checked: marcada, disabled: desabilitada }}
        accessibilityActions={links.map((link, indice) => ({
          name: `${NOME_DA_ACAO}${indice}`,
          label: textos.componentes.abrirLink(link.texto),
        }))}
        onAccessibilityAction={aoAcionar}
        onPress={desabilitada ? undefined : () => aoAlternar(!marcada)}
        onFocus={foco.aoFocar}
        onBlur={foco.aoDesfocar}
        style={[estilos.linha, foco.focado && anelDeFoco]}
      >
        <View
          testID="caixa-de-selecao-quadrado"
          style={[
            estilos.caixa,
            marcada && estilos.caixaMarcada,
            erro ? estilos.caixaComErro : null,
            desabilitada && estilos.caixaDesabilitada,
          ]}
        >
          {marcada ? (
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              // O glifo mora num quadrado fixo de 24 px: não acompanha a fonte do sistema.
              allowFontScaling={false}
              style={estilos.check}
            >
              ✓
            </Text>
          ) : null}
        </View>
        <Text style={[estilos.rotulo, desabilitada && estilos.rotuloDesabilitado]}>
          {rotulo.map((trecho, indice) =>
            typeof trecho === 'string' ? (
              trecho
            ) : (
              <Text
                key={`${indice}-${trecho.texto}`}
                role="link"
                onPress={desabilitada ? undefined : trecho.aoPressionar}
                style={estilos.link}
              >
                {trecho.texto}
              </Text>
            ),
          )}
        </Text>
      </Pressable>
      {/* A região existe sempre, então o erro que aparece depois é anunciado. */}
      <View accessibilityLiveRegion="polite">
        {erro ? (
          <View style={estilos.linhaDoErro}>
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={estilos.erro}
            >
              !
            </Text>
            <Text style={[estilos.erro, estilos.textoDoErro]}>{erro}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const LADO_DA_CAIXA = 24;

const estilos = StyleSheet.create({
  bloco: { gap: espaco[1] },
  // O alvo de toque é a linha inteira (44 de altura no mínimo), não só o quadrado de 24.
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco[3],
    minHeight: tamanho.touch.min,
    borderRadius: raio.md,
  },
  caixa: {
    width: LADO_DA_CAIXA,
    height: LADO_DA_CAIXA,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: raio.sm,
    borderWidth: 2,
    borderColor: temaClaro.border.control,
    backgroundColor: temaClaro.bg.surface,
  },
  caixaMarcada: {
    borderColor: temaClaro.action.primary,
    backgroundColor: temaClaro.action.primary,
  },
  caixaComErro: { borderColor: temaClaro.status.danger.solid },
  caixaDesabilitada: { backgroundColor: temaClaro.bg.subtle },
  check: { ...estiloDeTexto('bodySm', 'semibold'), color: temaClaro.text.onAction },
  rotulo: { ...estiloDeTexto('body'), flex: 1, color: temaClaro.text.primary },
  rotuloDesabilitado: { color: temaClaro.text.tertiary },
  link: { color: temaClaro.text.link, textDecorationLine: 'underline' },
  linhaDoErro: { flexDirection: 'row', gap: espaco[1] },
  erro: { ...estiloDeTexto('bodySm', 'semibold'), color: temaClaro.status.danger.fg },
  textoDoErro: { flex: 1 },
});
