// Banner em linha (design system, "Toasts e banners"): fundo e texto do tom semântico, símbolo
// (a cor nunca é o único sinal), título curto, ação opcional e "Fechar" quando dispensável. O de
// erro é assertivo (`role="alert"`); os outros, educados (`role="status"`). O símbolo não é lido.
import { espaco, raio, tamanho, temaClaro } from '@bairrin/tokens';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { textos } from '../textos/pt-BR.ts';
import { anunciar, useFoco } from './acessibilidade.ts';
import { anelDeFoco, estiloDeTexto } from './estilos.ts';

export type TomDoBanner = 'informativo' | 'sucesso' | 'aviso' | 'erro';

export interface AcaoDoBanner {
  rotulo: string;
  aoPressionar: () => void;
}

export interface BannerProps {
  tom: TomDoBanner;
  /** Texto do banner. */
  mensagem: string;
  /** Título curto, em negrito, acima da mensagem. */
  titulo?: string;
  acao?: AcaoDoBanner;
  /** Com ele, aparece o botão "Fechar". Sem ele, o banner não é dispensável. */
  aoFechar?: () => void;
  testID?: string;
}

const porTom = {
  informativo: { cores: temaClaro.status.info, simbolo: 'i' },
  sucesso: { cores: temaClaro.status.success, simbolo: '✓' },
  aviso: { cores: temaClaro.status.warning, simbolo: '!' },
  erro: { cores: temaClaro.status.danger, simbolo: '✕' },
} as const;

function BotaoDoBanner({
  rotulo,
  rotuloAcessivel,
  cor,
  aoPressionar,
}: {
  rotulo: string;
  rotuloAcessivel?: string;
  cor: string;
  aoPressionar: () => void;
}) {
  const foco = useFoco();
  return (
    <Pressable
      role="button"
      accessibilityLabel={rotuloAcessivel ?? rotulo}
      onPress={aoPressionar}
      onFocus={foco.aoFocar}
      onBlur={foco.aoDesfocar}
      style={({ pressed }) => [
        estilos.botao,
        pressed && estilos.botaoPressionado,
        foco.focado && anelDeFoco,
      ]}
    >
      <Text style={[estilos.botaoTexto, { color: cor }]}>{rotulo}</Text>
    </Pressable>
  );
}

export function Banner({ tom, mensagem, titulo, acao, aoFechar, testID }: BannerProps) {
  const { cores, simbolo } = porTom[tom];
  const assertivo = tom === 'erro';
  const textoAnunciado = titulo ? `${titulo}. ${mensagem}` : mensagem;

  // O Android anuncia pela região viva; o iOS não, então o banner novo é dito à mão.
  useEffect(() => {
    anunciar(textoAnunciado);
  }, [textoAnunciado]);

  return (
    <View testID={testID} style={[estilos.banner, { backgroundColor: cores.bg }]}>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[estilos.simbolo, { color: cores.fg }]}
      >
        {simbolo}
      </Text>
      <View style={estilos.corpo}>
        {/* Só o texto é a região viva: os botões ao lado continuam focáveis um a um. */}
        <View
          accessible
          role={assertivo ? 'alert' : 'status'}
          accessibilityLiveRegion={assertivo ? 'assertive' : 'polite'}
          style={estilos.textos}
        >
          {titulo ? <Text style={[estilos.titulo, { color: cores.fg }]}>{titulo}</Text> : null}
          <Text style={[estilos.mensagem, { color: cores.fg }]}>{mensagem}</Text>
        </View>
        {acao ? (
          <BotaoDoBanner rotulo={acao.rotulo} cor={cores.fg} aoPressionar={acao.aoPressionar} />
        ) : null}
      </View>
      {aoFechar ? (
        <BotaoDoBanner
          rotulo={textos.componentes.fechar}
          rotuloAcessivel={
            titulo ? `${textos.componentes.fecharAviso}: ${titulo}` : textos.componentes.fecharAviso
          }
          cor={cores.fg}
          aoPressionar={aoFechar}
        />
      ) : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: espaco[3],
    padding: espaco[3],
    borderRadius: raio.md,
  },
  simbolo: { ...estiloDeTexto('body', 'semibold'), minWidth: espaco[4], textAlign: 'center' },
  corpo: { flex: 1, gap: espaco[1] },
  textos: { gap: espaco[1] },
  titulo: estiloDeTexto('bodySm', 'semibold'),
  mensagem: estiloDeTexto('bodySm'),
  botao: {
    alignSelf: 'flex-start',
    minHeight: tamanho.touch.min,
    justifyContent: 'center',
    paddingHorizontal: espaco[2],
    borderRadius: raio.md,
  },
  botaoPressionado: { backgroundColor: temaClaro.bg.subtle },
  botaoTexto: { ...estiloDeTexto('bodySm', 'semibold'), textDecorationLine: 'underline' },
});
