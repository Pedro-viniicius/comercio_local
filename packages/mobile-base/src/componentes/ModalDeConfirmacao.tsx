// Modal de confirmação (design system, "Folha inferior e modais"): só para ação destrutiva ou
// irreversível. Título com a pergunta, texto com a consequência e botões com verbos. Com
// `graveDestrutiva`, a ação segura ganha o destaque (botão primário) e a destrutiva fica no
// secundário. O toque no fundo não fecha (evita confirmar ou cancelar sem querer); o botão "voltar"
// do Android cancela. Ao abrir, o leitor de tela vai para o título.
import { espaco, raio, temaClaro } from '@bairrin/tokens';
import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type HostInstance,
} from 'react-native';
import { Botao } from './Botao.tsx';
import { corComOpacidade, estiloDeTexto, sombraDeElevacao } from './estilos.ts';

export interface ModalDeConfirmacaoProps {
  visivel: boolean;
  /** A pergunta ("Pedir cópia dos seus dados?"). */
  titulo: string;
  /** A consequência, em uma ou duas frases. */
  texto: string;
  /** Verbo + objeto ("Pedir cópia"). */
  rotuloConfirmar: string;
  /** Padrão da tela: "Cancelar" ou "Voltar". */
  rotuloCancelar: string;
  aoConfirmar: () => void;
  aoCancelar: () => void;
  /** A confirmação é destrutiva (botão vermelho). */
  destrutivo?: boolean;
  /** Ação destrutiva grave: o destaque vai para o botão seguro. */
  graveDestrutiva?: boolean;
  /** A confirmação está em andamento: o botão fica ocupado e o cancelamento, desligado. */
  carregando?: boolean;
  testID?: string;
}

export function ModalDeConfirmacao({
  visivel,
  titulo,
  texto,
  rotuloConfirmar,
  rotuloCancelar,
  aoConfirmar,
  aoCancelar,
  destrutivo = false,
  graveDestrutiva = false,
  carregando = false,
  testID,
}: ModalDeConfirmacaoProps) {
  const refDoTitulo = useRef<HostInstance>(null);
  // Com a fonte do sistema ampliada o cartão passa da janela: ele rola em vez de cortar os botões.
  const { height: alturaDaJanela } = useWindowDimensions();
  const alturaMaxima = Math.max(alturaDaJanela - espaco[4] * 2, 0);

  useEffect(() => {
    if (visivel && refDoTitulo.current) {
      AccessibilityInfo.sendAccessibilityEvent(refDoTitulo.current, 'focus');
    }
  }, [visivel]);

  const varianteDeConfirmar = graveDestrutiva
    ? 'secundario'
    : destrutivo
      ? 'destrutivo'
      : 'primario';

  return (
    <Modal
      visible={visivel}
      transparent
      animationType="fade"
      onRequestClose={carregando ? undefined : aoCancelar}
      testID={testID}
    >
      <View style={estilos.fundo}>
        <View
          testID="modal-de-confirmacao-cartao"
          accessibilityViewIsModal
          role="alertdialog"
          style={[estilos.cartao, sombraDeElevacao(3), { maxHeight: alturaMaxima }]}
        >
          <ScrollView
            testID="modal-de-confirmacao-rolagem"
            contentContainerStyle={estilos.conteudo}
            bounces={false}
          >
            <Text ref={refDoTitulo} role="heading" style={estilos.titulo}>
              {titulo}
            </Text>
            <Text style={estilos.texto}>{texto}</Text>
            <View style={estilos.botoes}>
              <Botao
                rotulo={rotuloConfirmar}
                variante={varianteDeConfirmar}
                aoPressionar={aoConfirmar}
                carregando={carregando}
              />
              <Botao
                rotulo={rotuloCancelar}
                variante={graveDestrutiva ? 'primario' : 'terciario'}
                aoPressionar={aoCancelar}
                desabilitado={carregando}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  fundo: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: espaco[4],
    backgroundColor: corComOpacidade(temaClaro.overlay.scrim),
  },
  cartao: {
    width: '100%',
    maxWidth: 400,
    borderRadius: raio.xl,
    backgroundColor: temaClaro.bg.surface,
  },
  conteudo: { gap: espaco[3], padding: espaco[6] },
  titulo: { ...estiloDeTexto('titleSm', 'semibold'), color: temaClaro.text.primary },
  texto: { ...estiloDeTexto('body'), color: temaClaro.text.secondary },
  botoes: { gap: espaco[2], marginTop: espaco[2] },
});
