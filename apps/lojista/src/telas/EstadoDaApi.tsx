// Estado da API (CA-F6 do plano 01a): mostra se a API responde. O cliente chega por propriedade
// para o teste trocar por um falso; `null` = sem endereço (EXPO_PUBLIC_API_URL).
import { ehErroSemConexao, type ClienteApi } from '@bairrin/cliente-api';
import { espaco, fonte, pesoDaFonte, raio, tamanho, temaClaro } from '@bairrin/tokens';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { textos } from '../textos/pt-BR.ts';

type Estado = 'verificando' | 'disponivel' | 'semConexao' | 'erroDaApi';
type Tom = 'neutral' | 'success' | 'warning' | 'danger';

interface Apresentacao {
  tom: Tom;
  /** Reforço do texto para quem não distingue cor; escondido do leitor de tela. */
  simbolo: string;
  texto: string;
  dica?: string;
  podeTentarDeNovo: boolean;
}

const t = textos.estadoDaApi;

const apresentacoes: Record<Estado | 'semConfiguracao', Apresentacao> = {
  verificando: { tom: 'neutral', simbolo: '…', texto: t.verificando, podeTentarDeNovo: false },
  disponivel: { tom: 'success', simbolo: '✓', texto: t.disponivel, podeTentarDeNovo: false },
  semConexao: {
    tom: 'warning',
    simbolo: '!',
    texto: t.semConexao,
    dica: t.semConexaoDica,
    podeTentarDeNovo: true,
  },
  erroDaApi: {
    tom: 'danger',
    simbolo: '✕',
    texto: t.erroDaApi,
    dica: t.erroDaApiDica,
    podeTentarDeNovo: true,
  },
  semConfiguracao: {
    tom: 'warning',
    simbolo: '!',
    texto: t.semConfiguracao,
    dica: t.semConfiguracaoDica,
    podeTentarDeNovo: false,
  },
};

export interface EstadoDaApiProps {
  cliente: Pick<ClienteApi, 'consultarSaude'> | null;
}

export function EstadoDaApi({ cliente }: EstadoDaApiProps) {
  const [estado, setEstado] = useState<Estado>('verificando');
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!cliente) return;
    const controlador = new AbortController();
    cliente
      .consultarSaude({ sinal: controlador.signal })
      .then(() => setEstado('disponivel'))
      .catch((erro: unknown) => {
        // Troca de tentativa ou desmontagem: quem cancelou já cuida do estado.
        if (controlador.signal.aborted) return;
        setEstado(ehErroSemConexao(erro) ? 'semConexao' : 'erroDaApi');
      });
    return () => controlador.abort();
  }, [cliente, tentativa]);

  const chave = cliente ? estado : 'semConfiguracao';
  const apresentacao = apresentacoes[chave];
  const cores = temaClaro.status[apresentacao.tom];

  // O Android anuncia pela região viva; o iOS não, então o resultado é anunciado à mão (nunca o
  // "Verificando…" inicial ou das novas tentativas, que o botão já sinaliza como ocupado).
  const textoAnunciado =
    chave === 'verificando'
      ? null
      : [apresentacao.texto, apresentacao.dica].filter(Boolean).join('. ');
  useEffect(() => {
    if (textoAnunciado) AccessibilityInfo.announceForAccessibility(textoAnunciado);
  }, [textoAnunciado]);

  // O botão fica na tela (com o foco) enquanto verifica de novo; o resultado é anunciado pela
  // região de status.
  const verificandoDeNovo = estado === 'verificando' && tentativa > 0;
  const mostrarBotao = apresentacao.podeTentarDeNovo || (Boolean(cliente) && verificandoDeNovo);

  const tentarDeNovo = () => {
    if (verificandoDeNovo) return;
    setEstado('verificando');
    setTentativa((anterior) => anterior + 1);
  };

  return (
    <View style={estilos.cartao}>
      <Text role="heading" style={estilos.secao}>
        {t.secao}
      </Text>
      <View style={[estilos.estado, { backgroundColor: cores.bg }]}>
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[estilos.simbolo, { color: cores.fg }]}
        >
          {apresentacao.simbolo}
        </Text>
        {/* A região existe desde o início, então a troca de texto é anunciada. */}
        <View accessible role="status" accessibilityLiveRegion="polite" style={estilos.textos}>
          <Text style={[estilos.texto, { color: cores.fg }]}>{apresentacao.texto}</Text>
          {apresentacao.dica ? (
            <Text style={[estilos.dica, { color: cores.fg }]}>{apresentacao.dica}</Text>
          ) : null}
        </View>
      </View>
      {mostrarBotao ? (
        <Pressable
          role="button"
          aria-disabled={verificandoDeNovo}
          accessibilityState={{ disabled: verificandoDeNovo, busy: verificandoDeNovo }}
          onPress={tentarDeNovo}
          style={({ pressed }) => [
            estilos.botao,
            verificandoDeNovo ? estilos.botaoOcupado : pressed && estilos.botaoPressionado,
          ]}
        >
          <Text style={[estilos.botaoTexto, verificandoDeNovo && estilos.botaoTextoOcupado]}>
            {verificandoDeNovo ? t.verificandoBotao : t.tentarDeNovo}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  cartao: {
    gap: espaco[4],
    padding: espaco[4],
    borderRadius: raio.lg,
    borderWidth: 1,
    borderColor: temaClaro.border.subtle,
    backgroundColor: temaClaro.bg.surface,
  },
  secao: {
    fontSize: fonte.titleSm.tamanho,
    lineHeight: fonte.titleSm.alturaLinha,
    fontWeight: `${pesoDaFonte.semibold}`,
    color: temaClaro.text.primary,
  },
  estado: {
    flexDirection: 'row',
    gap: espaco[3],
    padding: espaco[3],
    borderRadius: raio.md,
  },
  simbolo: {
    fontSize: fonte.body.tamanho,
    lineHeight: fonte.body.alturaLinha,
    fontWeight: `${pesoDaFonte.semibold}`,
  },
  textos: { flex: 1 },
  texto: {
    fontSize: fonte.body.tamanho,
    lineHeight: fonte.body.alturaLinha,
    fontWeight: `${pesoDaFonte.semibold}`,
  },
  dica: {
    fontSize: fonte.bodySm.tamanho,
    lineHeight: fonte.bodySm.alturaLinha,
  },
  botao: {
    minHeight: tamanho.touch.min,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: espaco[4],
    borderRadius: raio.md,
    backgroundColor: temaClaro.action.primary,
  },
  botaoPressionado: { backgroundColor: temaClaro.action.primaryPressed },
  botaoOcupado: { backgroundColor: temaClaro.bg.subtle },
  botaoTextoOcupado: { color: temaClaro.text.secondary },
  botaoTexto: {
    fontSize: fonte.body.tamanho,
    lineHeight: fonte.body.alturaLinha,
    fontWeight: `${pesoDaFonte.semibold}`,
    color: temaClaro.text.onAction,
  },
});
