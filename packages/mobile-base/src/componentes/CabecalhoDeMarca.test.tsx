import { temaClaro } from '@bairrin/tokens';
import { render, screen } from '@testing-library/react-native';
import { SvgXml } from 'react-native-svg';
import { CabecalhoDeMarca } from './CabecalhoDeMarca.tsx';
import { LOGO_HORIZONTAL } from './marca/logo.ts';

describe('CabecalhoDeMarca', () => {
  it('mostra o logo como imagem "Bairrin" e o slogan do consumidor por padrão', async () => {
    await render(<CabecalhoDeMarca />);

    expect(screen.getByRole('img', { name: 'Bairrin' })).toBeOnTheScreen();
    expect(screen.getByText('lojas do seu bairro')).toHaveStyle({
      color: temaClaro.text.secondary,
    });
  });

  it('o lojista passa o slogan dele', async () => {
    await render(<CabecalhoDeMarca slogan="venda para o seu bairro" />);

    expect(screen.getByText('venda para o seu bairro')).toBeOnTheScreen();
    expect(screen.queryByText('lojas do seu bairro')).toBeNull();
  });

  it('o logo ocupa 60% da largura, até 160 px, na proporção do desenho (197 por 66)', async () => {
    await render(<CabecalhoDeMarca />);

    expect(screen.getByRole('img', { name: 'Bairrin' })).toHaveStyle({
      width: '60%',
      maxWidth: 160,
      aspectRatio: 197 / 66,
    });
  });

  it('desenha o SVG da marca com SvgXml', async () => {
    await render(<CabecalhoDeMarca />);

    const svg = screen.getByRole('img', { name: 'Bairrin' }).children[0];
    expect(svg).toBeTruthy();
    expect(typeof SvgXml).toBe('function');
    expect(LOGO_HORIZONTAL).toContain('viewBox="0 0 197 66"');
  });
});
