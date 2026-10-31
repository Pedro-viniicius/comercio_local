import { temaClaro } from '@bairrin/tokens';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { LeitorDeTextoLegal } from './LeitorDeTextoLegal.tsx';

const CONTEUDO = [
  '# Política de Privacidade do Bairrin',
  '',
  '**Rascunho.** Texto provisório.',
  '',
  '## Dados que guardamos',
  '',
  'Nome, e-mail e celular informados no cadastro.',
  '',
  '- Pedidos',
  '- Endereços',
].join('\n');

describe('LeitorDeTextoLegal', () => {
  it('mostra o título como cabeçalho e a linha de versão com a data de vigência', async () => {
    await render(
      <LeitorDeTextoLegal
        titulo="Política de Privacidade"
        versao="1.0"
        vigenteDesde="2026-10-16T12:00:00Z"
        conteudo={CONTEUDO}
      />,
    );

    expect(screen.getAllByRole('heading')[0]).toHaveTextContent('Política de Privacidade');
    expect(screen.getAllByRole('heading')[0]).toHaveStyle({ fontSize: 22, lineHeight: 28 });
    expect(screen.getByText('Versão 1.0 · vigente desde 16/10/2026')).toHaveStyle({
      color: temaClaro.text.secondary,
    });
  });

  it('sem data, ou com data inválida, mostra só a versão', async () => {
    const { rerender } = await render(
      <LeitorDeTextoLegal titulo="Termos" versao="2.1" conteudo={CONTEUDO} />,
    );
    expect(screen.getByText('Versão 2.1')).toBeOnTheScreen();

    await rerender(
      <LeitorDeTextoLegal titulo="Termos" versao="2.1" vigenteDesde="ontem" conteudo={CONTEUDO} />,
    );
    expect(screen.getByText('Versão 2.1')).toBeOnTheScreen();
  });

  it('o conteúdo vira títulos h2, parágrafos e itens; o `#` do documento não se repete', async () => {
    await render(
      <LeitorDeTextoLegal titulo="Política de Privacidade" versao="1.0" conteudo={CONTEUDO} />,
    );

    expect(screen.getAllByRole('heading')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Dados que guardamos' })).toBeOnTheScreen();
    expect(screen.getByText('Nome, e-mail e celular informados no cadastro.')).toBeOnTheScreen();
    expect(screen.queryByText('Política de Privacidade do Bairrin')).toBeNull();
    expect(screen.getByText(/Pedidos/)).toBeOnTheScreen();
    expect(screen.getByText(/Endereços/)).toBeOnTheScreen();
  });

  it('o **negrito** do documento sai em semibold', async () => {
    await render(<LeitorDeTextoLegal titulo="T" versao="1.0" conteudo={CONTEUDO} />);

    expect(screen.getByText('Rascunho.')).toHaveStyle({ fontWeight: '600' });
  });

  it('o corpo tem largura máxima de ~70 caracteres por linha', async () => {
    await render(<LeitorDeTextoLegal titulo="T" versao="1.0" conteudo={CONTEUDO} />);

    const paragrafo = screen.getByText('Nome, e-mail e celular informados no cadastro.');
    expect(paragrafo.parent).toHaveStyle({ maxWidth: 540 });
  });

  it('HTML no conteúdo aparece como texto, sem virar elemento', async () => {
    await render(
      <LeitorDeTextoLegal
        titulo="T"
        versao="1.0"
        conteudo={'<b>negrito</b> e <script>x</script>'}
      />,
    );

    expect(screen.getByText('<b>negrito</b> e <script>x</script>')).toBeOnTheScreen();
  });

  it('conteúdo vazio mostra só o cabeçalho e o botão, sem quebrar', async () => {
    await render(<LeitorDeTextoLegal titulo="Termos" versao="1.0" conteudo="" />);

    expect(screen.getByRole('heading')).toHaveTextContent('Termos');
    expect(screen.getByRole('button', { name: 'Voltar ao topo' })).toBeOnTheScreen();
  });

  it('"Voltar ao topo" rola o texto para o início, sem animação', async () => {
    await render(<LeitorDeTextoLegal titulo="T" versao="1.0" conteudo={CONTEUDO} />);
    // O ScrollView do preset do React Native é um componente de classe com `scrollTo` simulado.
    const scrollTo = (ScrollView as unknown as { prototype: { scrollTo: jest.Mock } }).prototype
      .scrollTo;
    scrollTo.mockClear();

    await fireEvent.press(screen.getByRole('button', { name: 'Voltar ao topo' }));
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  });

  it('"Voltar ao topo" é terciário com alvo de 44', async () => {
    await render(<LeitorDeTextoLegal titulo="T" versao="1.0" conteudo={CONTEUDO} />);

    expect(screen.getByRole('button', { name: 'Voltar ao topo' })).toHaveStyle({
      minHeight: 44,
      backgroundColor: 'transparent',
    });
  });
});
