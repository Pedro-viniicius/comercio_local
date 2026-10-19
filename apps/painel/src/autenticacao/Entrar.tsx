// P1. Entrar (spec 01; CA-09, CA-04, CA-101). E-mail e senha com `cliente: painel`; a resposta é o
// desafio do segundo fator (P1a ou P1b). Senha errada, conta inexistente e freio (401 ou 429) dão a
// mesma mensagem, sem contagem e sem desabilitar o botão (CA-04). O resultado do envio é anunciado
// pela região de status da tela (D9); o Banner de erro se anuncia sozinho (`role="alert"`).
import { entrarSchema, type RespostaDeEntrar } from '@bairrin/contratos';
import { useRef, useState, type FormEvent } from 'react';
import { Banner } from '../componentes/Banner.tsx';
import { Botao } from '../componentes/Botao.tsx';
import { Campo } from '../componentes/Campo.tsx';
import { Cartao } from '../componentes/Cartao.tsx';
import { textos } from '../textos/pt-BR.ts';
import type { AutenticacaoDoPainel } from '../sessao/autenticacao-do-painel.ts';
import {
  classificarFalha,
  errosParaATela,
  validarLocal,
  type ErrosDosCampos,
} from './erros-da-tela.ts';
import { LogoBairrin } from './LogoBairrin.tsx';
import { useTituloDaPagina } from './titulo-da-pagina.ts';
import './autenticacao.css';

const t = textos.autenticacao;

export type AvisoDeEntrada =
  | 'credenciais'
  | 'servidor'
  | 'falhaAoAbrir'
  | 'sessaoTerminou'
  | 'semAcesso'
  | 'desafioVencido'
  | 'senhaAlterada'
  | 'saiu'
  | 'naoSaiu';

const BANNERS: Record<
  AvisoDeEntrada,
  { tom: 'informacao' | 'sucesso' | 'aviso' | 'erro'; texto: string }
> = {
  credenciais: { tom: 'erro', texto: t.aviso.credenciais },
  servidor: { tom: 'erro', texto: t.aviso.servidor },
  falhaAoAbrir: { tom: 'erro', texto: t.aviso.servidor },
  sessaoTerminou: { tom: 'informacao', texto: t.aviso.sessaoTerminou },
  semAcesso: { tom: 'erro', texto: t.aviso.semAcesso },
  desafioVencido: { tom: 'aviso', texto: t.aviso.desafioVencido },
  senhaAlterada: { tom: 'sucesso', texto: t.aviso.senhaAlterada },
  saiu: { tom: 'sucesso', texto: t.aviso.saiu },
  naoSaiu: { tom: 'erro', texto: t.aviso.naoSaiu },
};

type CampoDeEntrada = 'email' | 'senha';
const CAMPOS: readonly CampoDeEntrada[] = ['email', 'senha'];

export interface EntrarProps {
  autenticacao: Pick<AutenticacaoDoPainel, 'entrar'>;
  emailInicial?: string;
  avisoInicial?: AvisoDeEntrada | undefined;
  /** "Tentar de novo" do aviso (sair de novo, S80, ou abrir de novo). Sem ela, o aviso não tem ação. */
  aoTentarDeNovo?: (() => void) | undefined;
  aoEntrar: (resposta: RespostaDeEntrar, email: string) => void;
  aoEsquecerSenha: (email: string) => void;
}

export function Entrar({
  autenticacao,
  emailInicial = '',
  avisoInicial,
  aoTentarDeNovo,
  aoEntrar,
  aoEsquecerSenha,
}: EntrarProps) {
  useTituloDaPagina(t.entrar.titulo);
  const [email, setEmail] = useState(emailInicial);
  const [senha, setSenha] = useState('');
  const [erros, setErros] = useState<ErrosDosCampos<CampoDeEntrada>>({});
  // `vez` remonta o Banner a cada resultado, para o mesmo texto ser anunciado de novo.
  const [aviso, setAviso] = useState<{ tipo: AvisoDeEntrada; vez: number } | undefined>(
    avisoInicial === undefined ? undefined : { tipo: avisoInicial, vez: 0 },
  );
  const [carregando, setCarregando] = useState(false);
  const [anuncio, setAnuncio] = useState('');
  const refDoEmail = useRef<HTMLInputElement>(null);
  const refDaSenha = useRef<HTMLInputElement>(null);

  const mostrarAviso = (tipo: AvisoDeEntrada) => {
    setAnuncio('');
    setAviso((anterior) => ({ tipo, vez: (anterior?.vez ?? 0) + 1 }));
  };

  const mostrarErrosDosCampos = (
    novos: ErrosDosCampos<CampoDeEntrada>,
    ordem: CampoDeEntrada[],
  ) => {
    setErros(novos);
    setAnuncio(t.errosNoEnvio(ordem.length));
    const primeiro = ordem[0];
    if (primeiro !== undefined) (primeiro === 'email' ? refDoEmail : refDaSenha).current?.focus();
  };

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (carregando) return;
    setAviso(undefined);
    const validacao = validarLocal(entrarSchema, { email, senha, cliente: 'painel' });
    if (!validacao.ok) {
      const { erros: novos, ordem } = errosParaATela(validacao.campos, CAMPOS);
      mostrarErrosDosCampos(novos, ordem);
      return;
    }
    setErros({});
    setCarregando(true);
    setAnuncio(t.enviando);
    try {
      const resposta = await autenticacao.entrar(validacao.dados);
      aoEntrar(resposta, email);
    } catch (erro) {
      setCarregando(false);
      const falha = classificarFalha(erro);
      if (falha.tipo === 'campos') {
        const { erros: novos, ordem, foraDaTela } = errosParaATela(falha.campos, CAMPOS);
        if (ordem.length > 0) mostrarErrosDosCampos(novos, ordem);
        if (foraDaTela || ordem.length === 0) mostrarAviso('servidor');
        return;
      }
      if (falha.tipo === 'servidor') {
        mostrarAviso('servidor');
        return;
      }
      // 401, 429 e 403: a senha sai do campo; o e-mail fica (spec 01, A1).
      setSenha('');
      mostrarAviso(falha.tipo === 'sem_acesso_painel' ? 'semAcesso' : 'credenciais');
    }
  };

  const banner = aviso && BANNERS[aviso.tipo];
  const comAcao = aviso && (aviso.tipo === 'naoSaiu' || aviso.tipo === 'falhaAoAbrir');

  return (
    <div className="ui-cartao-fundo">
      <Cartao titulo={t.entrar.titulo} cabecalho={<LogoBairrin />}>
        {aviso && banner && (
          <Banner
            key={aviso.vez}
            tom={banner.tom}
            acao={
              comAcao && aoTentarDeNovo ? (
                <Botao variante="secundario" onClick={aoTentarDeNovo}>
                  {t.tentarDeNovo}
                </Botao>
              ) : undefined
            }
          >
            {banner.texto}
          </Banner>
        )}
        <form className="aut-formulario" noValidate onSubmit={(evento) => void enviar(evento)}>
          <Campo
            ref={refDoEmail}
            rotulo={t.entrar.email}
            tipo="email"
            autoComplete="email"
            name="email"
            value={email}
            readOnly={carregando}
            erro={erros.email}
            autoFocus={emailInicial === ''}
            onChange={(evento) => setEmail(evento.target.value)}
          />
          <Campo
            ref={refDaSenha}
            rotulo={t.entrar.senha}
            tipo="senha"
            autoComplete="current-password"
            name="senha"
            value={senha}
            readOnly={carregando}
            erro={erros.senha}
            autoFocus={emailInicial !== ''}
            onChange={(evento) => setSenha(evento.target.value)}
          />
          <Botao type="submit" larguraTotal carregando={carregando}>
            {t.entrar.botao}
          </Botao>
        </form>
        <div className="aut-links">
          <Botao variante="terciario" onClick={() => aoEsquecerSenha(email)}>
            {t.entrar.esqueci}
          </Botao>
        </div>
        <p role="status" className="ui-oculto-visual">
          {anuncio}
        </p>
      </Cartao>
    </div>
  );
}
