// Cabeçalho de marca (spec 01, "Componentes" e "Layout"): logo horizontal (60% da largura, até
// 160 px) com o slogan abaixo. Só nas telas A1 e A2. O logo é o SVG da marca em `SvgXml`; o
// leitor de tela ouve "Bairrin" e depois o slogan.
import { espaco, temaClaro } from '@bairrin/tokens';
import { StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { textos } from '../textos/pt-BR.ts';
import { estiloDeTexto } from './estilos.ts';
import { LOGO_HORIZONTAL } from './marca/logo.ts';

export interface CabecalhoDeMarcaProps {
  /** Padrão: o slogan do consumidor ("lojas do seu bairro"). O lojista usa o dele. */
  slogan?: string;
  testID?: string;
}

/** Proporção do `viewBox` do logo horizontal (197 × 66). */
const PROPORCAO_DO_LOGO = 197 / 66;
const LARGURA_MAXIMA_DO_LOGO = 160;

export function CabecalhoDeMarca({
  slogan = textos.componentes.marca.sloganConsumidor,
  testID,
}: CabecalhoDeMarcaProps) {
  return (
    <View testID={testID} style={estilos.cabecalho}>
      <View
        role="img"
        accessible
        accessibilityLabel={textos.componentes.marca.nome}
        style={estilos.logo}
      >
        <SvgXml xml={LOGO_HORIZONTAL} width="100%" height="100%" />
      </View>
      <Text style={estilos.slogan}>{slogan}</Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  cabecalho: { alignSelf: 'stretch', alignItems: 'center', gap: espaco[2] },
  logo: { width: '60%', maxWidth: LARGURA_MAXIMA_DO_LOGO, aspectRatio: PROPORCAO_DO_LOGO },
  slogan: { ...estiloDeTexto('body'), textAlign: 'center', color: temaClaro.text.secondary },
});
