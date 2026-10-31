// Estado vazio (design system, "Estados vazios"): ícone de 48 px `neutral.500`, título dizendo o
// que falta, uma frase do porquê e uma ação principal e, se couber, uma segunda (ex.: "Entrar" e
// "Criar conta"). Também serve de erro de carregamento ("Tentar de novo"). Nunca tela em branco.
import { espaco, temaClaro } from '@bairrin/tokens';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Botao, type VarianteDoBotao } from './Botao.tsx';
import { estiloDeTexto } from './estilos.ts';

export interface AcaoDoEstadoVazio {
  rotulo: string;
  aoPressionar: () => void;
  /** Padrão: `primario` na ação principal e `terciario` na segunda. */
  variante?: VarianteDoBotao;
  desabilitada?: boolean;
  carregando?: boolean;
}

export interface EstadoVazioProps {
  titulo: string;
  texto?: string;
  /** Ícone ou símbolo de 48 px; é decorativo (escondido do leitor de tela). */
  icone?: ReactNode;
  acao?: AcaoDoEstadoVazio;
  acaoSecundaria?: AcaoDoEstadoVazio;
  testID?: string;
}

function BotaoDaAcao({ acao, padrao }: { acao: AcaoDoEstadoVazio; padrao: VarianteDoBotao }) {
  return (
    <Botao
      rotulo={acao.rotulo}
      aoPressionar={acao.aoPressionar}
      variante={acao.variante ?? padrao}
      desabilitado={acao.desabilitada}
      carregando={acao.carregando}
    />
  );
}

export function EstadoVazio({
  titulo,
  texto,
  icone,
  acao,
  acaoSecundaria,
  testID,
}: EstadoVazioProps) {
  return (
    <View testID={testID} style={estilos.bloco}>
      {icone ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={estilos.icone}
        >
          {icone}
        </View>
      ) : null}
      <Text role="heading" style={estilos.titulo}>
        {titulo}
      </Text>
      {texto ? <Text style={estilos.texto}>{texto}</Text> : null}
      {acao || acaoSecundaria ? (
        <View style={estilos.acoes}>
          {acao ? <BotaoDaAcao acao={acao} padrao="primario" /> : null}
          {acaoSecundaria ? <BotaoDaAcao acao={acaoSecundaria} padrao="terciario" /> : null}
        </View>
      ) : null}
    </View>
  );
}

const TAMANHO_DO_ICONE = 48;

const estilos = StyleSheet.create({
  bloco: { alignItems: 'center', gap: espaco[3], padding: espaco[6] },
  icone: {
    width: TAMANHO_DO_ICONE,
    height: TAMANHO_DO_ICONE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titulo: {
    ...estiloDeTexto('titleSm', 'semibold'),
    textAlign: 'center',
    color: temaClaro.text.primary,
  },
  texto: { ...estiloDeTexto('body'), textAlign: 'center', color: temaClaro.text.secondary },
  acoes: { alignSelf: 'stretch', gap: espaco[2], marginTop: espaco[2] },
});
