// Componentes base dos apps (etapa 12a do plano 01b), com os textos de `../textos`.
export { anunciar, useFoco } from './acessibilidade.ts';
export { Banner, type AcaoDoBanner, type BannerProps, type TomDoBanner } from './Banner.tsx';
export {
  BarraSuperior,
  textoDoSelo,
  type AcaoDaBarra,
  type BarraSuperiorProps,
} from './BarraSuperior.tsx';
export { Botao, type BotaoProps, type VarianteDoBotao } from './Botao.tsx';
export { CabecalhoDeMarca, type CabecalhoDeMarcaProps } from './CabecalhoDeMarca.tsx';
export { CaixaDeSelecao, type CaixaDeSelecaoProps, type LinkDoRotulo } from './CaixaDeSelecao.tsx';
export { Campo, type CampoProps, type PreenchimentoDoCampo, type TipoDoCampo } from './Campo.tsx';
export {
  CampoDeCodigo,
  TAMANHO_DO_CODIGO,
  digitosDoCodigo,
  type CampoDeCodigoProps,
} from './CampoDeCodigo.tsx';
export { EstadoVazio, type AcaoDoEstadoVazio, type EstadoVazioProps } from './EstadoVazio.tsx';
export { FaixaOffline, type FaixaOfflineProps } from './FaixaOffline.tsx';
export { ItemDeLista, type ItemDeListaProps } from './ItemDeLista.tsx';
export { LeitorDeTextoLegal, type LeitorDeTextoLegalProps } from './LeitorDeTextoLegal.tsx';
export { digitosDoCelular, mascararTelefone } from './mascara-de-telefone.ts';
export { ModalDeConfirmacao, type ModalDeConfirmacaoProps } from './ModalDeConfirmacao.tsx';
export {
  DURACAO_DO_TOAST_COM_ACAO_EM_MS,
  DURACAO_DO_TOAST_EM_MS,
  ProvedorDeToast,
  Toast,
  useToast,
  type AcaoDoToast,
  type OpcoesDoToast,
  type ProvedorDeToastProps,
  type TipoDeToast,
  type ToastProps,
} from './Toast.tsx';
