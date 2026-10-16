// `GET /v1/saude`: a API está viva (não consulta o banco) e só mostra a versão
// fora de produção (S24). `GET /v1/saude/pronto`: a API consegue usar o banco.
import { readFileSync } from 'node:fs';
import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { type Prontidao, type Saude, z } from '@bairrin/contratos';
import { PinoLogger } from 'nestjs-pino';
import { AMBIENTE, type Ambiente } from '../config/ambiente.ts';
import { PrismaService } from '../infra/prisma.service.ts';

const manifestoSchema = z.object({ version: z.string() });

/**
 * Versão do `apps/api/package.json`. O caminho relativo vale para `src/` (testes)
 * e para `dist/` (build), que ficam no mesmo nível.
 */
export function lerVersaoDaApi(): string {
  const conteudo = readFileSync(new URL('../../../package.json', import.meta.url), 'utf8');
  return manifestoSchema.parse(JSON.parse(conteudo)).version;
}

@Controller('v1/saude')
export class SaudeController {
  private readonly versao: string | undefined;

  constructor(
    @Inject(AMBIENTE) ambiente: Ambiente,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.versao = ambiente.NODE_ENV === 'production' ? undefined : lerVersaoDaApi();
    this.logger.setContext(SaudeController.name);
  }

  @Get()
  saude(): Saude {
    return this.versao === undefined ? { status: 'ok' } : { status: 'ok', versao: this.versao };
  }

  /**
   * 200 quando o banco responde; 503 em Problem Details (`indisponivel`)
   * quando não. A causa vai para o log só com tipo, código e pilha: a
   * mensagem do `pg` pode trazer parâmetros e nunca sai na resposta.
   */
  @Get('pronto')
  async pronto(): Promise<Prontidao> {
    try {
      await this.prisma.verificarConexao();
    } catch (erro) {
      this.logger.warn({ err: erro }, 'banco indisponível na verificação de prontidão');
      throw new ServiceUnavailableException();
    }
    return { status: 'ok' };
  }
}
