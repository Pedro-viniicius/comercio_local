// Leitor de texto legal (spec 01, "Componentes"): título (`font.title`), linha "Versão X · vigente
// desde dd/mm/aaaa" (`text.secondary`), conteúdo com títulos h2 e parágrafos de até ~70 caracteres
// por linha, rolagem e "Voltar ao topo" no fim do texto. Abre por cima do formulário (a tela que o
// usa decide como), então o conteúdo vem pronto por propriedade. Sem animação de rolagem.
import { espaco, pesoDaFonte, temaClaro } from '@bairrin/tokens';
import { useRef } from 'react';
import { ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import { textos } from '../textos/pt-BR.ts';
import { Botao } from './Botao.tsx';
import { estiloDeTexto } from './estilos.ts';
import { blocosDoTextoLegal, formatarDataLegal, type TrechoDoTexto } from './texto-legal.ts';

export interface LeitorDeTextoLegalProps {
  titulo: string;
  versao: string;
  /** `AAAA-MM-DD` ou data e hora ISO 8601; sem ele (ou inválido), a linha mostra só a versão. */
  vigenteDesde?: string;
  /** Texto do documento (subconjunto de Markdown: `##`, parágrafos, `- ` e `**negrito**`). */
  conteudo: string;
  testID?: string;
}

/** ~70 caracteres por linha no corpo de 16 px da fonte do sistema. */
const LARGURA_MAXIMA_DA_LINHA = 540;

function Trechos({ trechos }: { trechos: TrechoDoTexto[] }) {
  return trechos.map((trecho, indice) =>
    trecho.negrito ? (
      <Text key={indice} style={estilos.negrito}>
        {trecho.texto}
      </Text>
    ) : (
      trecho.texto
    ),
  );
}

export function LeitorDeTextoLegal({
  titulo,
  versao,
  vigenteDesde,
  conteudo,
  testID,
}: LeitorDeTextoLegalProps) {
  const rolagem = useRef<ScrollViewInstance>(null);
  const data = vigenteDesde === undefined ? null : formatarDataLegal(vigenteDesde);
  const linhaDaVersao =
    data === null
      ? textos.componentes.textoLegal.versaoSemData(versao)
      : textos.componentes.textoLegal.versao(versao, data);

  return (
    <ScrollView
      ref={rolagem}
      testID={testID}
      contentContainerStyle={estilos.conteudo}
      keyboardShouldPersistTaps="handled"
    >
      <Text role="heading" style={estilos.titulo}>
        {titulo}
      </Text>
      <Text style={estilos.versao}>{linhaDaVersao}</Text>
      <View style={estilos.texto}>
        {blocosDoTextoLegal(conteudo).map((bloco, indice) => {
          if (bloco.tipo === 'titulo') {
            return (
              <Text key={indice} role="heading" style={estilos.subtitulo}>
                <Trechos trechos={bloco.trechos} />
              </Text>
            );
          }
          return (
            <Text key={indice} style={[estilos.paragrafo, bloco.tipo === 'item' && estilos.item]}>
              {bloco.tipo === 'item' ? '• ' : null}
              <Trechos trechos={bloco.trechos} />
            </Text>
          );
        })}
      </View>
      <Botao
        rotulo={textos.componentes.textoLegal.voltarAoTopo}
        variante="terciario"
        aoPressionar={() => rolagem.current?.scrollTo({ y: 0, animated: false })}
      />
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  conteudo: { gap: espaco[2], padding: espaco[4], paddingBottom: espaco[8] },
  titulo: { ...estiloDeTexto('title', 'semibold'), color: temaClaro.text.primary },
  versao: { ...estiloDeTexto('bodySm'), color: temaClaro.text.secondary },
  texto: { gap: espaco[3], marginTop: espaco[3], maxWidth: LARGURA_MAXIMA_DA_LINHA },
  subtitulo: {
    ...estiloDeTexto('titleSm', 'semibold'),
    marginTop: espaco[2],
    color: temaClaro.text.primary,
  },
  paragrafo: { ...estiloDeTexto('body'), color: temaClaro.text.primary },
  item: { paddingLeft: espaco[2] },
  negrito: { fontWeight: `${pesoDaFonte.semibold}` },
});
