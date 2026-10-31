// Toast (design system, "Toasts e banners"): fundo `toast.bg`, texto `text.onAction`, símbolo por
// tipo; some em 4 s (6 s com ação "Desfazer"; o dobro com leitor de tela ou fonte ampliada);
// pausa com foco ou toque; anunciado de forma educada. Erro que exige ação nunca é toast: vira
// Banner ou erro de campo (por isso não há tipo de erro). Sem animação: com "remover animações" ligado o comportamento já é o pedido.
// `ProvedorDeToast` põe um toast por vez acima do conteúdo; `useToast()` o dispara de qualquer tela.
import { espaco, raio, tamanho, temaClaro } from '@bairrin/tokens';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AccessibilityInfo, PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';
import { anunciar, useFoco } from './acessibilidade.ts';
import { anelDeFocoSobreEscuro, estiloDeTexto, sombraDeElevacao } from './estilos.ts';

export type TipoDeToast = 'sucesso' | 'informativo';

export interface AcaoDoToast {
  rotulo: string;
  aoPressionar: () => void;
}

export const DURACAO_DO_TOAST_EM_MS = 4000;
export const DURACAO_DO_TOAST_COM_ACAO_EM_MS = 6000;

export interface ToastProps {
  mensagem: string;
  /** Padrão: `informativo`. */
  tipo?: TipoDeToast;
  /** Ação como "Desfazer": o toast fica 6 s em vez de 4. */
  acao?: AcaoDoToast;
  /** Chamado quando o tempo acaba ou depois de tocar na ação. */
  aoDispensar: () => void;
  testID?: string;
}

const simbolos: Record<TipoDeToast, string> = { sucesso: '✓', informativo: 'i' };

export function Toast({ mensagem, tipo = 'informativo', acao, aoDispensar, testID }: ToastProps) {
  const [pausado, setPausado] = useState(false);
  const foco = useFoco();
  // A última versão do callback, sem reiniciar o relógio a cada renderização da tela.
  const dispensar = useRef(aoDispensar);
  useEffect(() => {
    dispensar.current = aoDispensar;
  });

  useEffect(() => {
    anunciar(mensagem);
  }, [mensagem]);

  // Pausado (toque ou foco na ação), o relógio para; ao soltar, a contagem recomeça inteira.
  // Tempo ajustável (WCAG 2.2.1): com leitor de tela ou fonte ampliada a duração dobra.
  const [leitorDeTela, setLeitorDeTela] = useState(false);
  useEffect(() => {
    let ativo = true;
    // Se a consulta nativa falhar, fica a duração padrão.
    void Promise.resolve(AccessibilityInfo.isScreenReaderEnabled())
      .then((ligado) => {
        if (ativo) setLeitorDeTela(Boolean(ligado));
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, []);
  const precisaDeMaisTempo = leitorDeTela || PixelRatio.getFontScale() > 1.3;
  const duracao =
    (acao ? DURACAO_DO_TOAST_COM_ACAO_EM_MS : DURACAO_DO_TOAST_EM_MS) *
    (precisaDeMaisTempo ? 2 : 1);
  useEffect(() => {
    if (pausado) return;
    const relogio = setTimeout(() => dispensar.current(), duracao);
    return () => clearTimeout(relogio);
  }, [pausado, duracao, mensagem]);

  return (
    <View
      testID={testID}
      onTouchStart={() => setPausado(true)}
      onTouchEnd={() => setPausado(false)}
      onTouchCancel={() => setPausado(false)}
      style={[estilos.toast, sombraDeElevacao(2)]}
    >
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={estilos.simbolo}
      >
        {simbolos[tipo]}
      </Text>
      <Text role="status" style={estilos.mensagem}>
        {mensagem}
      </Text>
      {acao ? (
        <Pressable
          role="button"
          accessibilityLabel={acao.rotulo}
          onPress={() => {
            acao.aoPressionar();
            aoDispensar();
          }}
          onFocus={() => {
            foco.aoFocar();
            setPausado(true);
          }}
          onBlur={() => {
            foco.aoDesfocar();
            setPausado(false);
          }}
          style={({ pressed }) => [
            estilos.acao,
            pressed && estilos.acaoPressionada,
            foco.focado && anelDeFocoSobreEscuro,
          ]}
        >
          <Text style={estilos.acaoTexto}>{acao.rotulo}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export interface OpcoesDoToast {
  mensagem: string;
  tipo?: TipoDeToast;
  acao?: AcaoDoToast;
}

interface ContextoDoToast {
  exibirToast: (opcoes: OpcoesDoToast) => void;
}

const Contexto = createContext<ContextoDoToast | null>(null);

export interface ProvedorDeToastProps {
  children: ReactNode;
  /** Distância da borda de baixo (some a altura da navegação inferior e a área segura). */
  margemInferior?: number;
}

export function ProvedorDeToast({ children, margemInferior = espaco[4] }: ProvedorDeToastProps) {
  const [atual, setAtual] = useState<(OpcoesDoToast & { id: number }) | null>(null);
  const contador = useRef(0);

  const exibirToast = useCallback((opcoes: OpcoesDoToast) => {
    contador.current += 1;
    setAtual({ ...opcoes, id: contador.current });
  }, []);
  const dispensar = useCallback(() => setAtual(null), []);
  const valor = useMemo(() => ({ exibirToast }), [exibirToast]);

  return (
    <Contexto value={valor}>
      <View style={estilos.raiz}>
        {children}
        {/* A região existe sempre, então o toast que aparece depois é anunciado. */}
        <View
          pointerEvents="box-none"
          accessibilityLiveRegion="polite"
          style={[estilos.area, { bottom: margemInferior }]}
        >
          {atual ? (
            <Toast
              key={atual.id}
              mensagem={atual.mensagem}
              tipo={atual.tipo}
              acao={atual.acao}
              aoDispensar={dispensar}
            />
          ) : null}
        </View>
      </View>
    </Contexto>
  );
}

/** Dispara toasts da tela. Só dentro de um `ProvedorDeToast`. */
export function useToast(): ContextoDoToast {
  const contexto = use(Contexto);
  if (!contexto) throw new Error('useToast precisa estar dentro de um ProvedorDeToast');
  return contexto;
}

const estilos = StyleSheet.create({
  raiz: { flex: 1 },
  area: { position: 'absolute', left: espaco[4], right: espaco[4] },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco[3],
    paddingVertical: espaco[2],
    paddingLeft: espaco[4],
    paddingRight: espaco[2],
    minHeight: tamanho.touch.min,
    borderRadius: raio.md,
    backgroundColor: temaClaro.toast.bg,
  },
  simbolo: { ...estiloDeTexto('body', 'semibold'), color: temaClaro.text.onAction },
  mensagem: { ...estiloDeTexto('bodySm'), flex: 1, color: temaClaro.text.onAction },
  acao: {
    minHeight: tamanho.touch.min,
    justifyContent: 'center',
    paddingHorizontal: espaco[3],
    borderRadius: raio.md,
  },
  acaoPressionada: { backgroundColor: temaClaro.banner.offline },
  acaoTexto: {
    ...estiloDeTexto('bodySm', 'semibold'),
    color: temaClaro.text.onAction,
    textDecorationLine: 'underline',
  },
});
