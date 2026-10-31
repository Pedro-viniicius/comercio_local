// Campo de código de 6 dígitos (spec 01, "Componentes"): um único campo numérico, exibido como seis
// casas (`font.title`, algarismos tabulares). Um campo só, para o leitor de tela e a colagem; o
// preenchimento automático de código de uso único do sistema fica ligado. O `TextInput` real cobre
// as casas, sem texto visível; as casas só desenham o valor. Ao completar 6 dígitos chama
// `aoCompletar` (a tela envia sozinha).
import { espaco, raio, tamanho, temaClaro } from '@bairrin/tokens';
import { useEffect, type Ref } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputInstance } from 'react-native';
import { textos } from '../textos/pt-BR.ts';
import { anunciar, useFoco } from './acessibilidade.ts';
import { estiloDeTexto } from './estilos.ts';

export const TAMANHO_DO_CODIGO = 6;

export interface CampoDeCodigoProps {
  /** Só os dígitos (até 6). */
  valor: string;
  aoMudarTexto: (digitos: string) => void;
  /** Chamado uma vez ao chegar a 6 dígitos (digitados ou colados). */
  aoCompletar?: (codigo: string) => void;
  /** Padrão: "Código de 6 dígitos". */
  rotulo?: string;
  erro?: string;
  ajuda?: string;
  desabilitado?: boolean;
  ref?: Ref<TextInputInstance>;
  testID?: string;
}

/** Só algarismos ASCII, até 6: aceita colar "123 456" ou "123-456". */
export function digitosDoCodigo(texto: string): string {
  return texto.replaceAll(/\D/g, '').slice(0, TAMANHO_DO_CODIGO);
}

export function CampoDeCodigo({
  valor,
  aoMudarTexto,
  aoCompletar,
  rotulo = textos.componentes.codigo.rotulo,
  erro,
  ajuda,
  desabilitado = false,
  ref,
  testID,
}: CampoDeCodigoProps) {
  const foco = useFoco();
  const digitos = digitosDoCodigo(valor);
  const casaAtual = Math.min(digitos.length, TAMANHO_DO_CODIGO - 1);

  // O Android anuncia pela região viva do erro; o iOS não, então o erro novo é dito à mão.
  useEffect(() => {
    if (erro) anunciar(erro);
  }, [erro]);

  const aoMudar = (texto: string) => {
    const novo = digitosDoCodigo(texto);
    aoMudarTexto(novo);
    // Só dispara na passagem para 6: reeditar um código completo não envia de novo sem querer.
    if (novo.length === TAMANHO_DO_CODIGO && digitos.length < TAMANHO_DO_CODIGO) {
      aoCompletar?.(novo);
    }
  };

  const dicas = [erro && `${textos.componentes.erroDoCampo}: ${erro}`, ajuda].filter(Boolean);

  return (
    <View style={estilos.campo}>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[estilos.rotulo, desabilitado && estilos.rotuloDesabilitado]}
      >
        {rotulo}
      </Text>
      <View style={estilos.area}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={estilos.casas}
        >
          {Array.from({ length: TAMANHO_DO_CODIGO }, (_, indice) => (
            <View
              key={indice}
              testID={testID ? `${testID}-casa-${indice}` : undefined}
              style={[
                estilos.casa,
                desabilitado && estilos.casaApagada,
                erro ? estilos.casaComErro : null,
                foco.focado && !desabilitado && indice === casaAtual ? estilos.casaEmFoco : null,
              ]}
            >
              <Text style={estilos.digito}>{digitos[indice] ?? ''}</Text>
            </View>
          ))}
        </View>
        {/* Cobre as casas: recebe o toque, o foco, a colagem e o código de uso único do sistema. */}
        <TextInput
          ref={ref}
          testID={testID}
          value={digitos}
          onChangeText={aoMudar}
          editable={!desabilitado}
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          autoCorrect={false}
          spellCheck={false}
          caretHidden
          selectionColor="transparent"
          accessibilityLabel={rotulo}
          accessibilityHint={dicas.length > 0 ? dicas.join('. ') : undefined}
          accessibilityState={{ disabled: desabilitado }}
          onFocus={foco.aoFocar}
          onBlur={foco.aoDesfocar}
          style={estilos.entrada}
        />
      </View>
      {ajuda ? <Text style={estilos.ajuda}>{ajuda}</Text> : null}
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

const estilos = StyleSheet.create({
  campo: { gap: espaco[1] },
  rotulo: { ...estiloDeTexto('bodySm', 'semibold'), color: temaClaro.text.primary },
  rotuloDesabilitado: { color: temaClaro.text.tertiary },
  area: { minHeight: tamanho.control.height.mobile },
  casas: { flexDirection: 'row', gap: espaco[2] },
  casa: {
    flex: 1,
    minHeight: tamanho.control.height.mobile + espaco[2],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: temaClaro.border.control,
    backgroundColor: temaClaro.bg.surface,
  },
  casaApagada: { backgroundColor: temaClaro.bg.subtle },
  casaComErro: { borderColor: temaClaro.status.danger.solid },
  casaEmFoco: { borderWidth: 2, borderColor: temaClaro.focus.ring },
  digito: {
    ...estiloDeTexto('title'),
    fontVariant: ['tabular-nums'],
    color: temaClaro.text.primary,
  },
  // Transparente e por cima das casas: o texto real não aparece duas vezes.
  entrada: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    color: 'transparent',
  },
  ajuda: { ...estiloDeTexto('bodySm'), color: temaClaro.text.secondary },
  linhaDoErro: { flexDirection: 'row', gap: espaco[1] },
  erro: { ...estiloDeTexto('bodySm', 'semibold'), color: temaClaro.status.danger.fg },
  textoDoErro: { flex: 1 },
});
