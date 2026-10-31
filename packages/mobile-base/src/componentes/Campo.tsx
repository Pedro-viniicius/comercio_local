// Campo de formulário (design system, "Campos"): texto, e-mail, senha e telefone. Rótulo sempre
// visível acima (nunca só o placeholder), ajuda e erro abaixo, foco com borda de 2 px `focus.ring`
// (D8) e "Mostrar senha" de 44×44 dentro do campo. A mensagem de erro chega pronta
// (`mensagemDoCampo`): o Campo só a mostra. Ao enviar com erros, quem monta a tela põe o foco no
// primeiro campo inválido (`ref`) e anuncia o total (`textos.componentes.errosNoEnvio`).
import { espaco, raio, tamanho, temaClaro } from '@bairrin/tokens';
import { useEffect, useState, type Ref } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ReturnKeyTypeOptions,
  type TextInputInstance,
  type TextInputProps,
} from 'react-native';
import { textos } from '../textos/pt-BR.ts';
import { anunciar, useFoco } from './acessibilidade.ts';
import { anelDeFoco, estiloDeTexto } from './estilos.ts';
import { mascararTelefone } from './mascara-de-telefone.ts';

export type TipoDoCampo = 'texto' | 'email' | 'senha' | 'telefone';
/** Dica de preenchimento automático (gerenciador de senhas e do sistema) além do que o tipo diz. */
export type PreenchimentoDoCampo = 'nome' | 'senha-nova' | 'senha-atual';

export interface CampoProps {
  /** Sempre visível; nunca só o placeholder. */
  rotulo: string;
  valor: string;
  /** Recebe o texto já com a máscara (telefone). */
  aoMudarTexto: (texto: string) => void;
  /** Padrão: `texto`. */
  tipo?: TipoDoCampo;
  /** Senha: `senha-atual` (login) ou `senha-nova` (cadastro, o gerenciador sugere uma forte). */
  preenchimento?: PreenchimentoDoCampo;
  /** Texto de ajuda abaixo do campo. */
  ajuda?: string;
  /** Erro do campo: borda e mensagem de perigo, anunciada ao leitor de tela. */
  erro?: string;
  placeholder?: string;
  /** Fundo apagado e texto de desabilitado; o leitor de tela avisa. */
  desabilitado?: boolean;
  /** Sem borda, fundo `bg.subtle` (A1 enquanto envia). */
  somenteLeitura?: boolean;
  /** Enter do teclado: envia ou vai ao próximo campo. */
  aoEnviar?: () => void;
  acaoDoTeclado?: ReturnKeyTypeOptions;
  /** Para a tela pôr o foco no primeiro campo com erro. */
  ref?: Ref<TextInputInstance>;
  testID?: string;
}

type PropriedadesDoTipo = Pick<
  TextInputProps,
  | 'keyboardType'
  | 'autoCapitalize'
  | 'autoCorrect'
  | 'spellCheck'
  | 'autoComplete'
  | 'textContentType'
  | 'secureTextEntry'
>;

function propriedadesDoTipo(
  tipo: TipoDoCampo,
  preenchimento: PreenchimentoDoCampo | undefined,
  senhaVisivel: boolean,
): PropriedadesDoTipo {
  switch (tipo) {
    case 'email':
      return {
        keyboardType: 'email-address',
        autoCapitalize: 'none',
        autoCorrect: false,
        spellCheck: false,
        autoComplete: 'email',
        textContentType: 'emailAddress',
      };
    case 'telefone':
      return {
        keyboardType: 'phone-pad',
        autoComplete: 'tel',
        textContentType: 'telephoneNumber',
      };
    case 'senha':
      return {
        secureTextEntry: !senhaVisivel,
        autoCapitalize: 'none',
        autoCorrect: false,
        spellCheck: false,
        ...(preenchimento === 'senha-nova'
          ? { autoComplete: 'new-password', textContentType: 'newPassword' }
          : { autoComplete: 'current-password', textContentType: 'password' }),
      };
    default:
      return preenchimento === 'nome'
        ? { autoCapitalize: 'words', autoComplete: 'name', textContentType: 'name' }
        : {};
  }
}

export function Campo({
  rotulo,
  valor,
  aoMudarTexto,
  tipo = 'texto',
  preenchimento,
  ajuda,
  erro,
  placeholder,
  desabilitado = false,
  somenteLeitura = false,
  aoEnviar,
  acaoDoTeclado,
  ref,
  testID,
}: CampoProps) {
  const foco = useFoco();
  const focoDoBotao = useFoco();
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  // Dito só depois da primeira troca: no carregamento da tela não há o que anunciar.
  const [estadoDaSenha, setEstadoDaSenha] = useState('');

  // O Android anuncia pela região viva do erro; o iOS não, então o erro novo é dito à mão.
  useEffect(() => {
    if (erro) anunciar(erro);
  }, [erro]);

  const ehSenha = tipo === 'senha';
  const editavel = !desabilitado && !somenteLeitura;

  const alternarSenha = () => {
    const proximo = !senhaVisivel;
    const texto = proximo ? textos.componentes.senhaVisivel : textos.componentes.senhaOculta;
    setSenhaVisivel(proximo);
    setEstadoDaSenha(texto);
    anunciar(texto);
  };

  const aoMudar = (texto: string) =>
    aoMudarTexto(tipo === 'telefone' ? mascararTelefone(texto) : texto);

  const dicas = [erro && `${textos.componentes.erroDoCampo}: ${erro}`, ajuda].filter(Boolean);
  const bordaEmFoco = editavel && foco.focado;

  return (
    <View style={estilos.campo}>
      {/* O nome acessível do campo é o `accessibilityLabel`; o rótulo visível não se repete. */}
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[estilos.rotulo, desabilitado && estilos.rotuloDesabilitado]}
      >
        {rotulo}
      </Text>
      <View
        style={[
          estilos.caixa,
          somenteLeitura || desabilitado ? estilos.caixaApagada : null,
          somenteLeitura ? estilos.caixaSomenteLeitura : null,
          erro ? estilos.caixaComErro : null,
          bordaEmFoco ? estilos.caixaEmFoco : null,
        ]}
      >
        <TextInput
          ref={ref}
          testID={testID}
          {...propriedadesDoTipo(tipo, preenchimento, senhaVisivel)}
          value={valor}
          onChangeText={aoMudar}
          editable={editavel}
          placeholder={placeholder}
          placeholderTextColor={temaClaro.text.tertiary}
          accessibilityLabel={rotulo}
          accessibilityHint={dicas.length > 0 ? dicas.join('. ') : undefined}
          accessibilityState={{ disabled: desabilitado }}
          onFocus={foco.aoFocar}
          onBlur={foco.aoDesfocar}
          onSubmitEditing={aoEnviar}
          returnKeyType={acaoDoTeclado}
          style={[estilos.entrada, desabilitado && estilos.entradaDesabilitada]}
        />
        {ehSenha ? (
          <Pressable
            role="button"
            accessibilityLabel={
              senhaVisivel ? textos.componentes.ocultarSenha : textos.componentes.mostrarSenha
            }
            accessibilityState={{ disabled: !editavel }}
            onPress={editavel ? alternarSenha : undefined}
            onFocus={focoDoBotao.aoFocar}
            onBlur={focoDoBotao.aoDesfocar}
            style={[estilos.alternar, focoDoBotao.focado && anelDeFoco]}
          >
            <Text style={estilos.alternarTexto}>
              {senhaVisivel ? textos.componentes.ocultar : textos.componentes.mostrar}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {ehSenha ? (
        <Text role="status" accessibilityLiveRegion="polite" style={estilos.anuncio}>
          {estadoDaSenha}
        </Text>
      ) : null}
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
  caixa: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: tamanho.control.height.mobile,
    borderRadius: raio.md,
    borderWidth: 1,
    borderColor: temaClaro.border.control,
    backgroundColor: temaClaro.bg.surface,
  },
  caixaApagada: { backgroundColor: temaClaro.bg.subtle },
  caixaSomenteLeitura: { borderColor: 'transparent' },
  caixaComErro: { borderColor: temaClaro.status.danger.solid },
  // 2 px de borda no lugar de 1: o padding perde 1 px para o campo não mudar de tamanho ao focar.
  caixaEmFoco: { borderWidth: 2, borderColor: temaClaro.focus.ring },
  entrada: {
    ...estiloDeTexto('body'),
    flex: 1,
    minHeight: tamanho.control.height.mobile - 4,
    paddingHorizontal: espaco[3],
    paddingVertical: espaco[2],
    color: temaClaro.text.primary,
  },
  entradaDesabilitada: { color: temaClaro.text.tertiary },
  alternar: {
    minWidth: tamanho.touch.min,
    minHeight: tamanho.touch.min,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: espaco[2],
    borderRadius: raio.md,
  },
  alternarTexto: { ...estiloDeTexto('bodySm', 'semibold'), color: temaClaro.text.link },
  // Região viva sem presença visual: anuncia "Senha visível" e "Senha oculta".
  anuncio: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    color: 'transparent',
  },
  ajuda: { ...estiloDeTexto('bodySm'), color: temaClaro.text.secondary },
  linhaDoErro: { flexDirection: 'row', gap: espaco[1] },
  erro: { ...estiloDeTexto('bodySm', 'semibold'), color: temaClaro.status.danger.fg },
  textoDoErro: { flex: 1 },
});
