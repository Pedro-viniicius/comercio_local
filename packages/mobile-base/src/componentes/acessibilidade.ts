// Ajudas de acessibilidade dos componentes base: anúncio manual só no iOS e estado de foco.
import { useCallback, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Anuncia um texto ao leitor de tela à mão, só no iOS. No Android a região viva
 * (`accessibilityLiveRegion`) já anuncia; chamar `announceForAccessibility` lá repetiria a fala (D9).
 * Use junto de uma região viva, nunca no lugar dela.
 */
export function anunciar(texto: string): void {
  if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(texto);
}

/**
 * Estado de foco de um controle (teclado, controle externo ou leitor de tela), para desenhar o
 * anel `focus.ring` (D8). O `Pressable` do React Native só informa "pressionado" ao estilo, então o
 * foco vem de `onFocus` e `onBlur`.
 */
export function useFoco() {
  const [focado, setFocado] = useState(false);
  const aoFocar = useCallback(() => setFocado(true), []);
  const aoDesfocar = useCallback(() => setFocado(false), []);
  return { focado, aoFocar, aoDesfocar };
}
